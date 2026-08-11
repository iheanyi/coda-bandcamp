use crate::bandcamp_http::{
    http_client, read_bounded_response, send_bandcamp_request, BandcampRetryPolicy,
};
use crate::models::{SystemMediaMetadataInput, SystemMediaState};
use crate::system_media;
use crate::url_policy::{allowed_url, UrlKind};
use crate::validation::valid_bounded_text;
use crate::{
    MAX_PLAYER_SECONDS, MAX_SUBSONIC_TEXT_LENGTH, MAX_SYSTEM_MEDIA_ARTWORK_BYTES,
    MAX_SYSTEM_MEDIA_ARTWORK_CACHE,
};
use std::sync::atomic::Ordering;
use tauri::Manager;
use url::Url;

pub(super) fn validate_system_media_metadata(
    input: &SystemMediaMetadataInput,
) -> Result<Option<String>, String> {
    for (label, value) in [
        ("title", input.title.as_str()),
        ("artist", input.artist.as_str()),
        ("album", input.album.as_str()),
    ] {
        if !valid_bounded_text(value, MAX_SUBSONIC_TEXT_LENGTH, true) {
            return Err(format!("The system media {label} is invalid."));
        }
    }
    match input.artwork_url.as_deref() {
        Some(value) => allowed_url(value, UrlKind::BandcampMedia)
            .or_else(|| allowed_url(value, UrlKind::BandcampPage))
            .map(Some)
            .ok_or_else(|| "The system media artwork URL is invalid.".into()),
        None => Ok(None),
    }
}

#[tauri::command]
pub(super) async fn update_system_media_metadata(
    app: tauri::AppHandle,
    input: Option<SystemMediaMetadataInput>,
) -> Result<(), String> {
    let generation = app
        .state::<SystemMediaState>()
        .metadata_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let Some(input) = input else {
        return spawn_system_media_blocking(app, move |_, state| {
            if state.metadata_generation.load(Ordering::SeqCst) != generation {
                return Ok(());
            }
            let session = state
                .session
                .lock()
                .map_err(|_| "The Windows media session is unavailable.".to_string())?;
            match session.as_ref() {
                Some(session) => session.clear(),
                None => Ok(()),
            }
        })
        .await;
    };
    let artwork_url = validate_system_media_metadata(&input)?;
    let artwork = match artwork_url.as_deref() {
        Some(url) => Some(resolve_system_media_artwork(&app, url).await?),
        None => None,
    };
    spawn_system_media_blocking(app, move |app, state| {
        if state.metadata_generation.load(Ordering::SeqCst) != generation {
            return Ok(());
        }
        with_system_media_session(
            app,
            state,
            || state.metadata_generation.load(Ordering::SeqCst) == generation,
            |session| {
                session.update_metadata(
                    input.title.trim(),
                    input.artist.trim(),
                    input.album.trim(),
                    artwork.as_ref(),
                    input.can_previous,
                    input.can_next,
                )
            },
        )
    })
    .await
}

pub(super) async fn resolve_system_media_artwork(
    app: &tauri::AppHandle,
    url: &str,
) -> Result<system_media::SystemMediaArtwork, String> {
    let cache_app = app.clone();
    let lookup_url = url.to_string();
    if let Some(artwork) = spawn_system_media_blocking(cache_app, move |_, state| {
        let mut cache = state
            .artwork_cache
            .lock()
            .map_err(|_| "The Windows artwork cache is unavailable.".to_string())?;
        if let Some(index) = cache.iter().position(|(key, _)| key == &lookup_url) {
            let entry = cache
                .remove(index)
                .expect("cached artwork index was present");
            let artwork = entry.1.clone();
            cache.push_back(entry);
            return Ok(Some(artwork));
        }
        Ok(None)
    })
    .await?
    {
        return Ok(artwork);
    }

    let bytes = fetch_system_media_artwork(url).await?;
    let artwork =
        tauri::async_runtime::spawn_blocking(move || system_media::artwork_from_bytes(&bytes))
            .await
            .map_err(|error| format!("Could not prepare system media artwork: {error}"))??;
    let cache_app = app.clone();
    let cached_url = url.to_string();
    let cached_artwork = artwork.clone();
    spawn_system_media_blocking(cache_app, move |_, state| {
        let mut cache = state
            .artwork_cache
            .lock()
            .map_err(|_| "The Windows artwork cache is unavailable.".to_string())?;
        if cache.len() >= MAX_SYSTEM_MEDIA_ARTWORK_CACHE {
            cache.pop_front();
        }
        cache.push_back((cached_url, cached_artwork));
        Ok(())
    })
    .await?;
    Ok(artwork)
}

