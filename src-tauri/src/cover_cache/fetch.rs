use super::store::{
    cached_entry, content_revision, cover_cache_key, entry_path, read_cached_bytes, record_access,
    remove_file_if_exists, remove_indexed_entry, select_evictions, write_index, CoverCacheEntry,
    MAX_COVER_ART_BYTES, MAX_COVER_DIMENSION, MAX_COVER_PIXELS,
};
use super::{
    cover_cache_publication_guard, ensure_authorized, next_cover_ordering_sequence,
    publication_is_current, runtime_authorizes, state_from_app, CoverArtInvalidationReceipt,
    CoverArtUpdatedPayload, CoverCacheInner, ResolvedCoverArt,
};
use crate::bandcamp_http::{
    send_bandcamp_request_with_priority, BandcampRequestPriority, BandcampRetryPolicy,
};
use crate::models::ConnectionInput;
use crate::storage::{timestamp_ms, write_bytes_atomically};
use crate::subsonic::{
    authenticated_url, current_connection_generation, load_credentials, load_credentials_async,
};
use crate::url_policy::{allowed_url, UrlKind};
use reqwest::{redirect::Policy, Client};
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;

const MAX_COVER_REDIRECTS: usize = 10;
const COVER_UPDATED_EVENT: &str = "coda://cover-art-updated";

static COVER_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CoverMediaType {
    Jpeg,
    Png,
    Webp,
}

impl CoverMediaType {
    fn media_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
}

struct ValidatedCover<'a> {
    bytes: &'a [u8],
    media_type: CoverMediaType,
    width: u32,
    height: u32,
}

struct CoverPublication {
    entry: CoverCacheEntry,
    persisted: bool,
    event_sequence: Option<u64>,
}

fn cover_http_client() -> Result<&'static Client, String> {
    COVER_HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(25))
                .user_agent("Coda/0.1 (+https://bandcamp.com)")
                .redirect(Policy::custom(|attempt| {
                    if cover_redirect_target_is_allowed(attempt.url(), attempt.previous().len()) {
                        attempt.follow()
                    } else if attempt.previous().len() > MAX_COVER_REDIRECTS {
                        attempt.error("too many cover artwork redirects")
                    } else {
                        attempt.stop()
                    }
                }))
                .build()
                .map_err(|_| "Could not initialize the cover artwork client.".to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub(crate) fn cover_redirect_target_is_allowed(target: &url::Url, redirect_count: usize) -> bool {
    if redirect_count > MAX_COVER_REDIRECTS {
        return false;
    }
    let bandcamp_page = allowed_url(target.as_str(), UrlKind::BandcampPage).is_some();
    let bandcamp_media = allowed_url(target.as_str(), UrlKind::BandcampMedia).is_some();
    if !bandcamp_page && !bandcamp_media {
        return false;
    }
    !target.query_pairs().any(|(key, _)| {
        key.eq_ignore_ascii_case("u")
            || key.eq_ignore_ascii_case("t")
            || (bandcamp_page && key.eq_ignore_ascii_case("s"))
    })
}

pub(crate) fn media_type_from_header(value: &str) -> Option<CoverMediaType> {
    match value
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" => Some(CoverMediaType::Jpeg),
        "image/png" => Some(CoverMediaType::Png),
        "image/webp" => Some(CoverMediaType::Webp),
        _ => None,
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

pub(crate) fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[..2] != [0xff, 0xd8] {
        return None;
    }
    let mut offset = 2;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xff {
            return None;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if matches!(marker, 0xd8 | 0xd9 | 0x01) || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = usize::from(u16::from_be_bytes([
            *bytes.get(offset)?,
            *bytes.get(offset + 1)?,
        ]));
        if length < 2 || offset + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            if length < 7 {
                return None;
            }
            return Some((
                u32::from(u16::from_be_bytes([
                    *bytes.get(offset + 5)?,
                    *bytes.get(offset + 6)?,
                ])),
                u32::from(u16::from_be_bytes([
                    *bytes.get(offset + 3)?,
                    *bytes.get(offset + 4)?,
                ])),
            ));
        }
        offset += length;
    }
    None
}

