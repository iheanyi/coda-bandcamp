use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
#[cfg(desktop)]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use url::Url;

const SERVICE_NAME: &str = "com.coda.bandcamp";
const CREDENTIAL_KEY: &str = "subsonic";
const SERVER_BASE: &str = "https://bandcamp.com/api/subsonic";
const DISCOVER_ENDPOINT: &str = "https://bandcamp.com/api/discover/1/discover_web";
const CLIENT_NAME: &str = "Coda";
const API_VERSION: &str = "1.16.1";
const MAX_CREDENTIAL_LENGTH: usize = 512;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const DISCOVER_PAGE_SIZE: usize = 40;
const MAX_DISCOVER_TAG_LENGTH: usize = 64;
const MAX_DISCOVER_CURSOR_LENGTH: usize = 2_048;

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInput {
    username: String,
    password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Album {
    id: String,
    title: String,
    artist: String,
    song_count: u64,
    duration: u64,
    cover_art: Option<String>,
    year: Option<u64>,
    genre: Option<String>,
    added_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    title: String,
    artist: String,
    album: String,
    album_id: String,
    duration: u64,
    track: u64,
    disc: Option<u64>,
    cover_art: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverInput {
    tag: String,
    sort: String,
    cursor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverPage {
    results: Vec<DiscoverRelease>,
    result_count: u64,
    cursor: Option<String>,
    has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverRelease {
    id: String,
    title: String,
    artist: String,
    genre: Option<String>,
    location: Option<String>,
    item_url: String,
    artwork_url: Option<String>,
    featured_track: Option<DiscoverTrack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverTrack {
    id: String,
    title: String,
    duration: u64,
    stream_url: String,
}

#[derive(Debug, Deserialize)]
struct RawDiscoverPage {
    #[serde(default)]
    results: Vec<RawDiscoverRelease>,
    #[serde(default)]
    result_count: u64,
    cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawDiscoverRelease {
    item_id: Value,
    #[serde(default)]
    title: String,
    #[serde(default)]
    item_url: String,
    album_artist: Option<String>,
    band_name: Option<String>,
    band_location: Option<String>,
    genre: Option<String>,
    primary_image: Option<RawDiscoverImage>,
    featured_track: Option<RawDiscoverTrack>,
}

#[derive(Debug, Deserialize)]
struct RawDiscoverImage {
    image_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawDiscoverTrack {
    id: Value,
    #[serde(default)]
    title: String,
    stream_url: Option<String>,
    duration: Option<f64>,
}

#[derive(Serialize)]
struct DiscoverRequest<'a> {
    category_id: u8,
    tag_norm_names: Vec<&'a str>,
    geoname_id: u8,
    slice: &'a str,
    time_facet_id: Option<u8>,
    cursor: &'a str,
    size: usize,
    include_result_types: [&'a str; 2],
    followed_bands: bool,
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, CREDENTIAL_KEY)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

fn validate_credentials(input: &ConnectionInput) -> Result<(), String> {
    let username = input.username.trim();
    if username.is_empty() || input.password.is_empty() {
        return Err("Both the generated username and password are required.".into());
    }
    if username.len() > MAX_CREDENTIAL_LENGTH || input.password.len() > MAX_CREDENTIAL_LENGTH {
        return Err("The supplied credentials are unexpectedly long.".into());
    }
    if username.chars().any(char::is_control) || input.password.chars().any(char::is_control) {
        return Err("Credentials cannot contain control characters.".into());
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_LENGTH
        || value.chars().any(|character| character.is_control())
    {
        return Err("Bandcamp returned an invalid media identifier.".into());
    }
    Ok(())
}

fn validate_discover_input(input: &DiscoverInput) -> Result<(), String> {
    let tag = input.tag.trim();
    if tag.len() > MAX_DISCOVER_TAG_LENGTH || tag.chars().any(char::is_control) {
        return Err("The Discover tag is invalid.".into());
    }
    if !matches!(input.sort.as_str(), "top" | "new") {
        return Err("The Discover sort mode is invalid.".into());
    }
    if input.cursor.is_empty()
        || input.cursor.len() > MAX_DISCOVER_CURSOR_LENGTH
        || input.cursor.chars().any(char::is_control)
    {
        return Err("The Discover cursor is invalid.".into());
    }
    Ok(())
}

fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn allowed_url(value: &str, host_kind: &str) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    let allowed = match host_kind {
        "bandcamp" => host == "bandcamp.com" || host.ends_with(".bandcamp.com"),
        "media" => host == "bcbits.com" || host.ends_with(".bcbits.com"),
        _ => false,
    };
    allowed.then(|| parsed.to_string())
}

fn discover_release_from_raw(value: RawDiscoverRelease) -> Option<DiscoverRelease> {
    let id = value_id(&value.item_id)?;
    let item_url = allowed_url(&value.item_url, "bandcamp")?;
    let title = if value.title.trim().is_empty() {
        "Untitled release".into()
    } else {
        value.title.trim().to_string()
    };
    let artist = value
        .album_artist
        .or(value.band_name)
        .filter(|artist| !artist.trim().is_empty())
        .unwrap_or_else(|| "Unknown artist".into());
    let artwork_url = value
        .primary_image
        .and_then(|image| image.image_id)
        .map(|image_id| format!("https://f4.bcbits.com/img/a{image_id}_10.jpg"));
    let featured_track = value.featured_track.and_then(|track| {
        let id = value_id(&track.id)?;
        let stream_url = allowed_url(track.stream_url.as_deref()?, "media")?;
        Some(DiscoverTrack {
            id: format!("discover:{id}"),
            title: if track.title.trim().is_empty() {
                "Featured track".into()
            } else {
                track.title.trim().to_string()
            },
            duration: track.duration.unwrap_or_default().max(0.0).round() as u64,
            stream_url,
        })
    });

    Some(DiscoverRelease {
        id: format!("discover:{id}"),
        title,
        artist,
        genre: value.genre.filter(|genre| !genre.trim().is_empty()),
        location: value
            .band_location
            .filter(|location| !location.trim().is_empty()),
        item_url,
        artwork_url,
        featured_track,
    })
}

fn load_credentials() -> Result<ConnectionInput, String> {
    let serialized = credential_entry()?
        .get_password()
        .map_err(|_| "Bandcamp is not connected yet.".to_string())?;
    serde_json::from_str(&serialized)
        .map_err(|_| "The stored Bandcamp credentials could not be read.".to_string())
}

fn store_credentials(input: &ConnectionInput) -> Result<(), String> {
    validate_credentials(input)?;
    let serialized = serde_json::to_string(input)
        .map_err(|error| format!("Could not prepare credentials for secure storage: {error}"))?;
    credential_entry()?
        .set_password(&serialized)
        .map_err(|error| {
            format!("Could not save credentials in the system credential store: {error}")
        })
}

fn http_client() -> Result<&'static Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(25))
                .user_agent("Coda/0.1 (+https://bandcamp.com)")
                .redirect(Policy::custom(|attempt| {
                    let allowed = attempt
                        .url()
                        .host_str()
                        .map(|host| host == "bandcamp.com" || host.ends_with(".bcbits.com"))
                        .unwrap_or(false);
                    if allowed && attempt.previous().len() < 3 {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .build()
                .map_err(|error| format!("Could not initialize the secure network client: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn authenticated_url(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(&str, String)],
) -> Result<Url, String> {
    let salt: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    let token = format!(
        "{:x}",
        md5::compute(format!("{}{}", credentials.password, salt))
    );
    let mut url = Url::parse(&format!("{SERVER_BASE}/rest/{endpoint}.view"))
        .map_err(|_| "The built-in Bandcamp server URL is invalid.".to_string())?;

    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("u", credentials.username.trim())
            .append_pair("t", &token)
            .append_pair("s", &salt)
            .append_pair("v", API_VERSION)
            .append_pair("c", CLIENT_NAME)
            .append_pair("f", "json");
        for (key, value) in extra {
            query.append_pair(key, value);
        }
    }
    Ok(url)
}

async fn request_json(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(&str, String)],
) -> Result<Value, String> {
    let url = authenticated_url(endpoint, credentials, extra)?;
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach Bandcamp: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    if response
        .content_length()
        .is_some_and(|length| length > MAX_JSON_RESPONSE_BYTES as u64)
    {
        return Err("Bandcamp returned an unexpectedly large response.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Bandcamp returned an unreadable response.".to_string())?;
    if bytes.len() > MAX_JSON_RESPONSE_BYTES {
        return Err("Bandcamp returned an unexpectedly large response.".into());
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Bandcamp returned an unreadable response.".to_string())?;
    let envelope = body
        .get("subsonic-response")
        .ok_or_else(|| "Bandcamp returned an unexpected response.".to_string())?;
    if envelope.get("status").and_then(Value::as_str) != Some("ok") {
        let message = envelope
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Bandcamp rejected the request.");
        return Err(message.to_string());
    }
    Ok(body)
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_string)
}

fn number_field(value: &Value, key: &str) -> Option<u64> {
    value
        .get(key)
        .and_then(|item| item.as_u64().or_else(|| item.as_str()?.parse().ok()))
}

fn album_from_value(value: &Value) -> Option<Album> {
    let id = string_field(value, &["id"])?;
    let title = string_field(value, &["name", "album", "title"])
        .unwrap_or_else(|| "Untitled release".into());
    Some(Album {
        id,
        title,
        artist: string_field(value, &["artist"]).unwrap_or_else(|| "Unknown artist".into()),
        song_count: number_field(value, "songCount").unwrap_or(0),
        duration: number_field(value, "duration").unwrap_or(0),
        cover_art: string_field(value, &["coverArt"]),
        year: number_field(value, "year"),
        genre: string_field(value, &["genre"]),
        added_at: string_field(value, &["created"]),
    })
}

fn track_from_value(value: &Value, fallback_album_id: &str) -> Option<Track> {
    let id = string_field(value, &["id"])?;
    Some(Track {
        id,
        title: string_field(value, &["title"]).unwrap_or_else(|| "Untitled track".into()),
        artist: string_field(value, &["artist"]).unwrap_or_else(|| "Unknown artist".into()),
        album: string_field(value, &["album"]).unwrap_or_else(|| "Unknown release".into()),
        album_id: string_field(value, &["albumId"]).unwrap_or_else(|| fallback_album_id.into()),
        duration: number_field(value, "duration").unwrap_or(0),
        track: number_field(value, "track").unwrap_or(0),
        disc: number_field(value, "discNumber"),
        cover_art: string_field(value, &["coverArt"]),
    })
}

#[tauri::command]
fn has_connection() -> bool {
    credential_entry()
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok()
}

#[tauri::command]
fn disconnect() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove credentials: {error}")),
    }
}

async fn fetch_library_with_credentials(
    credentials: &ConnectionInput,
) -> Result<Vec<Album>, String> {
    let mut albums = Vec::new();

    for page in 0..10_u64 {
        let offset = page * 500;
        let body = request_json(
            "getAlbumList2",
            credentials,
            &[
                ("type", "alphabeticalByArtist".into()),
                ("size", "500".into()),
                ("offset", offset.to_string()),
            ],
        )
        .await?;
        let items = body
            .pointer("/subsonic-response/albumList2/album")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let item_count = items.len();
        albums.extend(items.iter().filter_map(album_from_value));
        if item_count < 500 {
            break;
        }
    }
    Ok(albums)
}

fn connection_error(error: String) -> String {
    if error.contains("HTTP 500") {
        "Bandcamp could not authenticate those generated credentials. Generate a new pair in Fan Settings and try again; Bandcamp's Subsonic service is still in beta.".to_string()
    } else {
        error
    }
}

#[tauri::command]
async fn connect(input: ConnectionInput) -> Result<Vec<Album>, String> {
    validate_credentials(&input)?;
    let albums = fetch_library_with_credentials(&input)
        .await
        .map_err(connection_error)?;
    store_credentials(&input)?;

    let stored = load_credentials().map_err(|error| {
        format!("Credentials were accepted but could not be verified in the system vault: {error}")
    })?;
    if stored.username != input.username || stored.password != input.password {
        let _ = disconnect();
        return Err(
            "Credentials were accepted but the system vault did not return the saved connection."
                .into(),
        );
    }

    Ok(albums)
}

#[tauri::command]
async fn fetch_library() -> Result<Vec<Album>, String> {
    let credentials = load_credentials()?;
    fetch_library_with_credentials(&credentials).await
}

#[tauri::command]
async fn fetch_album(album_id: String) -> Result<Vec<Track>, String> {
    validate_identifier(&album_id)?;
    let credentials = load_credentials()?;
    let body = request_json("getAlbum", &credentials, &[("id", album_id.clone())]).await?;
    let songs = body
        .pointer("/subsonic-response/album/song")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    Ok(songs
        .iter()
        .filter_map(|value| track_from_value(value, &album_id))
        .collect())
}

#[tauri::command]
fn get_stream_url(track_id: String) -> Result<String, String> {
    validate_identifier(&track_id)?;
    let credentials = load_credentials()?;
    Ok(authenticated_url(
        "stream",
        &credentials,
        &[("id", track_id), ("format", "raw".into())],
    )?
    .to_string())
}

#[tauri::command]
fn get_cover_url(cover_art_id: String) -> Result<String, String> {
    validate_identifier(&cover_art_id)?;
    let credentials = load_credentials()?;
    Ok(authenticated_url(
        "getCoverArt",
        &credentials,
        &[("id", cover_art_id), ("size", "600".into())],
    )?
    .to_string())
}

#[tauri::command]
async fn discover(input: DiscoverInput) -> Result<DiscoverPage, String> {
    validate_discover_input(&input)?;
    let normalized_tag = input.tag.trim().to_ascii_lowercase();
    let tags = if normalized_tag.is_empty() {
        Vec::new()
    } else {
        vec![normalized_tag.as_str()]
    };
    let request = DiscoverRequest {
        category_id: 0,
        tag_norm_names: tags,
        geoname_id: 0,
        slice: &input.sort,
        time_facet_id: None,
        cursor: &input.cursor,
        size: DISCOVER_PAGE_SIZE,
        include_result_types: ["a", "s"],
        followed_bands: false,
    };
    let response = http_client()?
        .post(DISCOVER_ENDPOINT)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("Could not reach Bandcamp Discover: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp Discover returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_JSON_RESPONSE_BYTES as u64)
    {
        return Err("Bandcamp Discover returned an unexpectedly large response.".into());
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
    {
        return Err("Bandcamp Discover returned an unexpected content type.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Bandcamp Discover returned an unreadable response.".to_string())?;
    if bytes.len() > MAX_JSON_RESPONSE_BYTES {
        return Err("Bandcamp Discover returned an unexpectedly large response.".into());
    }
    let body: RawDiscoverPage = serde_json::from_slice(&bytes)
        .map_err(|_| "Bandcamp Discover returned an unexpected response.".to_string())?;
    let cursor = body.cursor.filter(|cursor| {
        !cursor.is_empty()
            && cursor.len() <= MAX_DISCOVER_CURSOR_LENGTH
            && !cursor.chars().any(char::is_control)
    });
    let results = body
        .results
        .into_iter()
        .take(DISCOVER_PAGE_SIZE)
        .filter_map(discover_release_from_raw)
        .collect::<Vec<_>>();
    let has_more = cursor.is_some() && !results.is_empty();
    Ok(DiscoverPage {
        results,
        result_count: body.result_count,
        cursor,
        has_more,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_window_state::Builder::default()
                        .with_state_flags(
                            StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED,
                        )
                        .build(),
                )?;
                ensure_window_is_visible(app);

                let show = MenuItem::with_id(app, "show", "Show Coda", true, None::<&str>)?;
                let play_pause =
                    MenuItem::with_id(app, "play-pause", "Play / Pause", true, None::<&str>)?;
                let previous =
                    MenuItem::with_id(app, "previous", "Previous Track", true, None::<&str>)?;
                let next = MenuItem::with_id(app, "next", "Next Track", true, None::<&str>)?;
                let shuffle = MenuItem::with_id(
                    app,
                    "shuffle-library",
                    "Shuffle Entire Library",
                    true,
                    None::<&str>,
                )?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = MenuItem::with_id(app, "quit", "Quit Coda", true, None::<&str>)?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &show,
                        &separator,
                        &play_pause,
                        &previous,
                        &next,
                        &shuffle,
                        &PredefinedMenuItem::separator(app)?,
                        &quit,
                    ],
                )?;

                TrayIconBuilder::with_id("coda-tray")
                    .icon(
                        app.default_window_icon()
                            .cloned()
                            .ok_or("Coda's tray icon is unavailable.")?,
                    )
                    .tooltip("Coda")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "play-pause" | "previous" | "next" | "shuffle-library" => {
                            let _ = app.emit("coda://tray-control", event.id().as_ref());
                        }
                        "quit" => {
                            let _ = app.save_window_state(
                                StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED,
                            );
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            has_connection,
            connect,
            disconnect,
            fetch_library,
            fetch_album,
            get_stream_url,
            get_cover_url,
            discover
        ])
        .run(tauri::generate_context!())
        .expect("error while running Coda");
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn overlaps_monitor(window: [i32; 4], monitor: [i32; 4]) -> bool {
    let [window_x, window_y, window_width, window_height] = window;
    let [monitor_x, monitor_y, monitor_width, monitor_height] = monitor;
    let overlap_width = (window_x.saturating_add(window_width))
        .min(monitor_x.saturating_add(monitor_width))
        - window_x.max(monitor_x);
    let overlap_height = (window_y.saturating_add(window_height))
        .min(monitor_y.saturating_add(monitor_height))
        - window_y.max(monitor_y);
    overlap_width >= 80 && overlap_height >= 40
}

#[cfg(desktop)]
fn ensure_window_is_visible(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let width = i32::try_from(size.width).unwrap_or(i32::MAX);
    let height = i32::try_from(size.height).unwrap_or(i32::MAX);
    let is_visible = monitors.iter().any(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_width = i32::try_from(monitor_size.width).unwrap_or(i32::MAX);
        let monitor_height = i32::try_from(monitor_size.height).unwrap_or(i32::MAX);
        overlaps_monitor(
            [position.x, position.y, width, height],
            [
                monitor_position.x,
                monitor_position.y,
                monitor_width,
                monitor_height,
            ],
        )
    });
    if is_visible {
        return;
    }

    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned());
    if let Some(monitor) = target {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let centered_x = monitor_position.x
            + (i32::try_from(monitor_size.width).unwrap_or(width) - width).max(0) / 2;
        let centered_y = monitor_position.y
            + (i32::try_from(monitor_size.height).unwrap_or(height) - height).max(0) / 2;
        let _ = window.set_position(tauri::PhysicalPosition::new(centered_x, centered_y));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_control_characters_in_credentials() {
        let input = ConnectionInput {
            username: "hello\nworld".into(),
            password: "secret".into(),
        };
        assert!(validate_credentials(&input).is_err());
    }

    #[test]
    fn constructs_only_bandcamp_https_urls() {
        let input = ConnectionInput {
            username: "fan".into(),
            password: "secret".into(),
        };
        let url = authenticated_url("ping", &input, &[]).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("bandcamp.com"));
        assert_eq!(url.path(), "/api/subsonic/rest/ping.view");
        assert!(!url.as_str().contains("secret"));
    }

    #[test]
    fn parses_flexible_numeric_fields() {
        let value = serde_json::json!({"duration": "42"});
        assert_eq!(number_field(&value, "duration"), Some(42));
    }

    #[test]
    fn validates_discover_inputs() {
        assert!(validate_discover_input(&DiscoverInput {
            tag: "ambient".into(),
            sort: "top".into(),
            cursor: "*".into(),
        })
        .is_ok());
        assert!(validate_discover_input(&DiscoverInput {
            tag: "ambient".into(),
            sort: "oldest".into(),
            cursor: "*".into(),
        })
        .is_err());
    }

    #[test]
    fn discover_urls_are_host_restricted() {
        assert!(allowed_url("https://artist.bandcamp.com/album/example", "bandcamp").is_some());
        assert!(allowed_url("https://t4.bcbits.com/stream/example", "media").is_some());
        assert!(allowed_url("https://evil.example/album/example", "bandcamp").is_none());
        assert!(allowed_url("http://artist.bandcamp.com/album/example", "bandcamp").is_none());
    }

    #[test]
    fn parses_the_public_discover_shape() {
        let raw: RawDiscoverPage = serde_json::from_value(serde_json::json!({
            "results": [{
                "item_id": 42,
                "title": "Night Drive",
                "item_url": "https://artist.bandcamp.com/album/night-drive?from=discover_page",
                "band_name": "Artist",
                "band_location": "Chicago, Illinois",
                "primary_image": { "image_id": 99 },
                "featured_track": {
                    "id": 7,
                    "title": "Headlights",
                    "stream_url": "https://t4.bcbits.com/stream/example",
                    "duration": 183.5
                }
            }],
            "result_count": 1,
            "cursor": "next"
        }))
        .unwrap();
        let release = discover_release_from_raw(raw.results.into_iter().next().unwrap()).unwrap();
        assert_eq!(release.id, "discover:42");
        assert_eq!(release.artist, "Artist");
        assert_eq!(release.featured_track.unwrap().duration, 184);
        assert_eq!(
            release.artwork_url.as_deref(),
            Some("https://f4.bcbits.com/img/a99_10.jpg")
        );
    }

    #[cfg(desktop)]
    #[test]
    fn recognizes_windows_on_monitors_with_negative_coordinates() {
        assert!(overlaps_monitor(
            [-1_500, 120, 1_000, 700],
            [-1_920, 0, 1_920, 1_080]
        ));
        assert!(!overlaps_monitor(
            [4_000, 2_000, 1_000, 700],
            [-1_920, 0, 1_920, 1_080]
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn uses_the_native_windows_credential_backend() {
        let entry = credential_entry().unwrap();
        assert!(entry
            .get_credential()
            .downcast_ref::<keyring::windows::WinCredential>()
            .is_some());
    }
}