pub(super) async fn fetch_system_media_artwork(url: &str) -> Result<Vec<u8>, String> {
    let url = Url::parse(url).map_err(|_| "The system media artwork URL is invalid.")?;
    let response = send_bandcamp_request(
        http_client()?
            .get(url)
            .header(reqwest::header::ACCEPT, "image/jpeg,image/png,image/webp"),
        "Bandcamp artwork",
        BandcampRetryPolicy::SafeRead,
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp artwork returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    if !matches!(
        content_type.as_deref(),
        Some("image/jpeg" | "image/png" | "image/webp")
    ) {
        return Err("Bandcamp artwork returned an unexpected content type.".into());
    }
    let bytes =
        read_bounded_response(response, MAX_SYSTEM_MEDIA_ARTWORK_BYTES, "Bandcamp artwork").await?;
    if !valid_system_media_artwork_bytes(&bytes) {
        return Err("Bandcamp artwork returned an unexpected image.".into());
    }
    Ok(bytes)
}

pub(super) fn valid_system_media_artwork_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.len() > MAX_SYSTEM_MEDIA_ARTWORK_BYTES {
        return false;
    }
    bytes.starts_with(&[0xff, 0xd8, 0xff])
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || (bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP")
}

// WinRT media-session calls can wait on Windows services. Keep every native
// session operation on the blocking pool so neither the window thread nor
// Tokio's async workers can be stalled by Windows.
pub(super) async fn spawn_system_media_blocking<T>(
    app: tauri::AppHandle,
    operation: impl FnOnce(&tauri::AppHandle, &SystemMediaState) -> Result<T, String> + Send + 'static,
) -> Result<T, String>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SystemMediaState>();
        operation(&app, &state)
    })
    .await
    .map_err(|error| format!("Could not update the system media session: {error}"))?
}

#[tauri::command]
pub(super) async fn update_system_media_playback(
    app: tauri::AppHandle,
    playing: bool,
) -> Result<(), String> {
    let generation = app
        .state::<SystemMediaState>()
        .playback_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    spawn_system_media_blocking(app, move |app, state| {
        with_system_media_session(
            app,
            state,
            || state.playback_generation.load(Ordering::SeqCst) == generation,
            |session| session.update_playback(playing),
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn update_system_media_timeline(
    app: tauri::AppHandle,
    position_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    if !position_seconds.is_finite()
        || position_seconds < 0.0
        || !duration_seconds.is_finite()
        || duration_seconds <= 0.0
        || duration_seconds > MAX_PLAYER_SECONDS
    {
        return Err("The system media timeline is invalid.".into());
    }
    let generation = app
        .state::<SystemMediaState>()
        .timeline_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    spawn_system_media_blocking(app, move |app, state| {
        with_system_media_session(
            app,
            state,
            || state.timeline_generation.load(Ordering::SeqCst) == generation,
            |session| session.update_timeline(position_seconds, duration_seconds),
        )
    })
    .await
}

pub(super) fn with_system_media_session(
    app: &tauri::AppHandle,
    state: &SystemMediaState,
    is_current: impl Fn() -> bool,
    update: impl FnOnce(&system_media::NativeMediaSession) -> Result<(), String>,
) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "The Windows media session is unavailable.".to_string())?;
    if !is_current() {
        return Ok(());
    }
    if session.is_none() {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "Coda's main window is unavailable for media controls.".to_string())?;
        system_media::set_window_app_user_model_id(&window)?;
        *session = Some(system_media::NativeMediaSession::new(&window, app.clone())?);
    }
    if !is_current() {
        return Ok(());
    }
    update(
        session
            .as_ref()
            .expect("system media session was initialized"),
    )
}