pub(crate) fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]);
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]);
            Some((width, height))
        }
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes([bytes[21], bytes[22], bytes[23], bytes[24]]);
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        b"VP8 " if bytes.len() >= 30 && bytes[23..26] == [0x9d, 0x01, 0x2a] => Some((
            u32::from(u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff),
            u32::from(u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3fff),
        )),
        _ => None,
    }
}

pub(crate) fn validate_image(
    bytes: &[u8],
    declared_media_type: CoverMediaType,
) -> Result<(u32, u32), String> {
    if bytes.is_empty() || bytes.len() > MAX_COVER_ART_BYTES {
        return Err("Bandcamp returned an invalid cover artwork size.".into());
    }
    let dimensions = match declared_media_type {
        CoverMediaType::Jpeg => jpeg_dimensions(bytes),
        CoverMediaType::Png => png_dimensions(bytes),
        CoverMediaType::Webp => webp_dimensions(bytes),
    }
    .ok_or_else(|| "Bandcamp returned invalid cover artwork bytes.".to_string())?;
    if dimensions.0 == 0
        || dimensions.1 == 0
        || dimensions.0 > MAX_COVER_DIMENSION
        || dimensions.1 > MAX_COVER_DIMENSION
        || u64::from(dimensions.0) * u64::from(dimensions.1) > MAX_COVER_PIXELS
    {
        return Err("Bandcamp returned unsafe cover artwork dimensions.".into());
    }
    Ok(dimensions)
}

pub(crate) fn cover_art_url(
    cover_art_id: &str,
    credentials: &ConnectionInput,
) -> Result<url::Url, String> {
    authenticated_url(
        "getCoverArt",
        credentials,
        &[("id", cover_art_id.to_string()), ("size", "600".into())],
    )
}

