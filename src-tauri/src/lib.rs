use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{redirect::Policy, Client};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
const RADIO_LIST_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/list";
const RADIO_SHOW_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/get";
const CLIENT_NAME: &str = "Coda";
const API_VERSION: &str = "1.16.1";
const MAX_CREDENTIAL_LENGTH: usize = 512;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_PLAYLISTS: usize = 5_000;
const MAX_PLAYLIST_TRACKS: usize = 25_000;
const MAX_PLAYLIST_MUTATION_ITEMS: usize = 5_000;
const MAX_PLAYLIST_NAME_LENGTH: usize = 256;
const MAX_PLAYLIST_COMMENT_LENGTH: usize = 4_096;
const MAX_SUBSONIC_TEXT_LENGTH: usize = 1_024;
const MAX_SUBSONIC_DURATION_SECONDS: u64 = 10 * 365 * 24 * 60 * 60;
const DISCOVER_PAGE_SIZE: usize = 40;
const MAX_DISCOVER_TAG_LENGTH: usize = 64;
const MAX_DISCOVER_CURSOR_LENGTH: usize = 2_048;
const MAX_RADIO_SHOWS: usize = 1_000;
const MAX_RADIO_CHAPTERS: usize = 256;
const MAX_RADIO_TEXT_LENGTH: usize = 4_096;
const MAX_RADIO_DURATION_SECONDS: f64 = 24.0 * 60.0 * 60.0;
const LASTFM_SERVICE_NAME: &str = "com.coda.lastfm";
const LASTFM_SESSION_KEY: &str = "session";
const LASTFM_API_ENDPOINT: &str = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_AUTH_ENDPOINT: &str = "https://www.last.fm/api/auth/";
// Last.fm's desktop protocol embeds these application credentials in the
// compiled client. Reading them from the build environment keeps the public
// source tree clean without adding a runtime configuration dependency.
const LASTFM_API_KEY: &str = match option_env!("CODA_LASTFM_API_KEY") {
    Some(value) => value,
    None => "",
};
const LASTFM_SHARED_SECRET: &str = match option_env!("CODA_LASTFM_SHARED_SECRET") {
    Some(value) => value,
    None => "",
};
const MAX_LASTFM_METADATA_LENGTH: usize = 1_024;
const MAX_LASTFM_RESPONSE_BYTES: usize = 1024 * 1024;
const PLAYER_STATE_VERSION: u8 = 1;
const PLAYER_STATE_CONTRACT_VERSION: u8 = 2;
const PLAYER_STATE_FILE: &str = "player-state.json";
const PLAYER_CHECKPOINT_FILE: &str = "player-state-checkpoint.json";
const MAX_PLAYER_STATE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PLAYER_CHECKPOINT_BYTES: usize = 16 * 1024;
const MAX_PLAYER_QUEUE_LENGTH: usize = 25_000;
const MAX_PLAYER_TEXT_LENGTH: usize = 1_024;
const MAX_PLAYER_SECONDS: f64 = 7.0 * 24.0 * 60.0 * 60.0;
const MAX_PLAYER_TRACK_NUMBER: u64 = 100_000;
const MAX_PLAYER_TIMESTAMP_MS: u64 = 8_640_000_000_000_000;
const MAX_RADIO_CHAPTER_KEY_LENGTH: usize = 128;

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static LASTFM_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static PLAYER_STATE_LOCK: Mutex<()> = Mutex::new(());

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
    album_artist: Option<String>,
    music_brainz_id: Option<String>,
    cover_art: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistSummary {
    id: String,
    name: String,
    comment: Option<String>,
    owner: Option<String>,
    public: Option<bool>,
    song_count: u64,
    duration: u64,
    created_at: Option<String>,
    changed_at: Option<String>,
    cover_art: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistDetail {
    id: String,
    name: String,
    comment: Option<String>,
    owner: Option<String>,
    public: Option<bool>,
    song_count: u64,
    duration: u64,
    created_at: Option<String>,
    changed_at: Option<String>,
    cover_art: Option<String>,
    tracks: Vec<Track>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlaylistUpdateInput {
    playlist_id: String,
    name: Option<String>,
    comment: Option<String>,
    public: Option<bool>,
    #[serde(default)]
    song_ids_to_add: Vec<String>,
    #[serde(default)]
    song_indexes_to_remove: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlayerStateTrack {
    id: String,
    title: String,
    artist: String,
    album: String,
    album_id: String,
    duration: u64,
    track: u64,
    disc: Option<u64>,
    cover_art: Option<String>,
    palette: [String; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LastFmPlaybackProgress {
    track_id: String,
    started_at: u64,
    listened_seconds: f64,
    last_position: f64,
    now_playing_sent: bool,
    scrobble_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RadioScrobbleProgress {
    show_track_id: String,
    active_chapter_key: Option<String>,
    chapter_started_at: u64,
    chapter_listened_seconds: f64,
    last_position: f64,
    chapter_now_playing_sent: bool,
    chapter_scrobble_state: String,
    show_started_at: u64,
    show_listened_seconds: f64,
    show_scrobble_state: String,
    scrobbled_chapter_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlayerStateSnapshot {
    version: u8,
    saved_at: u64,
    queue: Vec<PlayerStateTrack>,
    current_index: usize,
    position_seconds: f64,
    volume: f64,
    repeat_mode: String,
    queue_open: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_fm_progress: Option<LastFmPlaybackProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    radio_scrobble_progress: Option<RadioScrobbleProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlayerStateCheckpoint {
    current_index: usize,
    current_track_id: String,
    position_seconds: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_fm_progress: Option<LastFmPlaybackProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    radio_scrobble_progress: Option<RadioScrobbleProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LastFmSession {
    username: String,
    key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LastFmStatus {
    configured: bool,
    connected: bool,
    username: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LastFmAuthorization {
    authorization_url: String,
    token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LastFmTrackInput {
    artist: String,
    title: String,
    album: String,
    album_artist: Option<String>,
    music_brainz_id: Option<String>,
    duration: u64,
    track_number: u64,
    chosen_by_user: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LastFmScrobbleInput {
    track: LastFmTrackInput,
    timestamp: u64,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadioShowSummary {
    id: u64,
    subtitle: String,
    description: String,
    published_at: String,
    artwork_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadioShow {
    id: u64,
    title: String,
    subtitle: String,
    description: String,
    published_at: String,
    artwork_url: Option<String>,
    duration: u64,
    stream_url: String,
    chapters: Vec<RadioChapter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadioChapter {
    title: String,
    artist: String,
    album: Option<String>,
    timecode: u64,
    item_url: Option<String>,
    artist_url: Option<String>,
    album_url: Option<String>,
    artwork_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawRadioList {
    #[serde(default)]
    results: Vec<RawRadioSummary>,
}

#[derive(Debug, Deserialize)]
struct RawRadioSummary {
    id: u64,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    published_date: String,
    v2_image_id: Option<u64>,
    screen_image_id: Option<u64>,
    image_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawRadioShow {
    show_id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    published_date: String,
    show_v2_image_id: Option<u64>,
    show_screen_image_id: Option<u64>,
    show_image_id: Option<u64>,
    audio_duration: Option<f64>,
    #[serde(default)]
    audio_stream: BTreeMap<String, String>,
    #[serde(default)]
    tracks: Vec<RawRadioChapter>,
}

#[derive(Debug, Deserialize)]
struct RawRadioChapter {
    #[serde(default)]
    title: String,
    #[serde(default)]
    artist: String,
    album_title: Option<String>,
    timecode: Option<f64>,
    track_url: Option<String>,
    url: Option<String>,
    album_url: Option<String>,
    track_art_id: Option<u64>,
    url_hints: Option<RawRadioUrlHints>,
}

#[derive(Debug, Deserialize)]
struct RawRadioUrlHints {
    subdomain: Option<String>,
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

fn player_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(PLAYER_STATE_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

fn player_checkpoint_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(PLAYER_CHECKPOINT_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

fn valid_player_text(value: &str, required: bool) -> bool {
    value.len() <= MAX_PLAYER_TEXT_LENGTH
        && !value.chars().any(char::is_control)
        && (!required || !value.is_empty())
}

fn valid_player_seconds(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_PLAYER_SECONDS).contains(&value)
}

fn valid_radio_track_id(value: &str) -> bool {
    let Some(show_id) = value.strip_prefix("radio:") else {
        return true;
    };
    !show_id.is_empty()
        && show_id.len() <= 16
        && !show_id.starts_with('0')
        && show_id.chars().all(|character| character.is_ascii_digit())
}

fn validate_lastfm_progress(progress: &LastFmPlaybackProgress) -> Result<(), String> {
    if !valid_player_text(&progress.track_id, true)
        || !valid_player_seconds(progress.listened_seconds)
        || !valid_player_seconds(progress.last_position)
        || progress.started_at > MAX_PLAYER_TIMESTAMP_MS / 1_000
        || !matches!(
            progress.scrobble_state.as_str(),
            "idle" | "pending" | "sent" | "failed"
        )
    {
        return Err("The saved Last.fm playback progress is invalid.".into());
    }
    Ok(())
}

fn validate_radio_scrobble_progress(progress: &RadioScrobbleProgress) -> Result<(), String> {
    if !progress.show_track_id.starts_with("radio:")
        || !valid_radio_track_id(&progress.show_track_id)
        || progress.active_chapter_key.as_deref().is_some_and(|value| {
            value.is_empty()
                || value.len() > MAX_RADIO_CHAPTER_KEY_LENGTH
                || value.chars().any(char::is_control)
        })
        || progress.chapter_started_at > MAX_PLAYER_TIMESTAMP_MS / 1_000
        || !valid_player_seconds(progress.chapter_listened_seconds)
        || !valid_player_seconds(progress.last_position)
        || !matches!(
            progress.chapter_scrobble_state.as_str(),
            "idle" | "pending" | "sent" | "failed"
        )
        || progress.show_started_at > MAX_PLAYER_TIMESTAMP_MS / 1_000
        || !valid_player_seconds(progress.show_listened_seconds)
        || !matches!(
            progress.show_scrobble_state.as_str(),
            "idle" | "pending" | "sent" | "failed"
        )
        || progress.scrobbled_chapter_keys.len() > MAX_RADIO_CHAPTERS
        || progress.scrobbled_chapter_keys.iter().any(|value| {
            value.is_empty()
                || value.len() > MAX_RADIO_CHAPTER_KEY_LENGTH
                || value.chars().any(char::is_control)
        })
    {
        return Err("The saved Radio scrobble progress is invalid.".into());
    }
    Ok(())
}

fn validate_player_state(state: &PlayerStateSnapshot) -> Result<(), String> {
    if state.version != PLAYER_STATE_VERSION {
        return Err("The saved player state uses an unsupported version.".into());
    }
    if state.saved_at > MAX_PLAYER_TIMESTAMP_MS {
        return Err("The saved player timestamp is invalid.".into());
    }
    if state.queue.len() > MAX_PLAYER_QUEUE_LENGTH {
        return Err("The saved queue is too large.".into());
    }
    for track in &state.queue {
        if !valid_player_text(&track.id, true)
            || track.id.starts_with("discover:")
            || !valid_radio_track_id(&track.id)
            || !valid_player_text(&track.title, true)
            || !valid_player_text(&track.artist, true)
            || !valid_player_text(&track.album, true)
            || !valid_player_text(&track.album_id, true)
            || track.duration as f64 > MAX_PLAYER_SECONDS
            || track.track > MAX_PLAYER_TRACK_NUMBER
            || track
                .disc
                .is_some_and(|disc| disc > MAX_PLAYER_TRACK_NUMBER)
            || track
                .cover_art
                .as_deref()
                .is_some_and(|value| !valid_player_text(value, false))
            || track.palette.iter().any(|color| {
                color.is_empty() || color.len() > 64 || color.chars().any(char::is_control)
            })
        {
            return Err("The saved queue contains invalid track metadata.".into());
        }
    }
    if !valid_player_seconds(state.position_seconds)
        || !state.volume.is_finite()
        || !(0.0..=1.0).contains(&state.volume)
        || !matches!(state.repeat_mode.as_str(), "off" | "all" | "one")
    {
        return Err("The saved playback settings are invalid.".into());
    }
    if state.queue.is_empty() {
        if state.current_index != 0
            || state.position_seconds != 0.0
            || state.last_fm_progress.is_some()
            || state.radio_scrobble_progress.is_some()
        {
            return Err("The saved empty queue has an invalid playback position.".into());
        }
    } else if state.current_index >= state.queue.len() {
        return Err("The saved current track is outside the queue.".into());
    }
    if let Some(progress) = &state.last_fm_progress {
        validate_lastfm_progress(progress)?;
        if state.queue[state.current_index].id.starts_with("radio:")
            || state.queue[state.current_index].id != progress.track_id
        {
            return Err("The saved Last.fm progress belongs to another track.".into());
        }
    }
    if let Some(progress) = &state.radio_scrobble_progress {
        validate_radio_scrobble_progress(progress)?;
        if !state.queue[state.current_index].id.starts_with("radio:")
            || state.queue[state.current_index].id != progress.show_track_id
        {
            return Err("The saved Radio progress belongs to another show.".into());
        }
    }
    if state.last_fm_progress.is_some() && state.radio_scrobble_progress.is_some() {
        return Err("The saved player state has conflicting scrobble progress.".into());
    }
    Ok(())
}

fn validate_player_checkpoint(checkpoint: &PlayerStateCheckpoint) -> Result<(), String> {
    if !valid_player_text(&checkpoint.current_track_id, true)
        || checkpoint.current_track_id.starts_with("discover:")
        || !valid_radio_track_id(&checkpoint.current_track_id)
        || !valid_player_seconds(checkpoint.position_seconds)
    {
        return Err("The player checkpoint is invalid.".into());
    }
    if let Some(progress) = &checkpoint.last_fm_progress {
        validate_lastfm_progress(progress)?;
        if checkpoint.current_track_id.starts_with("radio:")
            || progress.track_id != checkpoint.current_track_id
        {
            return Err("The Last.fm checkpoint belongs to another track.".into());
        }
    }
    if let Some(progress) = &checkpoint.radio_scrobble_progress {
        validate_radio_scrobble_progress(progress)?;
        if !checkpoint.current_track_id.starts_with("radio:")
            || progress.show_track_id != checkpoint.current_track_id
        {
            return Err("The Radio checkpoint belongs to another show.".into());
        }
    }
    if checkpoint.last_fm_progress.is_some() && checkpoint.radio_scrobble_progress.is_some() {
        return Err("The player checkpoint has conflicting scrobble progress.".into());
    }
    Ok(())
}

fn normalize_restored_radio_scrobble_progress(progress: &mut RadioScrobbleProgress) {
    progress.chapter_started_at = 0;
    progress.chapter_now_playing_sent = false;
    if progress.chapter_scrobble_state == "pending" {
        if let Some(key) = &progress.active_chapter_key {
            if !progress.scrobbled_chapter_keys.contains(key) {
                progress.scrobbled_chapter_keys.push(key.clone());
            }
        }
        progress.chapter_scrobble_state = "sent".into();
    }
    if progress.scrobbled_chapter_keys.len() > MAX_RADIO_CHAPTERS {
        let excess = progress.scrobbled_chapter_keys.len() - MAX_RADIO_CHAPTERS;
        progress.scrobbled_chapter_keys.drain(..excess);
    }
    progress.show_started_at = 0;
    if progress.show_scrobble_state == "pending" {
        progress.show_scrobble_state = "sent".into();
    }
}

fn normalize_restored_player_progress(state: &mut PlayerStateSnapshot) {
    if let Some(progress) = &mut state.last_fm_progress {
        progress.started_at = 0;
        progress.now_playing_sent = false;
        if progress.scrobble_state == "pending" {
            progress.scrobble_state = "sent".into();
        }
    }
    if let Some(progress) = &mut state.radio_scrobble_progress {
        normalize_restored_radio_scrobble_progress(progress);
    }
}

fn apply_player_checkpoint(
    state: &mut PlayerStateSnapshot,
    checkpoint: PlayerStateCheckpoint,
) -> bool {
    if checkpoint.current_index >= state.queue.len()
        || state.queue[checkpoint.current_index].id != checkpoint.current_track_id
    {
        return false;
    }
    state.current_index = checkpoint.current_index;
    state.position_seconds = checkpoint.position_seconds;
    state.last_fm_progress = checkpoint.last_fm_progress;
    state.radio_scrobble_progress = checkpoint.radio_scrobble_progress;
    true
}

fn player_timestamp_ms() -> Result<u64, String> {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is invalid.".to_string())?
        .as_millis();
    u64::try_from(milliseconds).map_err(|_| "The system clock is invalid.".to_string())
}

fn read_player_state(path: &Path) -> Result<Option<PlayerStateSnapshot>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not open the saved player state: {error}")),
    };
    if file
        .metadata()
        .map_err(|error| format!("Could not inspect the saved player state: {error}"))?
        .len()
        > MAX_PLAYER_STATE_BYTES as u64
    {
        return Err("The saved player state is unexpectedly large.".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_PLAYER_STATE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the saved player state: {error}"))?;
    if bytes.len() > MAX_PLAYER_STATE_BYTES {
        return Err("The saved player state is unexpectedly large.".into());
    }
    let state: PlayerStateSnapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved player state is malformed.".to_string())?;
    validate_player_state(&state)?;
    Ok(Some(state))
}

fn write_bytes_atomically(path: &Path, serialized: &[u8], label: &str) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "The player state path is invalid.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create Coda's application data directory: {error}"))?;

    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(PLAYER_STATE_FILE);
    let temporary = directory.join(format!("{file_name}.{suffix}.tmp"));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Could not create a {label} checkpoint: {error}"))?;
        file.write_all(serialized)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Could not write the {label}: {error}"))?;
        drop(file);

        match fs::rename(&temporary, path) {
            Ok(()) => Ok(()),
            Err(first_error) if path.exists() => {
                fs::remove_file(path)
                    .map_err(|error| format!("Could not replace the prior {label}: {error}"))?;
                fs::rename(&temporary, path).map_err(|error| {
                    format!("Could not finish replacing the {label} ({first_error}; {error})")
                })
            }
            Err(error) => Err(format!("Could not finalize the {label}: {error}")),
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn write_player_state(path: &Path, state: &PlayerStateSnapshot) -> Result<(), String> {
    validate_player_state(state)?;
    let serialized = serde_json::to_vec(state)
        .map_err(|error| format!("Could not prepare the player state: {error}"))?;
    if serialized.len() > MAX_PLAYER_STATE_BYTES {
        return Err("The saved player state is unexpectedly large.".into());
    }
    write_bytes_atomically(path, &serialized, "player state")
}

fn read_player_checkpoint(path: &Path) -> Result<Option<PlayerStateCheckpoint>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not open the player checkpoint: {error}")),
    };
    if file
        .metadata()
        .map_err(|error| format!("Could not inspect the player checkpoint: {error}"))?
        .len()
        > MAX_PLAYER_CHECKPOINT_BYTES as u64
    {
        return Err("The player checkpoint is unexpectedly large.".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_PLAYER_CHECKPOINT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the player checkpoint: {error}"))?;
    if bytes.len() > MAX_PLAYER_CHECKPOINT_BYTES {
        return Err("The player checkpoint is unexpectedly large.".into());
    }
    let checkpoint: PlayerStateCheckpoint = serde_json::from_slice(&bytes)
        .map_err(|_| "The player checkpoint is malformed.".to_string())?;
    validate_player_checkpoint(&checkpoint)?;
    Ok(Some(checkpoint))
}

fn write_player_checkpoint(path: &Path, checkpoint: &PlayerStateCheckpoint) -> Result<(), String> {
    validate_player_checkpoint(checkpoint)?;
    let serialized = serde_json::to_vec(checkpoint)
        .map_err(|error| format!("Could not prepare the player checkpoint: {error}"))?;
    if serialized.len() > MAX_PLAYER_CHECKPOINT_BYTES {
        return Err("The player checkpoint is unexpectedly large.".into());
    }
    write_bytes_atomically(path, &serialized, "player checkpoint")
}

fn load_player_state_or_clear_invalid(path: &Path) -> Result<Option<PlayerStateSnapshot>, String> {
    match read_player_state(path) {
        Ok(state) => Ok(state),
        Err(error)
            if error.contains("malformed")
                || error.contains("unsupported version")
                || error.contains("unexpectedly large")
                || error.contains("saved queue")
                || error.contains("saved playback")
                || error.contains("saved current")
                || error.contains("saved empty")
                || error.contains("saved Last.fm")
                || error.contains("saved player timestamp") =>
        {
            fs::remove_file(path)
                .or_else(|remove_error| {
                    if remove_error.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(remove_error)
                    }
                })
                .map_err(|remove_error| {
                    format!("{error} Coda could not discard that state: {remove_error}")
                })?;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, CREDENTIAL_KEY)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

fn lastfm_session_entry() -> Result<Entry, String> {
    Entry::new(LASTFM_SERVICE_NAME, LASTFM_SESSION_KEY)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

fn lastfm_configured() -> bool {
    [LASTFM_API_KEY, LASTFM_SHARED_SECRET].iter().all(|value| {
        value.len() == 32 && value.bytes().all(|character| character.is_ascii_hexdigit())
    })
}

fn lastfm_status_value() -> LastFmStatus {
    if !lastfm_configured() {
        return LastFmStatus {
            configured: false,
            connected: false,
            username: None,
        };
    }
    match load_lastfm_session() {
        Ok(Some(session)) => LastFmStatus {
            configured: true,
            connected: true,
            username: Some(session.username),
        },
        _ => LastFmStatus {
            configured: true,
            connected: false,
            username: None,
        },
    }
}

fn load_lastfm_session() -> Result<Option<LastFmSession>, String> {
    let serialized = match lastfm_session_entry()?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("Could not read the Last.fm session: {error}")),
    };
    let session: LastFmSession = serde_json::from_str(&serialized)
        .map_err(|_| "The saved Last.fm session is invalid. Reconnect Last.fm.".to_string())?;
    if session.username.is_empty()
        || session.key.is_empty()
        || session.username.len() > MAX_LASTFM_METADATA_LENGTH
        || session.key.len() > MAX_LASTFM_METADATA_LENGTH
        || session.username.chars().any(char::is_control)
        || session.key.chars().any(char::is_control)
    {
        return Err("The saved Last.fm session is invalid. Reconnect Last.fm.".into());
    }
    Ok(Some(session))
}

fn store_lastfm_session(session: &LastFmSession) -> Result<(), String> {
    let serialized = serde_json::to_string(session)
        .map_err(|error| format!("Could not prepare the Last.fm session: {error}"))?;
    lastfm_session_entry()?
        .set_password(&serialized)
        .map_err(|error| format!("Could not save the Last.fm session: {error}"))
}

fn require_lastfm_configuration() -> Result<(), String> {
    if lastfm_configured() {
        Ok(())
    } else {
        Err("Last.fm is not configured in this Coda build.".into())
    }
}

fn require_lastfm_session() -> Result<LastFmSession, String> {
    require_lastfm_configuration()?;
    load_lastfm_session()?.ok_or_else(|| "Connect Last.fm in Coda settings first.".into())
}

fn validate_lastfm_token(token: &str) -> Result<(), String> {
    if token.is_empty()
        || token.len() > MAX_LASTFM_METADATA_LENGTH
        || token.chars().any(char::is_control)
    {
        return Err("Last.fm returned an invalid authorization token.".into());
    }
    Ok(())
}

fn valid_musicbrainz_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn validate_lastfm_track(input: &LastFmTrackInput) -> Result<(), String> {
    for (label, value) in [
        ("artist", input.artist.trim()),
        ("track", input.title.trim()),
        ("album", input.album.trim()),
    ] {
        if value.len() > MAX_LASTFM_METADATA_LENGTH || value.chars().any(char::is_control) {
            return Err(format!("The Last.fm {label} metadata is invalid."));
        }
    }
    if input.artist.trim().is_empty() || input.title.trim().is_empty() {
        return Err("Last.fm requires both an artist and track title.".into());
    }
    if let Some(album_artist) = input.album_artist.as_deref() {
        if album_artist.len() > MAX_LASTFM_METADATA_LENGTH
            || album_artist.chars().any(char::is_control)
        {
            return Err("The Last.fm album artist metadata is invalid.".into());
        }
    }
    if input
        .music_brainz_id
        .as_deref()
        .is_some_and(|value| !valid_musicbrainz_id(value))
    {
        return Err("The Last.fm MusicBrainz identifier is invalid.".into());
    }
    Ok(())
}

fn lastfm_signature(parameters: &BTreeMap<String, String>) -> String {
    let mut signature = String::new();
    for (key, value) in parameters {
        if key != "format" && key != "callback" {
            signature.push_str(key);
            signature.push_str(value);
        }
    }
    signature.push_str(LASTFM_SHARED_SECRET);
    format!("{:x}", md5::compute(signature))
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

fn validate_subsonic_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_IDENTIFIER_LENGTH
        || value.chars().any(char::is_control)
    {
        return Err(format!("The {label} identifier is invalid."));
    }
    Ok(())
}

fn validate_playlist_name(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.trim() != value
        || value.len() > MAX_PLAYLIST_NAME_LENGTH
        || value.chars().any(char::is_control)
    {
        return Err("Playlist names must be 1–256 characters without control characters.".into());
    }
    Ok(())
}

fn validate_playlist_comment(value: &str) -> Result<(), String> {
    if value.len() > MAX_PLAYLIST_COMMENT_LENGTH || value.chars().any(char::is_control) {
        return Err(
            "Playlist comments must be no longer than 4,096 characters and cannot contain control characters."
                .into(),
        );
    }
    Ok(())
}

fn validate_song_ids(values: &[String]) -> Result<(), String> {
    if values.len() > MAX_PLAYLIST_MUTATION_ITEMS {
        return Err(format!(
            "A single playlist change can include at most {MAX_PLAYLIST_MUTATION_ITEMS} tracks."
        ));
    }
    for value in values {
        validate_subsonic_id(value, "song")?;
    }
    Ok(())
}

fn validate_playlist_update(input: &PlaylistUpdateInput) -> Result<(), String> {
    validate_subsonic_id(&input.playlist_id, "playlist")?;
    if let Some(name) = &input.name {
        validate_playlist_name(name)?;
    }
    if let Some(comment) = &input.comment {
        validate_playlist_comment(comment)?;
    }
    validate_song_ids(&input.song_ids_to_add)?;
    if input.song_indexes_to_remove.len() > MAX_PLAYLIST_MUTATION_ITEMS
        || input
            .song_indexes_to_remove
            .iter()
            .any(|index| *index >= MAX_PLAYLIST_TRACKS as u64)
        || input
            .song_indexes_to_remove
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != input.song_indexes_to_remove.len()
    {
        return Err("The playlist track indexes are invalid.".into());
    }
    if input.name.is_none()
        && input.comment.is_none()
        && input.public.is_none()
        && input.song_ids_to_add.is_empty()
        && input.song_indexes_to_remove.is_empty()
    {
        return Err("The playlist update does not contain any changes.".into());
    }
    Ok(())
}

fn valid_subsonic_text(value: &str, maximum: usize, required: bool) -> bool {
    value.len() <= maximum
        && !value.chars().any(char::is_control)
        && (!required || !value.trim().is_empty())
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

fn clean_radio_text(value: &str, fallback: &str) -> String {
    let cleaned = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_RADIO_TEXT_LENGTH)
        .collect::<String>();
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned
    }
}

fn radio_artwork_url(image_id: Option<u64>) -> Option<String> {
    image_id
        .filter(|id| *id > 0)
        .map(|id| format!("https://f4.bcbits.com/img/{id:010}_10.jpg"))
}

fn radio_track_artwork_url(image_id: Option<u64>) -> Option<String> {
    image_id
        .filter(|id| *id > 0)
        .map(|id| format!("https://f4.bcbits.com/img/a{id}_10.jpg"))
}

fn radio_artist_url(hints: Option<&RawRadioUrlHints>, item_url: Option<&str>) -> Option<String> {
    let hinted = hints
        .and_then(|value| value.subdomain.as_deref())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 63
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .and_then(|subdomain| {
            allowed_url(
                &format!("https://{}.bandcamp.com/", subdomain.to_ascii_lowercase()),
                "bandcamp",
            )
        });
    hinted.or_else(|| {
        let mut parsed = Url::parse(item_url?).ok()?;
        parsed.set_path("/");
        parsed.set_query(None);
        parsed.set_fragment(None);
        allowed_url(parsed.as_str(), "bandcamp")
    })
}

fn radio_summary_from_raw(value: RawRadioSummary) -> Option<RadioShowSummary> {
    if value.id == 0 {
        return None;
    }
    Some(RadioShowSummary {
        id: value.id,
        subtitle: clean_radio_text(&value.subtitle, "Untitled episode"),
        description: clean_radio_text(&value.desc, "A Bandcamp-curated radio show."),
        published_at: clean_radio_text(&value.published_date, "Date unavailable"),
        artwork_url: radio_artwork_url(
            value
                .v2_image_id
                .or(value.screen_image_id)
                .or(value.image_id),
        ),
    })
}

fn radio_show_from_raw(value: RawRadioShow) -> Result<RadioShow, String> {
    if value.show_id == 0 {
        return Err("Bandcamp Radio returned an invalid show identifier.".into());
    }
    let duration = value.audio_duration.unwrap_or_default();
    if !duration.is_finite() || !(0.0..=MAX_RADIO_DURATION_SECONDS).contains(&duration) {
        return Err("Bandcamp Radio returned an invalid show duration.".into());
    }
    let stream_url = value
        .audio_stream
        .get("mp3-128")
        .and_then(|url| allowed_url(url, "bandcamp").or_else(|| allowed_url(url, "media")))
        .ok_or_else(|| {
            "This Bandcamp Radio episode does not have a playable stream.".to_string()
        })?;
    let chapters = value
        .tracks
        .into_iter()
        .take(MAX_RADIO_CHAPTERS)
        .filter_map(|chapter| {
            let timecode = chapter.timecode.unwrap_or_default();
            if !timecode.is_finite() || !(0.0..=MAX_RADIO_DURATION_SECONDS).contains(&timecode) {
                return None;
            }
            let track_url = chapter
                .track_url
                .as_deref()
                .and_then(|url| allowed_url(url, "bandcamp"));
            let album_url = chapter
                .album_url
                .as_deref()
                .and_then(|url| allowed_url(url, "bandcamp"))
                .or_else(|| {
                    chapter
                        .url
                        .as_deref()
                        .and_then(|url| allowed_url(url, "bandcamp"))
                });
            let item_url = track_url.clone().or_else(|| album_url.clone());
            let artist_url = radio_artist_url(chapter.url_hints.as_ref(), item_url.as_deref());
            Some(RadioChapter {
                title: clean_radio_text(&chapter.title, "Untitled track"),
                artist: clean_radio_text(&chapter.artist, "Unknown artist"),
                album: chapter
                    .album_title
                    .as_deref()
                    .map(|album| clean_radio_text(album, ""))
                    .filter(|album| !album.is_empty()),
                timecode: timecode.round() as u64,
                item_url,
                artist_url,
                album_url,
                artwork_url: radio_track_artwork_url(chapter.track_art_id),
            })
        })
        .collect();

    Ok(RadioShow {
        id: value.show_id,
        title: clean_radio_text(&value.title, "Bandcamp Radio"),
        subtitle: clean_radio_text(&value.subtitle, "Untitled episode"),
        description: clean_radio_text(&value.desc, "A Bandcamp-curated radio show."),
        published_at: clean_radio_text(&value.published_date, "Date unavailable"),
        artwork_url: radio_artwork_url(
            value
                .show_v2_image_id
                .or(value.show_screen_image_id)
                .or(value.show_image_id),
        ),
        duration: duration.round() as u64,
        stream_url,
        chapters,
    })
}

async fn fetch_bounded_json<T: DeserializeOwned>(url: Url, context: &str) -> Result<T, String> {
    let response = http_client()?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Could not reach {context}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "{context} returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_JSON_RESPONSE_BYTES as u64)
    {
        return Err(format!(
            "{context} returned an unexpectedly large response."
        ));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
    {
        return Err(format!("{context} returned an unexpected content type."));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| format!("{context} returned an unreadable response."))?;
    if bytes.len() > MAX_JSON_RESPONSE_BYTES {
        return Err(format!(
            "{context} returned an unexpectedly large response."
        ));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| format!("{context} returned an unexpected response."))
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

fn lastfm_http_client() -> Result<&'static Client, String> {
    LASTFM_HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(20))
                .user_agent("Coda/0.1 (+https://github.com/iheanyi/coda-bandcamp)")
                .redirect(Policy::none())
                .build()
                .map_err(|error| {
                    format!("Could not initialize the Last.fm network client: {error}")
                })
        })
        .as_ref()
        .map_err(Clone::clone)
}

async fn lastfm_request(mut parameters: BTreeMap<String, String>) -> Result<Value, String> {
    require_lastfm_configuration()?;
    parameters.insert("api_key".into(), LASTFM_API_KEY.into());
    let signature = lastfm_signature(&parameters);
    parameters.insert("api_sig".into(), signature);
    parameters.insert("format".into(), "json".into());

    let response = lastfm_http_client()?
        .post(LASTFM_API_ENDPOINT)
        .form(&parameters)
        .send()
        .await
        .map_err(|error| format!("Could not reach Last.fm: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Last.fm returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_LASTFM_RESPONSE_BYTES as u64)
    {
        return Err("Last.fm returned an unexpectedly large response.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Last.fm returned an unreadable response.".to_string())?;
    if bytes.len() > MAX_LASTFM_RESPONSE_BYTES {
        return Err("Last.fm returned an unexpectedly large response.".into());
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Last.fm returned an unreadable response.".to_string())?;
    if body.get("error").is_some() {
        return Err(body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Last.fm rejected the request.")
            .to_string());
    }
    Ok(body)
}

fn lastfm_track_parameters(input: &LastFmTrackInput) -> BTreeMap<String, String> {
    let mut parameters = BTreeMap::from([
        ("artist".into(), input.artist.trim().into()),
        ("track".into(), input.title.trim().into()),
    ]);
    if !input.album.trim().is_empty() {
        parameters.insert("album".into(), input.album.trim().into());
    }
    if let Some(album_artist) = input
        .album_artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parameters.insert("albumArtist".into(), album_artist.into());
    }
    if let Some(music_brainz_id) = input.music_brainz_id.as_deref() {
        parameters.insert("mbid".into(), music_brainz_id.into());
    }
    if input.duration > 0 {
        parameters.insert("duration".into(), input.duration.to_string());
    }
    if input.track_number > 0 {
        parameters.insert("trackNumber".into(), input.track_number.to_string());
    }
    parameters
}

fn lastfm_scrobble_parameters(input: &LastFmTrackInput) -> BTreeMap<String, String> {
    let mut parameters = lastfm_track_parameters(input);
    if let Some(chosen_by_user) = input.chosen_by_user {
        parameters.insert(
            "chosenByUser".into(),
            if chosen_by_user { "1" } else { "0" }.into(),
        );
    }
    parameters
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
    parse_subsonic_response(response).await
}

async fn request_mutation_json(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(String, String)],
) -> Result<Value, String> {
    let url = authenticated_url(endpoint, credentials, &[])?;
    let response = http_client()?
        .post(url)
        .form(extra)
        .send()
        .await
        .map_err(|error| format!("Could not reach Bandcamp: {error}"))?;
    parse_subsonic_response(response).await
}

async fn parse_subsonic_response(response: reqwest::Response) -> Result<Value, String> {
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

fn beta_feature_error(feature: &str, error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if [
        "not found",
        "not implemented",
        "unsupported",
        "unknown command",
        "unknown method",
        "http 404",
        "http 405",
        "http 500",
        "error code 70",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        format!("{feature} is not available from Bandcamp's Subsonic beta for this account yet.")
    } else {
        format!("{feature} failed: {error}")
    }
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

fn boolean_field(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(|item| {
        item.as_bool().or_else(|| match item.as_str()? {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        })
    })
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
        album_artist: string_field(value, &["displayAlbumArtist", "albumArtist"])
            .filter(|artist| valid_subsonic_text(artist, MAX_SUBSONIC_TEXT_LENGTH, false))
            .filter(|artist| !artist.trim().is_empty()),
        music_brainz_id: string_field(value, &["musicBrainzId"])
            .filter(|identifier| valid_musicbrainz_id(identifier)),
        cover_art: string_field(value, &["coverArt"]),
    })
}

fn bounded_optional_field(value: &Value, keys: &[&str], maximum: usize) -> Option<String> {
    string_field(value, keys)
        .filter(|item| valid_subsonic_text(item, maximum, false))
        .filter(|item| !item.trim().is_empty())
}

fn playlist_summary_from_value(value: &Value) -> Option<PlaylistSummary> {
    let id = string_field(value, &["id"])?;
    validate_subsonic_id(&id, "playlist").ok()?;
    let name = string_field(value, &["name"])?;
    if !valid_subsonic_text(&name, MAX_PLAYLIST_NAME_LENGTH, true) {
        return None;
    }
    let song_count = number_field(value, "songCount").unwrap_or(0);
    let duration = number_field(value, "duration").unwrap_or(0);
    if song_count > MAX_PLAYLIST_TRACKS as u64 || duration > MAX_SUBSONIC_DURATION_SECONDS {
        return None;
    }
    Some(PlaylistSummary {
        id,
        name: name.trim().to_string(),
        comment: bounded_optional_field(value, &["comment"], MAX_PLAYLIST_COMMENT_LENGTH),
        owner: bounded_optional_field(value, &["owner"], MAX_SUBSONIC_TEXT_LENGTH),
        public: boolean_field(value, "public"),
        song_count,
        duration,
        created_at: bounded_optional_field(value, &["created"], MAX_SUBSONIC_TEXT_LENGTH),
        changed_at: bounded_optional_field(value, &["changed"], MAX_SUBSONIC_TEXT_LENGTH),
        cover_art: bounded_optional_field(value, &["coverArt"], MAX_IDENTIFIER_LENGTH),
    })
}

fn bounded_track_from_value(value: &Value, fallback_album_id: &str) -> Option<Track> {
    let track = track_from_value(value, fallback_album_id)?;
    validate_subsonic_id(&track.id, "song").ok()?;
    validate_subsonic_id(&track.album_id, "album").ok()?;
    if !valid_subsonic_text(&track.title, MAX_SUBSONIC_TEXT_LENGTH, true)
        || !valid_subsonic_text(&track.artist, MAX_SUBSONIC_TEXT_LENGTH, true)
        || !valid_subsonic_text(&track.album, MAX_SUBSONIC_TEXT_LENGTH, true)
        || track.duration as f64 > MAX_PLAYER_SECONDS
        || track.track > MAX_PLAYER_TRACK_NUMBER
        || track
            .disc
            .is_some_and(|disc| disc > MAX_PLAYER_TRACK_NUMBER)
        || track
            .album_artist
            .as_deref()
            .is_some_and(|artist| !valid_subsonic_text(artist, MAX_SUBSONIC_TEXT_LENGTH, false))
        || track
            .music_brainz_id
            .as_deref()
            .is_some_and(|identifier| !valid_musicbrainz_id(identifier))
        || track
            .cover_art
            .as_deref()
            .is_some_and(|cover| validate_subsonic_id(cover, "cover artwork").is_err())
    {
        return None;
    }
    Some(track)
}

fn playlist_detail_from_value(value: &Value) -> Result<PlaylistDetail, String> {
    let summary = playlist_summary_from_value(value)
        .ok_or_else(|| "Bandcamp returned invalid playlist metadata.".to_string())?;
    let entries = value
        .get("entry")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if entries.len() > MAX_PLAYLIST_TRACKS {
        return Err(format!(
            "Bandcamp returned a playlist with more than {MAX_PLAYLIST_TRACKS} tracks."
        ));
    }
    let tracks = entries
        .iter()
        .map(|entry| {
            let fallback_album_id = string_field(entry, &["albumId"]).unwrap_or_default();
            bounded_track_from_value(entry, &fallback_album_id).ok_or_else(|| {
                "Bandcamp returned invalid track metadata in a playlist.".to_string()
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PlaylistDetail {
        id: summary.id,
        name: summary.name,
        comment: summary.comment,
        owner: summary.owner,
        public: summary.public,
        song_count: summary.song_count,
        duration: summary.duration,
        created_at: summary.created_at,
        changed_at: summary.changed_at,
        cover_art: summary.cover_art,
        tracks,
    })
}

fn playlists_from_response(body: &Value) -> Result<Vec<PlaylistSummary>, String> {
    let values = body
        .pointer("/subsonic-response/playlists/playlist")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if values.len() > MAX_PLAYLISTS {
        return Err(format!(
            "Bandcamp returned more than {MAX_PLAYLISTS} playlists."
        ));
    }
    values
        .iter()
        .map(|value| {
            playlist_summary_from_value(value)
                .ok_or_else(|| "Bandcamp returned invalid playlist metadata.".to_string())
        })
        .collect()
}

fn playlist_from_response(body: &Value) -> Result<PlaylistDetail, String> {
    let value = body
        .pointer("/subsonic-response/playlist")
        .ok_or_else(|| "Bandcamp did not return the requested playlist.".to_string())?;
    playlist_detail_from_value(value)
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

#[tauri::command]
fn player_state_contract_version() -> u8 {
    PLAYER_STATE_CONTRACT_VERSION
}

#[tauri::command]
async fn load_player_state(app: tauri::AppHandle) -> Result<Option<PlayerStateSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = PLAYER_STATE_LOCK
            .lock()
            .map_err(|_| "The player state lock is unavailable.".to_string())?;
        let state_path = player_state_path(&app)?;
        let checkpoint_path = player_checkpoint_path(&app)?;
        let Some(mut state) = load_player_state_or_clear_invalid(&state_path)? else {
            let _ = fs::remove_file(checkpoint_path);
            return Ok(None);
        };

        match read_player_checkpoint(&checkpoint_path) {
            Ok(Some(checkpoint)) => {
                if !apply_player_checkpoint(&mut state, checkpoint) {
                    let _ = fs::remove_file(&checkpoint_path);
                }
            }
            Ok(None) => {}
            Err(error)
                if error.contains("malformed")
                    || error.contains("invalid")
                    || error.contains("unexpectedly large") =>
            {
                let _ = fs::remove_file(&checkpoint_path);
            }
            Err(error) => return Err(error),
        }
        normalize_restored_player_progress(&mut state);
        validate_player_state(&state)?;
        Ok(Some(state))
    })
    .await
    .map_err(|error| format!("Could not load the player state: {error}"))?
}

#[tauri::command]
async fn save_player_state(
    app: tauri::AppHandle,
    mut state: PlayerStateSnapshot,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = PLAYER_STATE_LOCK
            .lock()
            .map_err(|_| "The player state lock is unavailable.".to_string())?;
        state.saved_at = player_timestamp_ms()?;
        normalize_restored_player_progress(&mut state);
        validate_player_state(&state)?;
        let state_path = player_state_path(&app)?;
        write_player_state(&state_path, &state)?;
        let checkpoint_path = player_checkpoint_path(&app)?;
        match fs::remove_file(checkpoint_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Could not clear the prior player checkpoint: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("Could not save the player state: {error}"))?
}

#[tauri::command]
async fn checkpoint_player_state(
    app: tauri::AppHandle,
    mut checkpoint: PlayerStateCheckpoint,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = PLAYER_STATE_LOCK
            .lock()
            .map_err(|_| "The player state lock is unavailable.".to_string())?;
        validate_player_checkpoint(&checkpoint)?;
        let state_path = player_state_path(&app)?;
        let Some(state) = load_player_state_or_clear_invalid(&state_path)? else {
            return Ok(false);
        };
        if checkpoint.current_index >= state.queue.len()
            || state.queue[checkpoint.current_index].id != checkpoint.current_track_id
        {
            return Ok(false);
        }
        if let Some(progress) = &mut checkpoint.last_fm_progress {
            progress.started_at = 0;
            progress.now_playing_sent = false;
            if progress.scrobble_state == "pending" {
                progress.scrobble_state = "sent".into();
            }
        }
        if let Some(progress) = &mut checkpoint.radio_scrobble_progress {
            normalize_restored_radio_scrobble_progress(progress);
        }
        let checkpoint_path = player_checkpoint_path(&app)?;
        write_player_checkpoint(&checkpoint_path, &checkpoint)?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("Could not checkpoint the player state: {error}"))?
}

#[tauri::command]
async fn clear_player_state(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = PLAYER_STATE_LOCK
            .lock()
            .map_err(|_| "The player state lock is unavailable.".to_string())?;
        for path in [player_state_path(&app)?, player_checkpoint_path(&app)?] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("Could not clear the saved player state: {error}"))
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Could not clear the player state: {error}"))?
}

#[tauri::command]
fn lastfm_status() -> LastFmStatus {
    lastfm_status_value()
}

#[tauri::command]
async fn lastfm_begin_auth() -> Result<LastFmAuthorization, String> {
    require_lastfm_configuration()?;
    let body = lastfm_request(BTreeMap::from([("method".into(), "auth.getToken".into())])).await?;
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "Last.fm did not return an authorization token.".to_string())?
        .to_string();
    validate_lastfm_token(&token)?;
    let mut authorization_url = Url::parse(LASTFM_AUTH_ENDPOINT)
        .map_err(|_| "The built-in Last.fm authorization URL is invalid.".to_string())?;
    authorization_url
        .query_pairs_mut()
        .append_pair("api_key", LASTFM_API_KEY)
        .append_pair("token", &token);
    Ok(LastFmAuthorization {
        authorization_url: authorization_url.to_string(),
        token,
    })
}

#[tauri::command]
async fn lastfm_complete_auth(token: String) -> Result<LastFmStatus, String> {
    require_lastfm_configuration()?;
    validate_lastfm_token(&token)?;
    let body = lastfm_request(BTreeMap::from([
        ("method".into(), "auth.getSession".into()),
        ("token".into(), token),
    ]))
    .await?;
    let session = body
        .get("session")
        .ok_or_else(|| "Last.fm did not return a session.".to_string())?;
    let saved = LastFmSession {
        username: session
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Last.fm did not return an account name.".to_string())?
            .to_string(),
        key: session
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "Last.fm did not return a session key.".to_string())?
            .to_string(),
    };
    store_lastfm_session(&saved)?;
    Ok(lastfm_status_value())
}

#[tauri::command]
fn lastfm_disconnect() -> Result<LastFmStatus, String> {
    match lastfm_session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(lastfm_status_value()),
        Err(error) => Err(format!("Could not remove the Last.fm session: {error}")),
    }
}

#[tauri::command]
async fn lastfm_update_now_playing(input: LastFmTrackInput) -> Result<(), String> {
    validate_lastfm_track(&input)?;
    let session = require_lastfm_session()?;
    let mut parameters = lastfm_track_parameters(&input);
    parameters.insert("method".into(), "track.updateNowPlaying".into());
    parameters.insert("sk".into(), session.key);
    lastfm_request(parameters).await?;
    Ok(())
}

#[tauri::command]
async fn lastfm_scrobble(input: LastFmScrobbleInput) -> Result<(), String> {
    validate_lastfm_track(&input.track)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is invalid.".to_string())?
        .as_secs();
    if input.timestamp == 0 || input.timestamp > now.saturating_add(60) {
        return Err("The Last.fm scrobble timestamp is invalid.".into());
    }
    let session = require_lastfm_session()?;
    let mut parameters = lastfm_scrobble_parameters(&input.track);
    parameters.insert("method".into(), "track.scrobble".into());
    parameters.insert("sk".into(), session.key);
    parameters.insert("timestamp".into(), input.timestamp.to_string());
    lastfm_request(parameters).await?;
    Ok(())
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
async fn fetch_playlists() -> Result<Vec<PlaylistSummary>, String> {
    let credentials = load_credentials()?;
    let body = request_json("getPlaylists", &credentials, &[])
        .await
        .map_err(|error| beta_feature_error("Playlists", error))?;
    playlists_from_response(&body)
}

#[tauri::command]
async fn fetch_playlist(playlist_id: String) -> Result<PlaylistDetail, String> {
    validate_subsonic_id(&playlist_id, "playlist")?;
    let credentials = load_credentials()?;
    let body = request_json("getPlaylist", &credentials, &[("id", playlist_id.clone())])
        .await
        .map_err(|error| beta_feature_error("Playlist loading", error))?;
    let playlist = playlist_from_response(&body)?;
    if playlist.id != playlist_id {
        return Err("Bandcamp returned a different playlist than Coda requested.".into());
    }
    Ok(playlist)
}

#[tauri::command]
async fn create_playlist(name: String, song_ids: Vec<String>) -> Result<PlaylistDetail, String> {
    validate_playlist_name(&name)?;
    validate_song_ids(&song_ids)?;
    let credentials = load_credentials()?;
    let mut parameters = Vec::with_capacity(song_ids.len() + 1);
    parameters.push(("name".into(), name));
    parameters.extend(
        song_ids
            .into_iter()
            .map(|song_id| ("songId".into(), song_id)),
    );
    let body = request_mutation_json("createPlaylist", &credentials, &parameters)
        .await
        .map_err(|error| beta_feature_error("Playlist creation", error))?;
    playlist_from_response(&body)
}

#[tauri::command]
async fn update_playlist(input: PlaylistUpdateInput) -> Result<PlaylistDetail, String> {
    validate_playlist_update(&input)?;
    let credentials = load_credentials()?;
    let playlist_id = input.playlist_id.clone();
    let mut parameters = vec![("playlistId".into(), playlist_id.clone())];
    if let Some(name) = input.name {
        parameters.push(("name".into(), name));
    }
    if let Some(comment) = input.comment {
        parameters.push(("comment".into(), comment));
    }
    if let Some(public) = input.public {
        parameters.push(("public".into(), public.to_string()));
    }
    parameters.extend(
        input
            .song_ids_to_add
            .into_iter()
            .map(|song_id| ("songIdToAdd".into(), song_id)),
    );
    parameters.extend(
        input
            .song_indexes_to_remove
            .into_iter()
            .map(|index| ("songIndexToRemove".into(), index.to_string())),
    );
    let body = request_mutation_json("updatePlaylist", &credentials, &parameters)
        .await
        .map_err(|error| beta_feature_error("Playlist update", error))?;
    let playlist = playlist_from_response(&body)?;
    if playlist.id != playlist_id {
        return Err("Bandcamp returned a different playlist than Coda updated.".into());
    }
    Ok(playlist)
}

#[tauri::command]
async fn delete_playlist(playlist_id: String) -> Result<(), String> {
    validate_subsonic_id(&playlist_id, "playlist")?;
    let credentials = load_credentials()?;
    request_mutation_json(
        "deletePlaylist",
        &credentials,
        &[("id".into(), playlist_id)],
    )
    .await
    .map_err(|error| beta_feature_error("Playlist deletion", error))?;
    Ok(())
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

#[tauri::command]
async fn radio_shows() -> Result<Vec<RadioShowSummary>, String> {
    let url = Url::parse(RADIO_LIST_ENDPOINT)
        .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
    let body: RawRadioList = fetch_bounded_json(url, "Bandcamp Radio").await?;
    Ok(body
        .results
        .into_iter()
        .take(MAX_RADIO_SHOWS)
        .filter_map(radio_summary_from_raw)
        .collect())
}

#[tauri::command]
async fn radio_show(show_id: u64) -> Result<RadioShow, String> {
    if show_id == 0 || show_id > 1_000_000 {
        return Err("The Bandcamp Radio show identifier is invalid.".into());
    }
    let mut url = Url::parse(RADIO_SHOW_ENDPOINT)
        .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
    url.query_pairs_mut()
        .clear()
        .append_pair("id", &show_id.to_string());
    let body: RawRadioShow = fetch_bounded_json(url, "Bandcamp Radio").await?;
    if body.show_id != show_id {
        return Err("Bandcamp Radio returned the wrong show.".into());
    }
    radio_show_from_raw(body)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|webview, _| {
            if webview.label() == "main" {
                let window = webview.window();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_window_state::Builder::default()
                        .with_state_flags(
                            StateFlags::POSITION
                                | StateFlags::SIZE
                                | StateFlags::MAXIMIZED
                                | StateFlags::VISIBLE,
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
                            show_main_window(app);
                            let _ = app.save_window_state(
                                StateFlags::POSITION
                                    | StateFlags::SIZE
                                    | StateFlags::MAXIMIZED
                                    | StateFlags::VISIBLE,
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
                // A prior close intentionally hides the window in the tray. Make an
                // explicit app launch visible regardless of the restored window state.
                show_main_window(app.handle());
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
            player_state_contract_version,
            load_player_state,
            save_player_state,
            checkpoint_player_state,
            clear_player_state,
            lastfm_status,
            lastfm_begin_auth,
            lastfm_complete_auth,
            lastfm_disconnect,
            lastfm_update_now_playing,
            lastfm_scrobble,
            fetch_library,
            fetch_album,
            fetch_playlists,
            fetch_playlist,
            create_playlist,
            update_playlist,
            delete_playlist,
            get_stream_url,
            get_cover_url,
            discover,
            radio_shows,
            radio_show
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

    fn sample_player_track(id: &str) -> PlayerStateTrack {
        PlayerStateTrack {
            id: id.into(),
            title: "Afterimage".into(),
            artist: "Night Archive".into(),
            album: "Soft Focus".into(),
            album_id: "album-1".into(),
            duration: 210,
            track: 2,
            disc: Some(1),
            cover_art: Some("cover-1".into()),
            palette: ["#cf6046".into(), "#2f2624".into()],
        }
    }

    fn sample_player_state() -> PlayerStateSnapshot {
        PlayerStateSnapshot {
            version: PLAYER_STATE_VERSION,
            saved_at: 1_700_000_000_000,
            queue: vec![sample_player_track("track-1")],
            current_index: 0,
            position_seconds: 42.0,
            volume: 0.72,
            repeat_mode: "all".into(),
            queue_open: true,
            last_fm_progress: Some(LastFmPlaybackProgress {
                track_id: "track-1".into(),
                started_at: 1_700_000_000,
                listened_seconds: 40.0,
                last_position: 42.0,
                now_playing_sent: true,
                scrobble_state: "sent".into(),
            }),
            radio_scrobble_progress: None,
        }
    }

    fn temporary_player_state_path(label: &str) -> PathBuf {
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();
        std::env::temp_dir()
            .join(format!("coda-player-state-{label}-{suffix}"))
            .join(PLAYER_STATE_FILE)
    }

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
    fn parses_bounded_playlist_summaries_and_details() {
        let body = serde_json::json!({
            "subsonic-response": {
                "playlists": {
                    "playlist": [{
                        "id": "playlist-1",
                        "name": "Night drives",
                        "comment": "Long roads, low light",
                        "owner": "fan",
                        "public": "false",
                        "songCount": "1",
                        "duration": 245,
                        "created": "2026-07-25T02:00:00Z",
                        "changed": "2026-07-25T02:10:00Z",
                        "coverArt": "cover-1"
                    }]
                }
            }
        });
        let playlists = playlists_from_response(&body).unwrap();
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].name, "Night drives");
        assert_eq!(playlists[0].public, Some(false));

        let detail = playlist_detail_from_value(&serde_json::json!({
            "id": "playlist-1",
            "name": "Night drives",
            "songCount": 1,
            "duration": 245,
            "entry": [{
                "id": "song-1",
                "title": "Afterimage",
                "artist": "Night Archive",
                "album": "Soft Focus",
                "albumId": "album-1",
                "duration": "245",
                "track": 2,
                "discNumber": 1,
                "coverArt": "cover-1"
            }]
        }))
        .unwrap();
        assert_eq!(detail.tracks.len(), 1);
        assert_eq!(detail.tracks[0].album_id, "album-1");
        assert_eq!(detail.tracks[0].duration, 245);
    }

    #[test]
    fn rejects_invalid_or_unbounded_playlist_changes() {
        assert!(validate_playlist_name("  ").is_err());
        assert!(validate_playlist_name("Bad\nname").is_err());
        assert!(validate_song_ids(&vec!["song".into(); MAX_PLAYLIST_MUTATION_ITEMS + 1]).is_err());

        let duplicate_indexes = PlaylistUpdateInput {
            playlist_id: "playlist-1".into(),
            name: None,
            comment: None,
            public: None,
            song_ids_to_add: Vec::new(),
            song_indexes_to_remove: vec![2, 2],
        };
        assert!(validate_playlist_update(&duplicate_indexes).is_err());

        let empty_update = PlaylistUpdateInput {
            song_indexes_to_remove: Vec::new(),
            ..duplicate_indexes
        };
        assert!(validate_playlist_update(&empty_update).is_err());
    }

    #[test]
    fn reports_unavailable_beta_endpoints_without_leaking_server_details() {
        assert_eq!(
            beta_feature_error("Favorites", "Bandcamp returned HTTP 404.".into()),
            "Favorites is not available from Bandcamp's Subsonic beta for this account yet."
        );
        assert_eq!(
            beta_feature_error("Playlist loading", "Timed out".into()),
            "Playlist loading failed: Timed out"
        );
    }

    #[test]
    fn signs_lastfm_parameters_in_sorted_order_without_format_or_callback() {
        let parameters = BTreeMap::from([
            ("track".into(), "Afterimage".into()),
            ("format".into(), "json".into()),
            ("artist".into(), "Night Archive".into()),
            ("callback".into(), "https://example.test".into()),
        ]);
        let expected = format!(
            "{:x}",
            md5::compute(format!(
                "artistNight ArchivetrackAfterimage{LASTFM_SHARED_SECRET}"
            ))
        );
        assert_eq!(lastfm_signature(&parameters), expected);
    }

    #[test]
    fn validates_lastfm_track_metadata() {
        let valid = LastFmTrackInput {
            artist: "Night Archive".into(),
            title: "Afterimage".into(),
            album: "Soft Focus".into(),
            album_artist: Some("Night Archive".into()),
            music_brainz_id: Some("189002e7-3285-4e2e-92a3-7f6c30d407a2".into()),
            duration: 210,
            track_number: 2,
            chosen_by_user: None,
        };
        assert!(validate_lastfm_track(&valid).is_ok());
        assert!(validate_lastfm_track(&LastFmTrackInput {
            title: "Bad\nTitle".into(),
            ..valid.clone()
        })
        .is_err());

        let radio = LastFmTrackInput {
            artist: "North Star".into(),
            title: "First light".into(),
            album: "Daybreak".into(),
            album_artist: None,
            music_brainz_id: None,
            duration: 120,
            track_number: 2,
            chosen_by_user: Some(false),
        };
        let parameters = lastfm_scrobble_parameters(&radio);
        assert_eq!(
            parameters.get("chosenByUser").map(String::as_str),
            Some("0")
        );
        assert!(!lastfm_track_parameters(&radio).contains_key("chosenByUser"));
        assert_eq!(
            lastfm_track_parameters(&valid)
                .get("albumArtist")
                .map(String::as_str),
            Some("Night Archive")
        );
        assert_eq!(
            lastfm_track_parameters(&valid)
                .get("mbid")
                .map(String::as_str),
            Some("189002e7-3285-4e2e-92a3-7f6c30d407a2")
        );
        assert!(validate_lastfm_track(&LastFmTrackInput {
            music_brainz_id: Some("not-an-mbid".into()),
            ..valid.clone()
        })
        .is_err());
    }

    #[test]
    fn preserves_supported_lastfm_identity_from_subsonic_tracks() {
        let track = track_from_value(
            &serde_json::json!({
                "id": "song-1",
                "title": "Afterimage",
                "artist": "Night Archive",
                "album": "Soft Focus",
                "albumId": "album-1",
                "duration": 210,
                "track": 2,
                "displayAlbumArtist": "Night Archive & Guests",
                "musicBrainzId": "189002e7-3285-4e2e-92a3-7f6c30d407a2"
            }),
            "album-1",
        )
        .expect("valid Subsonic track");

        assert_eq!(
            track.album_artist.as_deref(),
            Some("Night Archive & Guests")
        );
        assert_eq!(
            track.music_brainz_id.as_deref(),
            Some("189002e7-3285-4e2e-92a3-7f6c30d407a2")
        );
    }

    #[test]
    fn validates_bounded_player_state_and_rejects_unrestorable_tracks() {
        let valid = sample_player_state();
        assert!(validate_player_state(&valid).is_ok());

        let mut control_character = valid.clone();
        control_character.queue[0].title = "Bad\nTitle".into();
        assert!(validate_player_state(&control_character).is_err());

        let mut bad_palette = valid.clone();
        bad_palette.queue[0].palette[0] = "#fff\u{7f}".into();
        assert!(validate_player_state(&bad_palette).is_err());

        let mut discover = valid.clone();
        discover.queue[0].id = "discover:featured".into();
        assert!(validate_player_state(&discover).is_err());

        let mut radio = valid.clone();
        radio.queue[0].id = "radio:979".into();
        radio.last_fm_progress = None;
        radio.radio_scrobble_progress = Some(RadioScrobbleProgress {
            show_track_id: "radio:979".into(),
            active_chapter_key: Some("60:chapter".into()),
            chapter_started_at: 1_700_000_000,
            chapter_listened_seconds: 61.0,
            last_position: 121.0,
            chapter_now_playing_sent: true,
            chapter_scrobble_state: "pending".into(),
            show_started_at: 1_700_000_000,
            show_listened_seconds: 121.0,
            show_scrobble_state: "idle".into(),
            scrobbled_chapter_keys: Vec::new(),
        });
        assert!(validate_player_state(&radio).is_ok());
        normalize_restored_player_progress(&mut radio);
        let radio_progress = radio.radio_scrobble_progress.unwrap();
        assert_eq!(radio_progress.chapter_started_at, 0);
        assert!(!radio_progress.chapter_now_playing_sent);
        assert_eq!(radio_progress.chapter_scrobble_state, "sent");
        assert_eq!(radio_progress.scrobbled_chapter_keys, ["60:chapter"]);

        let mut implausible_track_number = valid.clone();
        implausible_track_number.queue[0].track = MAX_PLAYER_TRACK_NUMBER + 1;
        assert!(validate_player_state(&implausible_track_number).is_err());

        let mut oversized = valid;
        oversized.queue =
            vec![sample_player_track("track"); MAX_PLAYER_QUEUE_LENGTH.saturating_add(1)];
        assert!(validate_player_state(&oversized).is_err());
    }

    #[test]
    fn matches_the_shared_renderer_radio_persistence_contract() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/player-state-radio-contract.json"
        ))
        .unwrap();
        assert_eq!(
            contract["contractVersion"].as_u64(),
            Some(u64::from(PLAYER_STATE_CONTRACT_VERSION))
        );

        let mut state: PlayerStateSnapshot =
            serde_json::from_value(contract["snapshot"].clone()).unwrap();
        let checkpoint: PlayerStateCheckpoint =
            serde_json::from_value(contract["checkpoint"].clone()).unwrap();
        assert!(validate_player_state(&state).is_ok());
        assert!(validate_player_checkpoint(&checkpoint).is_ok());
        assert!(apply_player_checkpoint(&mut state, checkpoint));
        normalize_restored_player_progress(&mut state);

        assert_eq!(state.position_seconds, 125.0);
        let progress = state.radio_scrobble_progress.unwrap();
        assert_eq!(progress.show_track_id, "radio:979");
        assert_eq!(progress.chapter_scrobble_state, "sent");
        assert_eq!(progress.scrobbled_chapter_keys, ["60:chapter"]);
    }

    #[test]
    fn persisted_player_shape_rejects_urls_and_unknown_fields() {
        let state = sample_player_state();
        let serialized = serde_json::to_string(&state).unwrap();
        assert!(!serialized.contains("streamUrl"));
        assert!(!serialized.contains("artworkUrl"));

        let mut value = serde_json::to_value(state).unwrap();
        value["queue"][0]["streamUrl"] =
            Value::String("https://bandcamp.com/api/subsonic/rest/stream.view?t=signed".into());
        assert!(serde_json::from_value::<PlayerStateSnapshot>(value).is_err());
    }

    #[test]
    fn atomically_round_trips_player_state_and_discards_corruption() {
        let path = temporary_player_state_path("roundtrip");
        let directory = path.parent().unwrap().to_path_buf();
        let state = sample_player_state();

        write_player_state(&path, &state).unwrap();
        let restored = read_player_state(&path).unwrap().unwrap();
        assert_eq!(restored.queue[0].id, "track-1");
        assert_eq!(restored.position_seconds, 42.0);

        fs::write(&path, b"{ definitely not valid json").unwrap();
        assert!(load_player_state_or_clear_invalid(&path).unwrap().is_none());
        assert!(!path.exists());
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn lightweight_checkpoint_applies_only_to_the_matching_track() {
        let mut state = sample_player_state();
        let checkpoint = PlayerStateCheckpoint {
            current_index: 0,
            current_track_id: "track-1".into(),
            position_seconds: 90.0,
            last_fm_progress: Some(LastFmPlaybackProgress {
                track_id: "track-1".into(),
                started_at: 1_700_000_000,
                listened_seconds: 85.0,
                last_position: 90.0,
                now_playing_sent: true,
                scrobble_state: "pending".into(),
            }),
            radio_scrobble_progress: None,
        };
        assert!(apply_player_checkpoint(&mut state, checkpoint));
        normalize_restored_player_progress(&mut state);
        assert_eq!(state.position_seconds, 90.0);
        let progress = state.last_fm_progress.unwrap();
        assert_eq!(progress.started_at, 0);
        assert!(!progress.now_playing_sent);
        assert_eq!(progress.scrobble_state, "sent");

        let mut another_state = sample_player_state();
        let stale = PlayerStateCheckpoint {
            current_index: 0,
            current_track_id: "another-track".into(),
            position_seconds: 120.0,
            last_fm_progress: None,
            radio_scrobble_progress: None,
        };
        assert!(!apply_player_checkpoint(&mut another_state, stale));
        assert_eq!(another_state.position_seconds, 42.0);
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

    #[test]
    fn parses_and_bounds_public_radio_metadata() {
        let summary = radio_summary_from_raw(RawRadioSummary {
            id: 979,
            subtitle: "  Kinrose  ".into(),
            desc: "A new\nshow".into(),
            published_date: "24 Jul 2026 00:00:00 GMT".into(),
            v2_image_id: Some(46_240_870),
            screen_image_id: None,
            image_id: None,
        })
        .unwrap();
        assert_eq!(summary.subtitle, "Kinrose");
        assert_eq!(summary.description, "A new show");
        assert_eq!(
            summary.artwork_url.as_deref(),
            Some("https://f4.bcbits.com/img/0046240870_10.jpg")
        );

        let show = radio_show_from_raw(
            serde_json::from_value(serde_json::json!({
                "show_id": 979,
                "title": "The Hip Hop Show",
                "subtitle": "Kinrose",
                "desc": "Episode notes",
                "published_date": "24 Jul 2026 00:00:00 GMT",
                "show_v2_image_id": 46240870,
                "audio_duration": 4936.75,
                "audio_stream": {
                    "mp3-128": "https://bandcamp.com/stream_redirect?enc=mp3-128"
                },
                "tracks": [{
                    "title": "Example",
                    "artist": "Artist",
                    "album_title": "Album",
                    "timecode": 92.4,
                    "track_url": "https://artist.bandcamp.com/track/example",
                    "album_url": "https://artist.bandcamp.com/album/example",
                    "track_art_id": 12345,
                    "url_hints": {
                        "subdomain": "artist"
                    }
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(show.duration, 4937);
        assert_eq!(show.chapters.len(), 1);
        assert_eq!(show.chapters[0].timecode, 92);
        assert_eq!(
            show.chapters[0].artist_url.as_deref(),
            Some("https://artist.bandcamp.com/")
        );
        assert_eq!(
            show.chapters[0].album_url.as_deref(),
            Some("https://artist.bandcamp.com/album/example")
        );
        assert_eq!(
            show.chapters[0].artwork_url.as_deref(),
            Some("https://f4.bcbits.com/img/a12345_10.jpg")
        );
    }

    #[test]
    fn rejects_untrusted_radio_chapter_links_and_url_hints() {
        let show = radio_show_from_raw(
            serde_json::from_value(serde_json::json!({
                "show_id": 979,
                "title": "The Hip Hop Show",
                "subtitle": "Kinrose",
                "audio_duration": 60,
                "audio_stream": {
                    "mp3-128": "https://bandcamp.com/stream_redirect?enc=mp3-128"
                },
                "tracks": [{
                    "title": "Example",
                    "artist": "Artist",
                    "album_title": "Album",
                    "timecode": 0,
                    "track_url": "https://evil.example/track/example",
                    "album_url": "https://evil.example/album/example",
                    "url_hints": {
                        "subdomain": "artist.evil.example"
                    }
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        let chapter = &show.chapters[0];
        assert!(chapter.item_url.is_none());
        assert!(chapter.artist_url.is_none());
        assert!(chapter.album_url.is_none());
    }

    #[test]
    fn rejects_untrusted_radio_stream_hosts() {
        let raw: RawRadioShow = serde_json::from_value(serde_json::json!({
            "show_id": 1,
            "title": "Bandcamp Radio",
            "subtitle": "Example",
            "audio_duration": 60,
            "audio_stream": { "mp3-128": "https://evil.example/show.mp3" }
        }))
        .unwrap();
        assert!(radio_show_from_raw(raw).is_err());
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