pub(crate) async fn validate_cover_response(
    mut response: reqwest::Response,
) -> Result<(Vec<u8>, CoverMediaType, u32, u32), String> {
    if response.status().is_redirection() {
        return Err("Bandcamp cover artwork redirected unexpectedly.".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp cover artwork returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let declared_length = response.content_length();
    if declared_length.is_some_and(|length| length > MAX_COVER_ART_BYTES as u64) {
        return Err("Bandcamp returned unexpectedly large cover artwork.".into());
    }
    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(media_type_from_header)
        .ok_or_else(|| "Bandcamp returned an unsupported cover artwork type.".to_string())?;
    let mut bytes = Vec::with_capacity(
        declared_length
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or_default(),
    );
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        format!(
            "Bandcamp cover artwork was unreadable: {}",
            error.without_url()
        )
    })? {
        if chunk.len() > MAX_COVER_ART_BYTES.saturating_sub(bytes.len()) {
            return Err("Bandcamp returned unexpectedly large cover artwork.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if declared_length.is_some_and(|length| length != bytes.len() as u64) {
        return Err("Bandcamp returned truncated cover artwork.".into());
    }
    let (width, height) = validate_image(&bytes, media_type)?;
    Ok((bytes, media_type, width, height))
}

async fn fetch_cover_bytes(
    cover_art_id: &str,
    credentials: &ConnectionInput,
    priority: BandcampRequestPriority,
) -> Result<(Vec<u8>, CoverMediaType, u32, u32), String> {
    let request = cover_http_client()?.get(cover_art_url(cover_art_id, credentials)?);
    let response = if cover_request_uses_shared_coordinator(priority) {
        send_bandcamp_request_with_priority(
            request,
            "Bandcamp cover artwork",
            BandcampRetryPolicy::SafeRead,
            priority,
        )
        .await?
    } else {
        // Foreground artwork is already requested just in time by the WebView.
        // Starting it immediately avoids stale offscreen requests forming a
        // FIFO queue in front of the user's current viewport.
        request.send().await.map_err(|error| {
            format!(
                "Could not reach Bandcamp cover artwork: {}",
                error.without_url()
            )
        })?
    };
    validate_cover_response(response).await
}

pub(crate) fn cover_request_uses_shared_coordinator(priority: BandcampRequestPriority) -> bool {
    matches!(priority, BandcampRequestPriority::Background)
}

fn key_lock(state: &CoverCacheInner, key: &str) -> Result<Arc<AsyncMutex<()>>, String> {
    let mut locks = state
        .key_locks
        .lock()
        .map_err(|_| "The cover artwork request state is unavailable.".to_string())?;
    Ok(locks
        .entry(key.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone())
}

pub(crate) fn release_key_lock(
    locks: &Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    key: &str,
    lock: &Arc<AsyncMutex<()>>,
) -> Result<(), String> {
    let mut locks = locks
        .lock()
        .map_err(|_| "The cover artwork request state is unavailable.".to_string())?;
    if Arc::strong_count(lock) == 2
        && locks
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, lock))
    {
        locks.remove(key);
    }
    Ok(())
}

fn publish_cover(
    state: &CoverCacheInner,
    cover_art_id: &str,
    generation: u64,
    expected_credentials: &ConnectionInput,
    cover: ValidatedCover<'_>,
) -> Result<CoverPublication, String> {
    let _publication_guard = cover_cache_publication_guard()?;
    let key = cover_cache_key(cover_art_id)?;
    let revision = content_revision(cover.bytes);
    let now = timestamp_ms()?;
    let current_credentials = load_credentials().ok();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    if runtime.generation != generation
        || !publication_is_current(
            runtime_authorizes(
                &runtime,
                cover_art_id,
                runtime.generation,
                current_connection_generation(),
            ),
            expected_credentials,
            current_credentials.as_ref(),
        )
    {
        return Err("The Bandcamp connection changed while artwork was loading.".into());
    }
    if let Some(existing) = runtime.index.entries.get_mut(&key) {
        if existing.revision == revision {
            existing.validated_at = now;
            existing.last_access_at = now;
            let existing = existing.clone();
            write_index(&state.index_path, &runtime.index)?;
            return Ok(CoverPublication {
                entry: existing,
                persisted: true,
                event_sequence: None,
            });
        }
    }
    let ordering_sequence = next_cover_ordering_sequence(&mut runtime.ordering_sequence)?;

    let Some(evictions) = select_evictions(&runtime, &key, cover.bytes.len() as u64) else {
        let entry = CoverCacheEntry {
            key,
            revision,
            media_type: cover.media_type.media_type().into(),
            extension: cover.media_type.extension().into(),
            byte_length: cover.bytes.len() as u64,
            width: cover.width,
            height: cover.height,
            validated_at: now,
            last_access_at: now,
        };
        return Ok(CoverPublication {
            entry,
            persisted: false,
            event_sequence: Some(ordering_sequence),
        });
    };
    let entry = CoverCacheEntry {
        key: key.clone(),
        revision,
        media_type: cover.media_type.media_type().into(),
        extension: cover.media_type.extension().into(),
        byte_length: cover.bytes.len() as u64,
        width: cover.width,
        height: cover.height,
        validated_at: now,
        last_access_at: now,
    };
    let new_path = entry_path(&state.cache_directory, &entry);
    write_bytes_atomically(&new_path, cover.bytes, "cover artwork")?;

    let old_entry = runtime.index.entries.insert(key.clone(), entry.clone());
    let evicted_entries = evictions
        .iter()
        .filter_map(|key| runtime.index.entries.remove(key))
        .collect::<Vec<_>>();
    if let Err(error) = write_index(&state.index_path, &runtime.index) {
        if let Some(old) = old_entry {
            runtime.index.entries.insert(key, old);
        } else {
            runtime.index.entries.remove(&key);
        }
        for evicted in evicted_entries {
            runtime.index.entries.insert(evicted.key.clone(), evicted);
        }
        let _ = remove_file_if_exists(&new_path);
        return Err(error);
    }
    if let Some(old) = old_entry {
        if old.revision != entry.revision {
            let _ = remove_file_if_exists(&entry_path(&state.cache_directory, &old));
        }
    }
    for evicted in evicted_entries {
        let _ = remove_file_if_exists(&entry_path(&state.cache_directory, &evicted));
    }
    Ok(CoverPublication {
        entry,
        persisted: true,
        event_sequence: Some(ordering_sequence),
    })
}

async fn fetch_and_publish(
    app: &AppHandle,
    cover_art_id: &str,
    priority: BandcampRequestPriority,
    generation: u64,
) -> Result<ResolvedCoverArt, String> {
    let state = state_from_app(app)?;
    ensure_authorized(&state, cover_art_id, generation)?;
    let background_permit = if priority == BandcampRequestPriority::Background {
        Some(
            state
                .background_fetches
                .acquire()
                .await
                .map_err(|_| "The cover artwork scheduler is unavailable.".to_string())?,
        )
    } else {
        None
    };
    ensure_authorized(&state, cover_art_id, generation)?;
    let credentials = load_credentials_async().await?;
    ensure_authorized(&state, cover_art_id, generation)?;
    let (bytes, media_type, width, height) =
        fetch_cover_bytes(cover_art_id, &credentials, priority).await?;
    drop(background_permit);
    let publish_state = state.clone();
    let publish_id = cover_art_id.to_string();
    let publish_credentials = credentials.clone();
    let publish_bytes = bytes.clone();
    let publication = tauri::async_runtime::spawn_blocking(move || {
        publish_cover(
            &publish_state,
            &publish_id,
            generation,
            &publish_credentials,
            ValidatedCover {
                bytes: &publish_bytes,
                media_type,
                width,
                height,
            },
        )
    })
    .await
    .map_err(|error| format!("Could not finish caching cover artwork: {error}"))??;
    if current_connection_generation() != generation {
        return Err("The Bandcamp connection changed while artwork was being cached.".into());
    }
    if let Some(sequence) = publication.event_sequence {
        // Emission can invoke platform code, so all publication/cache locks are
        // released first. The sequence makes delayed delivery harmless.
        let _ = app.emit(
            COVER_UPDATED_EVENT,
            CoverArtUpdatedPayload::from_sequence(
                cover_art_id.to_string(),
                publication.entry.revision.clone(),
                sequence,
            ),
        );
    }
    if publication.persisted {
        record_access(state.clone(), &publication.entry.key).await;
    }
    Ok(ResolvedCoverArt {
        bytes,
        media_type: publication.entry.media_type,
        revision: publication.entry.revision,
    })
}

async fn revalidate_cover(app: AppHandle, cover_art_id: String) {
    let Ok(state) = state_from_app(&app) else {
        return;
    };
    let Ok(key) = cover_cache_key(&cover_art_id) else {
        return;
    };
    let Ok(lock) = key_lock(&state, &key) else {
        return;
    };
    let Ok(guard) = lock.try_lock() else {
        return;
    };
    let generation = current_connection_generation();
    let _ = fetch_and_publish(
        &app,
        &cover_art_id,
        BandcampRequestPriority::Background,
        generation,
    )
    .await;
    drop(guard);
    let _ = release_key_lock(&state.key_locks, &key, &lock);
}

fn read_authorized_cached_cover(
    state: Arc<CoverCacheInner>,
    cover_art_id: &str,
    generation: u64,
) -> Result<Option<(ResolvedCoverArt, bool, String)>, String> {
    let Some((entry, stale)) = cached_entry(&state, cover_art_id, generation)? else {
        return Ok(None);
    };
    match read_cached_bytes(state.clone(), &entry) {
        Ok(bytes) => Ok(Some((
            ResolvedCoverArt {
                bytes,
                media_type: entry.media_type,
                revision: entry.revision,
            },
            stale,
            entry.key,
        ))),
        Err(_) => {
            let _ = invalidate_entry_ordered(&state, cover_art_id, generation);
            Ok(None)
        }
    }
}

pub(crate) async fn resolve_cover_art_from_state<Fetch, FetchFuture>(
    state: Arc<CoverCacheInner>,
    cover_art_id: &str,
    generation: u64,
    fetch: Fetch,
) -> Result<(ResolvedCoverArt, bool), String>
where
    Fetch: FnOnce() -> FetchFuture,
    FetchFuture: Future<Output = Result<ResolvedCoverArt, String>>,
{
    ensure_authorized(&state, cover_art_id, generation)?;
    let key = cover_cache_key(cover_art_id)?;
    if let Some((resolved, stale, entry_key)) =
        read_authorized_cached_cover(state.clone(), cover_art_id, generation)?
    {
        record_access(state.clone(), &entry_key).await;
        return Ok((resolved, stale));
    }
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.miss_count = runtime.miss_count.saturating_add(1);
    }
    let lock = key_lock(&state, &key)?;
    let guard = lock.lock().await;
    let result = if let Some((resolved, stale, entry_key)) =
        read_authorized_cached_cover(state.clone(), cover_art_id, generation)?
    {
        record_access(state.clone(), &entry_key).await;
        Ok((resolved, stale))
    } else {
        fetch().await.map(|resolved| (resolved, false))
    };
    drop(guard);
    let _ = release_key_lock(&state.key_locks, &key, &lock);
    result
}

pub(crate) async fn resolve_cover_art(
    app: &AppHandle,
    cover_art_id: &str,
) -> Result<ResolvedCoverArt, String> {
    let state = state_from_app(app)?;
    let generation = current_connection_generation();
    let fetch_app = app.clone();
    let fetch_id = cover_art_id.to_string();
    let (resolved, enqueue_revalidation) = resolve_cover_art_from_state(
        state.clone(),
        cover_art_id,
        generation,
        move || async move {
            fetch_and_publish(
                &fetch_app,
                &fetch_id,
                BandcampRequestPriority::Foreground,
                generation,
            )
            .await
        },
    )
    .await?;
    if enqueue_revalidation {
        if let Ok(mut runtime) = state.runtime.lock() {
            runtime.stale_count = runtime.stale_count.saturating_add(1);
        }
        tauri::async_runtime::spawn(revalidate_cover(app.clone(), cover_art_id.to_string()));
    }
    Ok(resolved)
}

pub(crate) fn invalidate_entry_ordered(
    state: &CoverCacheInner,
    cover_art_id: &str,
    generation: u64,
) -> Result<CoverArtInvalidationReceipt, String> {
    let _publication_guard = cover_cache_publication_guard()?;
    let key = cover_cache_key(cover_art_id)?;
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    if !runtime_authorizes(
        &runtime,
        cover_art_id,
        generation,
        current_connection_generation(),
    ) {
        return Err("The requested cover artwork is not authorized for this connection.".into());
    }
    let sequence = next_cover_ordering_sequence(&mut runtime.ordering_sequence)?;
    remove_indexed_entry(state, &mut runtime, &key)?;
    Ok(CoverArtInvalidationReceipt::from_sequence(sequence))
}

#[tauri::command]
pub(crate) async fn invalidate_cover_art(
    app: AppHandle,
    cover_art_id: String,
) -> Result<CoverArtInvalidationReceipt, String> {
    let state = state_from_app(&app)?;
    let generation = current_connection_generation();
    ensure_authorized(&state, &cover_art_id, generation)?;
    let key = cover_cache_key(&cover_art_id)?;
    let lock = key_lock(&state, &key)?;
    let guard = lock.lock().await;
    let invalidation_state = state.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        invalidate_entry_ordered(&invalidation_state, &cover_art_id, generation)
    })
    .await
    .map_err(|error| format!("Could not finish invalidating cover artwork: {error}"))
    .and_then(|result| result);
    drop(guard);
    let _ = release_key_lock(&state.key_locks, &key, &lock);
    result
}
