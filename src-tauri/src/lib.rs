use governor::{DefaultDirectRateLimiter, Jitter, Quota, RateLimiter};
use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use redb::{
    Database, DatabaseError, ReadableDatabase, ReadableTable, ReadableTableMetadata, StorageError,
    TableDefinition,
};
use reqwest::{
    header::{HeaderMap, RETRY_AFTER},
    redirect::Policy,
    Client, RequestBuilder, Response, StatusCode,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    ipc::Channel,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

#[cfg(target_os = "macos")]
mod macos_window;

#[cfg(desktop)]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use url::Url;

const SERVICE_NAME: &str = "com.coda.bandcamp";
const CREDENTIAL_KEY: &str = "subsonic";
const SERVER_BASE: &str = "https://bandcamp.com/api/subsonic";
const DISCOVER_ENDPOINT: &str = "https://bandcamp.com/api/discover/1/discover_web";
const RADIO_LIST_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/list";
const RADIO_SHOWS_ENDPOINT: &str = "https://bandcamp.com/api/radio_api/1/get_radio_shows";
const RADIO_SHOW_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/get";
const CLIENT_NAME: &str = "Coda";
const API_VERSION: &str = "1.16.1";
const MAX_CREDENTIAL_LENGTH: usize = 512;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const BANDCAMP_REQUESTS_PER_SECOND: u32 = 2;
const BANDCAMP_MAX_READ_RETRIES: u32 = 2;
const BANDCAMP_RETRY_BASE_MS: u64 = 400;
const BANDCAMP_RETRY_JITTER_MS: u64 = 180;
const BANDCAMP_MAX_RETRY_DELAY: Duration = Duration::from_secs(30);
const BANDCAMP_RATE_LIMIT_JITTER: Duration = Duration::from_millis(80);
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
const RADIO_SHOW_PAGE_SIZE: u64 = 24;
const MAX_RADIO_CURSOR_LENGTH: usize = 128;
const MAX_RADIO_CHAPTERS: usize = 256;
const MAX_RADIO_TEXT_LENGTH: usize = 4_096;
const MAX_RADIO_DURATION_SECONDS: f64 = 24.0 * 60.0 * 60.0;
const RADIO_SERIES_CATALOG: &[(u64, &str, &str)] = &[
    (1, "Bandcamp Electronic", "bandcamp-electronic"),
    (2, "Bandcamp Selects", "bandcamp-selects"),
    (4, "The Game Show", "the-game-show"),
    (5, "The Hip Hop Show", "the-hip-hop-show"),
    (6, "The Indie Show", "the-indie-show"),
    (7, "The Metal Show", "the-metal-show"),
];
const LIBRARY_CACHE_VERSION: u8 = 1;
const LIBRARY_CACHE_FILE: &str = "library-cache-v1.json";
const LIBRARY_CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const LIBRARY_FULL_RECONCILE_INTERVAL_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_LIBRARY_ALBUMS: usize = 5_000;
const MAX_LIBRARY_CACHE_BYTES: usize = 32 * 1024 * 1024;
const ALBUM_METADATA_CACHE_FILE: &str = "album-metadata-cache-v1.redb";
const ALBUM_TRACK_CACHE_ENTRY_VERSION: u8 = 1;
const PERSISTED_ALBUM_TRACK_CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_ENTRIES: usize = 256;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_WEIGHT: usize = 4_096;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PERSISTED_ALBUM_TRACK_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const REDB_ALBUM_METADATA_MEMORY_CACHE_BYTES: usize = 8 * 1024 * 1024;
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
const PLAYER_DIAGNOSTIC_FILE: &str = "player-state-diagnostic.log";
const MAX_PLAYER_DIAGNOSTIC_BYTES: u64 = 64 * 1024;
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
static BANDCAMP_RATE_LIMITER: OnceLock<DefaultDirectRateLimiter> = OnceLock::new();
static PLAYER_STATE_LOCK: Mutex<()> = Mutex::new(());
static LIBRARY_CACHE_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_DATABASE_INIT_LOCK: Mutex<()> = Mutex::new(());
static CONNECTION_GENERATION: AtomicU64 = AtomicU64::new(0);
static LIBRARY_SYNC_GENERATION: AtomicU64 = AtomicU64::new(0);
static ALBUM_METADATA_DATABASE: OnceLock<Database> = OnceLock::new();
static ALBUM_REFRESH_GENERATIONS: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
const ALBUM_TRACKS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("album_tracks_v1");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionInput {
    username: String,
    password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LibraryCacheSnapshot {
    version: u8,
    saved_at: u64,
    #[serde(default)]
    last_full_sync_at: u64,
    albums: Vec<Album>,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum LibrarySyncEvent {
    Page {
        page_index: u64,
        loaded: usize,
        albums: Vec<Album>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedAlbumTracks {
    version: u8,
    saved_at: u64,
    album_id: String,
    tracks: Vec<Track>,
}

fn album_refresh_generations() -> &'static Mutex<BTreeMap<String, u64>> {
    ALBUM_REFRESH_GENERATIONS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn album_refresh_generation(album_id: &str) -> Result<u64, String> {
    album_refresh_generations()
        .lock()
        .map_err(|_| "The album refresh state is unavailable.".to_string())
        .map(|generations| generations.get(album_id).copied().unwrap_or(0))
}

fn bump_album_refresh_generation(album_id: &str) -> Result<u64, String> {
    let mut generations = album_refresh_generations()
        .lock()
        .map_err(|_| "The album refresh state is unavailable.".to_string())?;
    let generation = generations.entry(album_id.to_string()).or_default();
    *generation = generation.saturating_add(1);
    Ok(*generation)
}

fn clear_album_refresh_generations() {
    if let Some(generations) = ALBUM_REFRESH_GENERATIONS.get() {
        if let Ok(mut generations) = generations.lock() {
            generations.clear();
        }
    }
}

fn album_metadata_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(ALBUM_METADATA_CACHE_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

fn open_album_metadata_database(path: &Path) -> Result<Database, String> {
    let directory = path
        .parent()
        .ok_or_else(|| "The album metadata cache path is invalid.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create Coda's application data directory: {error}"))?;
    match fs::metadata(path) {
        Ok(metadata) if metadata.len() > MAX_PERSISTED_ALBUM_TRACK_CACHE_FILE_BYTES => {
            fs::remove_file(path).map_err(|error| {
                format!("Could not replace the oversized album metadata cache: {error}")
            })?;
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Could not inspect the album metadata cache: {error}"
            ))
        }
    }

    let create_database = || {
        let mut builder = Database::builder();
        builder.set_cache_size(REDB_ALBUM_METADATA_MEMORY_CACHE_BYTES);
        builder.create(path)
    };
    let database = match create_database() {
        Ok(database) => database,
        Err(
            open_error @ (DatabaseError::Storage(StorageError::Corrupted(_))
            | DatabaseError::UpgradeRequired(_)),
        ) => {
            fs::remove_file(path).map_err(|remove_error| {
                format!("Could not recover the album metadata cache ({open_error}; {remove_error})")
            })?;
            create_database()
                .map_err(|error| format!("Could not recreate the album metadata cache: {error}"))?
        }
        Err(error) => return Err(format!("Could not open the album metadata cache: {error}")),
    };
    let transaction = database
        .begin_write()
        .map_err(|error| format!("Could not prepare the album metadata cache: {error}"))?;
    {
        transaction
            .open_table(ALBUM_TRACKS_TABLE)
            .map_err(|error| format!("Could not initialize the album metadata cache: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not initialize the album metadata cache: {error}"))?;
    Ok(database)
}

fn album_metadata_database(app: &tauri::AppHandle) -> Result<&'static Database, String> {
    if let Some(database) = ALBUM_METADATA_DATABASE.get() {
        return Ok(database);
    }
    // Do not memoize transient filesystem failures for the lifetime of the
    // process. A later cache access can recover after a lock or permission
    // issue clears.
    let _guard = ALBUM_METADATA_DATABASE_INIT_LOCK
        .lock()
        .map_err(|_| "The album metadata cache initializer is unavailable.".to_string())?;
    if let Some(database) = ALBUM_METADATA_DATABASE.get() {
        return Ok(database);
    }
    let path = album_metadata_cache_path(app)?;
    let database = open_album_metadata_database(&path)?;
    let _ = ALBUM_METADATA_DATABASE.set(database);
    ALBUM_METADATA_DATABASE
        .get()
        .ok_or_else(|| "Could not initialize the album metadata cache.".to_string())
}

fn album_track_cache_namespace(credentials: &ConnectionInput) -> String {
    // This is an opaque, stable cache namespace rather than a security
    // boundary. The password is deliberately excluded so neither credential
    // is persisted and password rotation does not strand valid metadata.
    format!("{:x}", md5::compute(credentials.username.as_bytes()))
}

fn persisted_album_track_cache_key(credentials: &ConnectionInput, album_id: &str) -> String {
    format!("{}:{album_id}", album_track_cache_namespace(credentials))
}

fn album_id_from_persisted_cache_key(key: &str) -> Option<&str> {
    let (namespace, album_id) = key.split_once(':')?;
    if namespace.len() != 32
        || !namespace
            .bytes()
            .all(|character| character.is_ascii_hexdigit())
        || validate_identifier(album_id).is_err()
    {
        return None;
    }
    Some(album_id)
}

fn validate_persisted_album_tracks(
    entry: &PersistedAlbumTracks,
    album_id: &str,
    now: u64,
) -> Result<(), String> {
    if entry.version != ALBUM_TRACK_CACHE_ENTRY_VERSION
        || entry.saved_at > now
        || now.saturating_sub(entry.saved_at) > PERSISTED_ALBUM_TRACK_CACHE_TTL_MS
        || entry.album_id != album_id
        || entry.tracks.len().max(1) > MAX_PERSISTED_ALBUM_TRACK_CACHE_WEIGHT
    {
        return Err("The saved album metadata is stale or incompatible.".into());
    }
    if entry.tracks.iter().any(|track| {
        track.album_id != album_id
            || validate_subsonic_id(&track.id, "song").is_err()
            || validate_subsonic_id(&track.album_id, "album").is_err()
            || !valid_subsonic_text(&track.title, MAX_SUBSONIC_TEXT_LENGTH, true)
            || !valid_subsonic_text(&track.artist, MAX_SUBSONIC_TEXT_LENGTH, true)
            || !valid_subsonic_text(&track.album, MAX_SUBSONIC_TEXT_LENGTH, false)
            || track.duration > MAX_SUBSONIC_DURATION_SECONDS
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
    }) {
        return Err("The saved album metadata contains an invalid track.".into());
    }
    Ok(())
}

fn remove_persisted_album_tracks(database: &Database, cache_key: &str) -> Result<(), String> {
    let _guard = ALBUM_METADATA_CACHE_WRITE_LOCK
        .lock()
        .map_err(|_| "The album metadata cache lock is unavailable.".to_string())?;
    let transaction = database
        .begin_write()
        .map_err(|error| format!("Could not update the album metadata cache: {error}"))?;
    {
        let mut table = transaction
            .open_table(ALBUM_TRACKS_TABLE)
            .map_err(|error| format!("Could not open the album metadata cache: {error}"))?;
        drop(
            table
                .remove(cache_key)
                .map_err(|error| format!("Could not prune the album metadata cache: {error}"))?,
        );
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not prune the album metadata cache: {error}"))
}

fn read_persisted_album_tracks(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    now: u64,
) -> Result<Option<Vec<Track>>, String> {
    let serialized = {
        let transaction = database
            .begin_read()
            .map_err(|error| format!("Could not read the album metadata cache: {error}"))?;
        let table = transaction
            .open_table(ALBUM_TRACKS_TABLE)
            .map_err(|error| format!("Could not open the album metadata cache: {error}"))?;
        let value = table
            .get(cache_key)
            .map_err(|error| format!("Could not read the album metadata cache: {error}"))?;
        value.map(|value| value.value().to_vec())
    };
    let Some(serialized) = serialized else {
        return Ok(None);
    };
    if serialized.len() > MAX_PERSISTED_ALBUM_TRACK_ENTRY_BYTES {
        remove_persisted_album_tracks(database, cache_key)?;
        return Ok(None);
    }
    let entry = match serde_json::from_slice::<PersistedAlbumTracks>(&serialized) {
        Ok(entry) if validate_persisted_album_tracks(&entry, album_id, now).is_ok() => entry,
        _ => {
            remove_persisted_album_tracks(database, cache_key)?;
            return Ok(None);
        }
    };
    Ok(Some(entry.tracks))
}

#[derive(Debug)]
struct PersistedAlbumTrackIndex {
    key: String,
    saved_at: u64,
    bytes: usize,
}

fn write_persisted_album_tracks(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    tracks: &[Track],
    now: u64,
    expected_connection: Option<(u64, &ConnectionInput)>,
    expected_refresh: Option<(&str, u64)>,
) -> Result<bool, String> {
    let _guard = ALBUM_METADATA_CACHE_WRITE_LOCK
        .lock()
        .map_err(|_| "The album metadata cache lock is unavailable.".to_string())?;
    if expected_connection.is_some_and(|(expected_generation, expected_credentials)| {
        CONNECTION_GENERATION.load(Ordering::Acquire) != expected_generation
            || load_credentials().ok().as_ref() != Some(expected_credentials)
    }) || expected_refresh.is_some_and(|(expected_album_id, expected_generation)| {
        album_refresh_generation(expected_album_id).ok() != Some(expected_generation)
    }) {
        return Ok(false);
    }
    let entry = PersistedAlbumTracks {
        version: ALBUM_TRACK_CACHE_ENTRY_VERSION,
        saved_at: now,
        album_id: album_id.to_string(),
        tracks: tracks.to_vec(),
    };
    if tracks.is_empty() || validate_persisted_album_tracks(&entry, album_id, now).is_err() {
        return Ok(false);
    }
    let serialized = serde_json::to_vec(&entry)
        .map_err(|error| format!("Could not prepare the album metadata cache: {error}"))?;
    if serialized.len() > MAX_PERSISTED_ALBUM_TRACK_ENTRY_BYTES
        || serialized.len() > MAX_PERSISTED_ALBUM_TRACK_CACHE_BYTES
    {
        return Ok(false);
    }

    let transaction = database
        .begin_write()
        .map_err(|error| format!("Could not update the album metadata cache: {error}"))?;
    {
        let mut table = transaction
            .open_table(ALBUM_TRACKS_TABLE)
            .map_err(|error| format!("Could not open the album metadata cache: {error}"))?;
        drop(table.remove(cache_key).map_err(|error| {
            format!("Could not replace the album metadata cache entry: {error}")
        })?);
        table
            .insert(cache_key, serialized.as_slice())
            .map_err(|error| format!("Could not save the album metadata cache: {error}"))?;
        let exceeds_entry_limit = table
            .len()
            .map_err(|error| format!("Could not inspect the album metadata cache: {error}"))?
            > MAX_PERSISTED_ALBUM_TRACK_CACHE_ENTRIES as u64;
        drop(table);

        let exceeds_byte_limit = transaction
            .stats()
            .map_err(|error| format!("Could not inspect the album metadata cache: {error}"))?
            .stored_bytes()
            > MAX_PERSISTED_ALBUM_TRACK_CACHE_BYTES as u64;
        if exceeds_entry_limit || exceeds_byte_limit {
            let mut table = transaction
                .open_table(ALBUM_TRACKS_TABLE)
                .map_err(|error| format!("Could not open the album metadata cache: {error}"))?;
            let mut retained = Vec::new();
            let mut discard = Vec::new();
            {
                let iterator = table.iter().map_err(|error| {
                    format!("Could not inspect the album metadata cache: {error}")
                })?;
                for item in iterator {
                    let (key, value) = item.map_err(|error| {
                        format!("Could not inspect the album metadata cache: {error}")
                    })?;
                    let key = key.value().to_string();
                    let bytes = value.value();
                    let indexed = album_id_from_persisted_cache_key(&key)
                        .and_then(|cached_album_id| {
                            serde_json::from_slice::<PersistedAlbumTracks>(bytes)
                                .ok()
                                .filter(|entry| {
                                    validate_persisted_album_tracks(entry, cached_album_id, now)
                                        .is_ok()
                                })
                        })
                        .map(|entry| PersistedAlbumTrackIndex {
                            key: key.clone(),
                            saved_at: entry.saved_at,
                            bytes: key.len().saturating_add(bytes.len()),
                        });
                    match indexed {
                        Some(indexed) => retained.push(indexed),
                        None => discard.push(key),
                    }
                }
            }
            for key in discard {
                drop(table.remove(key.as_str()).map_err(|error| {
                    format!("Could not prune the album metadata cache: {error}")
                })?);
            }
            retained.sort_by(|left, right| {
                left.saved_at
                    .cmp(&right.saved_at)
                    .then_with(|| left.key.cmp(&right.key))
            });
            let mut total_bytes = retained.iter().map(|entry| entry.bytes).sum::<usize>();
            let mut total_entries = retained.len();
            for entry in retained {
                if total_entries <= MAX_PERSISTED_ALBUM_TRACK_CACHE_ENTRIES
                    && total_bytes <= MAX_PERSISTED_ALBUM_TRACK_CACHE_BYTES
                {
                    break;
                }
                drop(
                    table
                        .remove(entry.key.as_str())
                        .map_err(|error| format!("Could not evict old album metadata: {error}"))?,
                );
                total_entries = total_entries.saturating_sub(1);
                total_bytes = total_bytes.saturating_sub(entry.bytes);
            }
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not save the album metadata cache: {error}"))?;
    Ok(true)
}

fn clear_persisted_album_tracks(database: &Database) -> Result<(), String> {
    let _guard = ALBUM_METADATA_CACHE_WRITE_LOCK
        .lock()
        .map_err(|_| "The album metadata cache lock is unavailable.".to_string())?;
    let transaction = database
        .begin_write()
        .map_err(|error| format!("Could not clear the album metadata cache: {error}"))?;
    {
        let mut table = transaction
            .open_table(ALBUM_TRACKS_TABLE)
            .map_err(|error| format!("Could not open the album metadata cache: {error}"))?;
        table
            .retain(|_, _| false)
            .map_err(|error| format!("Could not clear the album metadata cache: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not clear the album metadata cache: {error}"))
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
    series: Option<RadioSeries>,
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
    series: Option<RadioSeries>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadioSeries {
    id: u64,
    title: String,
    slug: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadioShowsPage {
    results: Vec<RadioShowSummary>,
    cursor: Option<String>,
    has_more: bool,
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
#[serde(rename_all = "camelCase")]
struct RawRadioShowsPage {
    #[serde(default)]
    items: Vec<RawRadioSeriesShow>,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRadioSeriesShow {
    item_id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    date: String,
    image_id: Option<u64>,
    franchise_name: Option<String>,
}

#[derive(Debug, Serialize)]
struct RadioShowsRequest {
    page_size: u64,
    next_cursor: Option<String>,
    radio_franchise_id: Option<u64>,
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

fn library_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LIBRARY_CACHE_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

fn player_state_track_kind(id: Option<&str>) -> &'static str {
    match id {
        Some(value) if value.starts_with("radio:") => "radio",
        Some(_) => "library",
        None => "none",
    }
}

fn player_state_error_kind(error: &str) -> &'static str {
    if error.contains("lock") {
        "lock"
    } else if error.contains("malformed") {
        "malformed"
    } else if error.contains("invalid")
        || error.contains("belongs")
        || error.contains("conflicting")
    {
        "validation"
    } else if error.contains("open") {
        "open"
    } else if error.contains("read") || error.contains("inspect") {
        "read"
    } else if error.contains("write") || error.contains("replace") || error.contains("finalize") {
        "write"
    } else {
        "other"
    }
}

fn append_player_state_diagnostic(
    app: &tauri::AppHandle,
    event: &str,
    queue_len: Option<usize>,
    current_index: Option<usize>,
    track_kind: &'static str,
    position_seconds: Option<f64>,
) {
    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join(PLAYER_DIAGNOSTIC_FILE);
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() >= MAX_PLAYER_DIAGNOSTIC_BYTES)
    {
        let _ = fs::remove_file(&path);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let queue = queue_len
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".into());
    let index = current_index
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".into());
    let position = position_seconds
        .filter(|value| value.is_finite())
        .map(|value| format!("{value:.3}"))
        .unwrap_or_else(|| "-".into());
    let line = format!(
        "{timestamp} event={event} queue={queue} index={index} kind={track_kind} position={position}\n"
    );
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

fn append_player_state_snapshot_diagnostic(
    app: &tauri::AppHandle,
    event: &str,
    state: &PlayerStateSnapshot,
) {
    let current = state.queue.get(state.current_index);
    append_player_state_diagnostic(
        app,
        event,
        Some(state.queue.len()),
        Some(state.current_index),
        player_state_track_kind(current.map(|track| track.id.as_str())),
        Some(state.position_seconds),
    );
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
            || !valid_player_text(&track.album, false)
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
        .ok_or_else(|| format!("The {label} path is invalid."))?;
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

fn validate_library_cache(snapshot: &LibraryCacheSnapshot, now: u64) -> Result<(), String> {
    if snapshot.version != LIBRARY_CACHE_VERSION {
        return Err("The saved library uses an unsupported version.".into());
    }
    if snapshot.saved_at > now {
        return Err("The saved library timestamp is in the future.".into());
    }
    if snapshot.last_full_sync_at > snapshot.saved_at {
        return Err("The saved library reconciliation timestamp is invalid.".into());
    }
    if now.saturating_sub(snapshot.saved_at) > LIBRARY_CACHE_TTL_MS {
        return Err("The saved library has expired.".into());
    }
    if snapshot.albums.len() > MAX_LIBRARY_ALBUMS {
        return Err("The saved library contains too many albums.".into());
    }
    for album in &snapshot.albums {
        validate_album(album)
            .map_err(|_| "The saved library contains invalid album metadata.".to_string())?;
    }
    Ok(())
}

fn read_library_cache(path: &Path, now: u64) -> Result<Option<LibraryCacheSnapshot>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not open the saved library: {error}")),
    };
    if file
        .metadata()
        .map_err(|error| format!("Could not inspect the saved library: {error}"))?
        .len()
        > MAX_LIBRARY_CACHE_BYTES as u64
    {
        return Err("The saved library is unexpectedly large.".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_LIBRARY_CACHE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the saved library: {error}"))?;
    if bytes.len() > MAX_LIBRARY_CACHE_BYTES {
        return Err("The saved library is unexpectedly large.".into());
    }
    let snapshot: LibraryCacheSnapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved library is malformed.".to_string())?;
    validate_library_cache(&snapshot, now)?;
    Ok(Some(snapshot))
}

fn write_library_cache(
    path: &Path,
    albums: &[Album],
    saved_at: u64,
    last_full_sync_at: u64,
) -> Result<(), String> {
    if albums.len() > MAX_LIBRARY_ALBUMS {
        return Err("The library is too large to cache safely.".into());
    }
    let snapshot = LibraryCacheSnapshot {
        version: LIBRARY_CACHE_VERSION,
        saved_at,
        last_full_sync_at,
        albums: albums.to_vec(),
    };
    validate_library_cache(&snapshot, saved_at)?;
    let serialized = serde_json::to_vec(&snapshot)
        .map_err(|error| format!("Could not prepare the library cache: {error}"))?;
    if serialized.len() > MAX_LIBRARY_CACHE_BYTES {
        return Err("The saved library is unexpectedly large.".into());
    }
    write_bytes_atomically(path, &serialized, "library cache")
}

fn load_library_cache_or_clear_invalid(
    path: &Path,
    now: u64,
) -> Result<Option<LibraryCacheSnapshot>, String> {
    match read_library_cache(path, now) {
        Ok(snapshot) => Ok(snapshot),
        Err(error)
            if error.contains("malformed")
                || error.contains("unsupported version")
                || error.contains("timestamp")
                || error.contains("expired")
                || error.contains("too many")
                || error.contains("invalid album")
                || error.contains("unexpectedly large") =>
        {
            match fs::remove_file(path) {
                Ok(()) => Ok(None),
                Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => {
                    Ok(None)
                }
                Err(remove_error) => Err(format!(
                    "Could not remove an invalid saved library ({error}; {remove_error})"
                )),
            }
        }
        Err(error) => Err(error),
    }
}

fn save_library_cache_if_connection_current(
    app: &tauri::AppHandle,
    albums: &[Album],
    expected_generation: u64,
    expected_sync_generation: u64,
    expected_credentials: &ConnectionInput,
    replace_connection: bool,
    last_full_sync_at: u64,
) -> Result<bool, String> {
    let _guard = LIBRARY_CACHE_LOCK
        .lock()
        .map_err(|_| "The library cache lock is unavailable.".to_string())?;
    if CONNECTION_GENERATION.load(Ordering::Acquire) != expected_generation
        || LIBRARY_SYNC_GENERATION.load(Ordering::Acquire) != expected_sync_generation
        || load_credentials().ok().as_ref() != Some(expected_credentials)
    {
        return Ok(false);
    }
    let path = library_cache_path(app)?;
    if replace_connection {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Could not remove the prior saved library before reconnecting: {error}"
                ))
            }
        }
    }
    write_library_cache(&path, albums, player_timestamp_ms()?, last_full_sync_at)?;
    Ok(true)
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

fn radio_series_by_id(id: u64) -> Option<RadioSeries> {
    RADIO_SERIES_CATALOG
        .iter()
        .find(|(series_id, _, _)| *series_id == id)
        .map(|(series_id, title, slug)| RadioSeries {
            id: *series_id,
            title: (*title).into(),
            slug: (*slug).into(),
        })
}

fn radio_series_by_title(title: &str) -> Option<RadioSeries> {
    RADIO_SERIES_CATALOG
        .iter()
        .find(|(_, series_title, _)| series_title.eq_ignore_ascii_case(title.trim()))
        .map(|(id, series_title, slug)| RadioSeries {
            id: *id,
            title: (*series_title).into(),
            slug: (*slug).into(),
        })
}

fn validate_radio_cursor(cursor: Option<String>) -> Result<Option<String>, String> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    if cursor.is_empty()
        || cursor.len() > MAX_RADIO_CURSOR_LENGTH
        || !cursor
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
    {
        return Err("The Bandcamp Radio page cursor is invalid.".into());
    }
    Ok(Some(cursor))
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
        series: None,
    })
}

fn radio_summary_from_series_raw(
    value: RawRadioSeriesShow,
    requested_series: Option<&RadioSeries>,
) -> Option<RadioShowSummary> {
    if value.item_id == 0 {
        return None;
    }
    let series = value
        .franchise_name
        .as_deref()
        .and_then(radio_series_by_title)
        .or_else(|| requested_series.cloned());
    Some(RadioShowSummary {
        id: value.item_id,
        subtitle: clean_radio_text(&value.title, "Untitled episode"),
        description: clean_radio_text(&value.description, "A Bandcamp-curated radio show."),
        published_at: clean_radio_text(&value.date, "Date unavailable"),
        artwork_url: radio_artwork_url(value.image_id),
        series,
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

    let title = clean_radio_text(&value.title, "Bandcamp Radio");
    Ok(RadioShow {
        id: value.show_id,
        series: radio_series_by_title(&title),
        title,
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum BandcampRetryPolicy {
    Never,
    SafeRead,
}

fn bandcamp_rate_limiter() -> &'static DefaultDirectRateLimiter {
    BANDCAMP_RATE_LIMITER.get_or_init(|| {
        let requests_per_second = NonZeroU32::new(BANDCAMP_REQUESTS_PER_SECOND)
            .expect("the Bandcamp request rate must be non-zero");
        let burst = NonZeroU32::new(1).expect("the Bandcamp request burst must be non-zero");
        RateLimiter::direct(Quota::per_second(requests_per_second).allow_burst(burst))
    })
}

async fn wait_for_bandcamp_request_slot() {
    bandcamp_rate_limiter()
        .until_ready_with_jitter(Jitter::up_to(BANDCAMP_RATE_LIMIT_JITTER))
        .await;
}

fn retry_after_duration(headers: &HeaderMap, now: SystemTime) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds).min(BANDCAMP_MAX_RETRY_DELAY));
    }
    httpdate::parse_http_date(value)
        .ok()?
        .duration_since(now)
        .ok()
        .map(|duration| duration.min(BANDCAMP_MAX_RETRY_DELAY))
}

fn bandcamp_retry_delay(
    headers: Option<&HeaderMap>,
    retry_number: u32,
    now: SystemTime,
    jitter_ms: u64,
) -> Duration {
    let exponential_ms = BANDCAMP_RETRY_BASE_MS.saturating_mul(1_u64 << retry_number.min(6));
    let base = headers
        .and_then(|headers| retry_after_duration(headers, now))
        .unwrap_or_else(|| Duration::from_millis(exponential_ms));
    base.saturating_add(Duration::from_millis(jitter_ms))
        .min(BANDCAMP_MAX_RETRY_DELAY)
}

fn is_retryable_bandcamp_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::REQUEST_TIMEOUT
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

async fn send_bandcamp_request(
    request: RequestBuilder,
    context: &str,
    retry_policy: BandcampRetryPolicy,
) -> Result<Response, String> {
    let mut retry_number = 0;
    loop {
        wait_for_bandcamp_request_slot().await;
        let attempt = request
            .try_clone()
            .ok_or_else(|| format!("Could not prepare a retry-safe request for {context}."))?;
        match attempt.send().await {
            Ok(response)
                if retry_policy == BandcampRetryPolicy::SafeRead
                    && retry_number < BANDCAMP_MAX_READ_RETRIES
                    && is_retryable_bandcamp_status(response.status()) =>
            {
                let jitter_ms = rand::thread_rng().gen_range(0..=BANDCAMP_RETRY_JITTER_MS);
                let delay = bandcamp_retry_delay(
                    Some(response.headers()),
                    retry_number,
                    SystemTime::now(),
                    jitter_ms,
                );
                retry_number += 1;
                tokio::time::sleep(delay).await;
            }
            Ok(response) => return Ok(response),
            Err(error)
                if retry_policy == BandcampRetryPolicy::SafeRead
                    && retry_number < BANDCAMP_MAX_READ_RETRIES
                    && (error.is_connect() || error.is_timeout()) =>
            {
                let jitter_ms = rand::thread_rng().gen_range(0..=BANDCAMP_RETRY_JITTER_MS);
                let delay = bandcamp_retry_delay(None, retry_number, SystemTime::now(), jitter_ms);
                retry_number += 1;
                tokio::time::sleep(delay).await;
            }
            Err(error) => return Err(format!("Could not reach {context}: {error}")),
        }
    }
}

async fn fetch_bounded_json_request<T: DeserializeOwned>(
    request: RequestBuilder,
    context: &str,
) -> Result<T, String> {
    let response = send_bandcamp_request(
        request.header(reqwest::header::ACCEPT, "application/json"),
        context,
        BandcampRetryPolicy::SafeRead,
    )
    .await?;
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

async fn fetch_bounded_json<T: DeserializeOwned>(url: Url, context: &str) -> Result<T, String> {
    fetch_bounded_json_request(http_client()?.get(url), context).await
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
    let response = send_bandcamp_request(
        http_client()?.get(url),
        "Bandcamp",
        BandcampRetryPolicy::SafeRead,
    )
    .await?;
    parse_subsonic_response(response).await
}

async fn request_mutation_json(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(String, String)],
) -> Result<Value, String> {
    let url = authenticated_url(endpoint, credentials, &[])?;
    let response = send_bandcamp_request(
        http_client()?.post(url).form(extra),
        "Bandcamp",
        BandcampRetryPolicy::Never,
    )
    .await?;
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

fn validate_album(album: &Album) -> Result<(), String> {
    validate_subsonic_id(&album.id, "album")?;
    if !valid_subsonic_text(&album.title, MAX_SUBSONIC_TEXT_LENGTH, true)
        || !valid_subsonic_text(&album.artist, MAX_SUBSONIC_TEXT_LENGTH, true)
        || album.song_count > MAX_PLAYLIST_TRACKS as u64
        || album.duration > MAX_SUBSONIC_DURATION_SECONDS
        || album.year.is_some_and(|year| year > 9_999)
        || album
            .cover_art
            .as_deref()
            .is_some_and(|cover| validate_subsonic_id(cover, "cover artwork").is_err())
        || album
            .genre
            .as_deref()
            .is_some_and(|genre| !valid_subsonic_text(genre, MAX_SUBSONIC_TEXT_LENGTH, false))
        || album
            .added_at
            .as_deref()
            .is_some_and(|date| !valid_subsonic_text(date, MAX_SUBSONIC_TEXT_LENGTH, false))
    {
        return Err("Bandcamp returned invalid album metadata.".into());
    }
    Ok(())
}

fn bounded_album_from_value(value: &Value) -> Option<Album> {
    let album = album_from_value(value)?;
    validate_album(&album).ok()?;
    Some(album)
}

fn track_from_value(value: &Value, fallback_album_id: &str) -> Option<Track> {
    let id = string_field(value, &["id"])?;
    Some(Track {
        id,
        title: string_field(value, &["title"]).unwrap_or_else(|| "Untitled track".into()),
        artist: string_field(value, &["artist"]).unwrap_or_else(|| "Unknown artist".into()),
        album: string_field(value, &["album"]).unwrap_or_default(),
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
        || !valid_subsonic_text(&track.album, MAX_SUBSONIC_TEXT_LENGTH, false)
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

fn playlist_track_album_id(value: &Value) -> Option<String> {
    match value.get("albumId") {
        Some(Value::String(album_id)) => return Some(album_id.clone()),
        None | Some(Value::Null) => {}
        Some(_) => return None,
    }
    match value.get("parent") {
        Some(Value::String(parent)) => Some(parent.clone()),
        // Bandcamp addresses standalone playlist songs as one-track albums by song ID.
        None | Some(Value::Null) => string_field(value, &["id"]),
        Some(_) => None,
    }
}

fn playlist_detail_from_value(value: &Value) -> Result<PlaylistDetail, String> {
    let summary = playlist_summary_from_value(value)
        .ok_or_else(|| "Bandcamp returned invalid playlist metadata.".to_string())?;
    let entries = match value.get("entry") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(entries)) => entries.as_slice(),
        Some(_) => {
            return Err("Bandcamp returned invalid playlist track data.".to_string());
        }
    };
    if entries.len() > MAX_PLAYLIST_TRACKS {
        return Err(format!(
            "Bandcamp returned a playlist with more than {MAX_PLAYLIST_TRACKS} tracks."
        ));
    }
    let tracks = entries
        .iter()
        .map(|entry| {
            let fallback_album_id = playlist_track_album_id(entry).unwrap_or_default();
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
    let playlists = body
        .pointer("/subsonic-response/playlists")
        .and_then(Value::as_object)
        .ok_or_else(|| "Bandcamp did not return a valid playlist list.".to_string())?;
    let values = match playlists.get("playlist") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(values)) => values.as_slice(),
        Some(_) => {
            return Err("Bandcamp returned an invalid playlist list.".to_string());
        }
    };
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

fn playlist_from_optional_response(body: &Value) -> Result<Option<PlaylistDetail>, String> {
    body.pointer("/subsonic-response/playlist")
        .map(playlist_detail_from_value)
        .transpose()
}

fn playlist_update_from_response(
    body: &Value,
    playlist_id: &str,
) -> Result<Option<PlaylistDetail>, String> {
    let playlist = playlist_from_optional_response(body)?;
    if playlist
        .as_ref()
        .is_some_and(|playlist| playlist.id != playlist_id)
    {
        return Err("Bandcamp returned a different playlist than Coda updated.".into());
    }
    Ok(playlist)
}

#[tauri::command]
fn has_connection() -> bool {
    credential_entry()
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok()
}

#[tauri::command]
fn disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = LIBRARY_CACHE_LOCK
        .lock()
        .map_err(|_| "The library cache lock is unavailable.".to_string())?;
    let path = library_cache_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not remove the saved library: {error}")),
    }
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            CONNECTION_GENERATION.fetch_add(1, Ordering::AcqRel);
            LIBRARY_SYNC_GENERATION.fetch_add(1, Ordering::AcqRel);
            clear_album_refresh_generations();
            if let Ok(database) = album_metadata_database(&app) {
                let _ = clear_persisted_album_tracks(database);
            }
            Ok(())
        }
        Err(error) => Err(format!("Could not remove credentials: {error}")),
    }
}

#[tauri::command]
async fn load_library_cache(app: tauri::AppHandle) -> Result<Option<LibraryCacheSnapshot>, String> {
    load_credentials()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_CACHE_LOCK
            .lock()
            .map_err(|_| "The library cache lock is unavailable.".to_string())?;
        load_library_cache_or_clear_invalid(&library_cache_path(&app)?, player_timestamp_ms()?)
    })
    .await
    .map_err(|error| format!("Could not load the saved library: {error}"))?
}

#[tauri::command]
fn player_state_contract_version() -> u8 {
    PLAYER_STATE_CONTRACT_VERSION
}

#[tauri::command]
fn record_player_state_diagnostic(app: tauri::AppHandle, event: String) -> Result<(), String> {
    if !matches!(
        event.as_str(),
        "renderer.load.ok"
            | "renderer.load.none"
            | "renderer.load.invalid"
            | "renderer.load.native-error"
    ) {
        return Err("The player-state diagnostic event is invalid.".into());
    }
    append_player_state_diagnostic(&app, &event, None, None, "none", None);
    Ok(())
}

#[tauri::command]
async fn load_player_state(app: tauri::AppHandle) -> Result<Option<PlayerStateSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result: Result<Option<PlayerStateSnapshot>, String> = (|| {
            let _guard = PLAYER_STATE_LOCK
                .lock()
                .map_err(|_| "The player state lock is unavailable.".to_string())?;
            let state_path = player_state_path(&app)?;
            let state_existed = state_path.exists();
            let checkpoint_path = player_checkpoint_path(&app)?;
            let Some(mut state) = load_player_state_or_clear_invalid(&state_path)? else {
                let _ = fs::remove_file(checkpoint_path);
                append_player_state_diagnostic(
                    &app,
                    if state_existed {
                        "native.load.cleared-invalid"
                    } else {
                        "native.load.none"
                    },
                    Some(0),
                    Some(0),
                    "none",
                    Some(0.0),
                );
                return Ok(None);
            };

            match read_player_checkpoint(&checkpoint_path) {
                Ok(Some(checkpoint)) => {
                    if !apply_player_checkpoint(&mut state, checkpoint) {
                        let _ = fs::remove_file(&checkpoint_path);
                        append_player_state_diagnostic(
                            &app,
                            "native.load.dropped-stale-checkpoint",
                            Some(state.queue.len()),
                            Some(state.current_index),
                            player_state_track_kind(
                                state
                                    .queue
                                    .get(state.current_index)
                                    .map(|track| track.id.as_str()),
                            ),
                            Some(state.position_seconds),
                        );
                    }
                }
                Ok(None) => {}
                Err(error)
                    if error.contains("malformed")
                        || error.contains("invalid")
                        || error.contains("unexpectedly large") =>
                {
                    let _ = fs::remove_file(&checkpoint_path);
                    append_player_state_snapshot_diagnostic(
                        &app,
                        "native.load.dropped-invalid-checkpoint",
                        &state,
                    );
                }
                Err(error) => return Err(error),
            }
            normalize_restored_player_progress(&mut state);
            validate_player_state(&state)?;
            append_player_state_snapshot_diagnostic(&app, "native.load.ok", &state);
            Ok(Some(state))
        })();
        if let Err(error) = &result {
            let event = format!("native.load.error.{}", player_state_error_kind(error));
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
        }
        result
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
        let result: Result<(), String> = (|| {
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
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Could not clear the prior player checkpoint: {error}"
                    ));
                }
            }
            append_player_state_snapshot_diagnostic(&app, "native.save.ok", &state);
            Ok(())
        })();
        if let Err(error) = &result {
            let event = format!("native.save.error.{}", player_state_error_kind(error));
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
        }
        result
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
        let result: Result<bool, String> = (|| {
            let _guard = PLAYER_STATE_LOCK
                .lock()
                .map_err(|_| "The player state lock is unavailable.".to_string())?;
            validate_player_checkpoint(&checkpoint)?;
            let state_path = player_state_path(&app)?;
            let Some(state) = load_player_state_or_clear_invalid(&state_path)? else {
                append_player_state_diagnostic(
                    &app,
                    "native.checkpoint.skipped-no-state",
                    None,
                    Some(checkpoint.current_index),
                    player_state_track_kind(Some(&checkpoint.current_track_id)),
                    Some(checkpoint.position_seconds),
                );
                return Ok(false);
            };
            if checkpoint.current_index >= state.queue.len()
                || state.queue[checkpoint.current_index].id != checkpoint.current_track_id
            {
                append_player_state_diagnostic(
                    &app,
                    "native.checkpoint.skipped-mismatch",
                    Some(state.queue.len()),
                    Some(checkpoint.current_index),
                    player_state_track_kind(Some(&checkpoint.current_track_id)),
                    Some(checkpoint.position_seconds),
                );
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
            append_player_state_diagnostic(
                &app,
                "native.checkpoint.ok",
                Some(state.queue.len()),
                Some(checkpoint.current_index),
                player_state_track_kind(Some(&checkpoint.current_track_id)),
                Some(checkpoint.position_seconds),
            );
            Ok(true)
        })();
        if let Err(error) = &result {
            let event = format!("native.checkpoint.error.{}", player_state_error_kind(error));
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
        }
        result
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

async fn fetch_library_page(
    credentials: &ConnectionInput,
    page_index: u64,
) -> Result<(usize, Vec<Album>), String> {
    fetch_album_list_page(credentials, "alphabeticalByArtist", 500, page_index * 500).await
}

async fn fetch_newest_library_album(
    credentials: &ConnectionInput,
) -> Result<Option<Album>, String> {
    let (_, albums) = fetch_album_list_page(credentials, "newest", 1, 0).await?;
    Ok(albums.into_iter().next())
}

async fn fetch_album_list_page(
    credentials: &ConnectionInput,
    list_type: &str,
    size: u64,
    offset: u64,
) -> Result<(usize, Vec<Album>), String> {
    let body = request_json(
        "getAlbumList2",
        credentials,
        &[
            ("type", list_type.into()),
            ("size", size.to_string()),
            ("offset", offset.to_string()),
        ],
    )
    .await?;
    albums_from_library_page(&body)
}

fn newest_cached_album(albums: &[Album]) -> Option<&Album> {
    albums
        .iter()
        .filter_map(|album| album.added_at.as_deref().map(|added_at| (added_at, album)))
        .max_by(|(left_added, left), (right_added, right)| {
            left_added
                .cmp(right_added)
                .then_with(|| left.id.cmp(&right.id))
        })
        .map(|(_, album)| album)
}

fn newest_probe_matches_cache(snapshot: &LibraryCacheSnapshot, newest: Option<&Album>) -> bool {
    match (newest_cached_album(&snapshot.albums), newest) {
        (None, None) => snapshot.albums.is_empty(),
        (Some(cached), Some(incoming)) => cached == incoming,
        _ => false,
    }
}

fn cache_requires_full_reconciliation(snapshot: &LibraryCacheSnapshot, now: u64) -> bool {
    snapshot.last_full_sync_at == 0
        || snapshot.last_full_sync_at > now
        || now.saturating_sub(snapshot.last_full_sync_at) >= LIBRARY_FULL_RECONCILE_INTERVAL_MS
}

fn albums_from_library_page(body: &Value) -> Result<(usize, Vec<Album>), String> {
    let album_list = body
        .pointer("/subsonic-response/albumList2")
        .and_then(Value::as_object)
        .ok_or_else(|| "Bandcamp returned an unexpected library response.".to_string())?;
    let items = match album_list.get("album") {
        None => &[][..],
        Some(value) => value
            .as_array()
            .map(Vec::as_slice)
            .ok_or_else(|| "Bandcamp returned an unexpected library response.".to_string())?,
    };
    if items.len() > 500 {
        return Err("Bandcamp returned an unexpectedly large library page.".into());
    }
    let albums = items
        .iter()
        .map(|value| {
            bounded_album_from_value(value)
                .ok_or_else(|| "Bandcamp returned invalid album metadata.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((items.len(), albums))
}

fn append_library_page(
    albums: &mut Vec<Album>,
    album_ids: &mut BTreeSet<String>,
    page_albums: Vec<Album>,
) -> Vec<Album> {
    let mut appended = Vec::new();
    for album in page_albums {
        if album_ids.insert(album.id.clone()) {
            appended.push(album.clone());
            albums.push(album);
        }
        if albums.len() == MAX_LIBRARY_ALBUMS {
            break;
        }
    }
    appended
}

fn emit_library_page(
    on_progress: &Channel<LibrarySyncEvent>,
    page_index: u64,
    loaded: usize,
    albums: Vec<Album>,
) {
    let _ = on_progress.send(LibrarySyncEvent::Page {
        page_index,
        loaded,
        albums,
    });
}

fn ensure_library_sync_current(
    expected_sync_generation: u64,
    expected_connection_generation: Option<u64>,
) -> Result<(), String> {
    if LIBRARY_SYNC_GENERATION.load(Ordering::Acquire) != expected_sync_generation
        || expected_connection_generation
            .is_some_and(|expected| CONNECTION_GENERATION.load(Ordering::Acquire) != expected)
    {
        return Err("The Bandcamp connection changed before sync completed.".into());
    }
    Ok(())
}

async fn fetch_library_with_credentials(
    credentials: &ConnectionInput,
    on_progress: &Channel<LibrarySyncEvent>,
    expected_connection_generation: Option<u64>,
    expected_sync_generation: u64,
) -> Result<Vec<Album>, String> {
    let mut albums = Vec::new();
    let mut album_ids = BTreeSet::new();

    ensure_library_sync_current(expected_sync_generation, expected_connection_generation)?;
    let (first_count, first_page) = fetch_library_page(credentials, 0).await?;
    ensure_library_sync_current(expected_sync_generation, expected_connection_generation)?;
    let appended = append_library_page(&mut albums, &mut album_ids, first_page);
    emit_library_page(on_progress, 0, albums.len(), appended);
    if first_count < 500 || albums.len() == MAX_LIBRARY_ALBUMS {
        return Ok(albums);
    }

    for page_index in 1..10_u64 {
        ensure_library_sync_current(expected_sync_generation, expected_connection_generation)?;
        let (item_count, page_albums) = fetch_library_page(credentials, page_index).await?;
        ensure_library_sync_current(expected_sync_generation, expected_connection_generation)?;
        let appended = append_library_page(&mut albums, &mut album_ids, page_albums);
        emit_library_page(on_progress, page_index, albums.len(), appended);
        if item_count < 500 || albums.len() == MAX_LIBRARY_ALBUMS {
            return Ok(albums);
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
async fn connect(
    app: tauri::AppHandle,
    input: ConnectionInput,
    on_progress: Channel<LibrarySyncEvent>,
) -> Result<Vec<Album>, String> {
    validate_credentials(&input)?;
    let previous_credentials = load_credentials().ok();
    let sync_generation = LIBRARY_SYNC_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let albums = fetch_library_with_credentials(&input, &on_progress, None, sync_generation)
        .await
        .map_err(connection_error)?;
    ensure_library_sync_current(sync_generation, None)?;
    store_credentials(&input)?;

    let stored = load_credentials().map_err(|error| {
        format!("Credentials were accepted but could not be verified in the system vault: {error}")
    })?;
    if stored.username != input.username || stored.password != input.password {
        let _ = disconnect(app.clone());
        return Err(
            "Credentials were accepted but the system vault did not return the saved connection."
                .into(),
        );
    }

    let connection_generation = CONNECTION_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    clear_album_refresh_generations();
    if previous_credentials
        .as_ref()
        .is_some_and(|credentials| credentials.username != input.username)
    {
        if let Ok(database) = album_metadata_database(&app) {
            let _ = clear_persisted_album_tracks(database);
        }
    }
    let cache_app = app.clone();
    let cached_albums = albums.clone();
    let cached_credentials = input.clone();
    let full_sync_at = player_timestamp_ms()?;
    let cache_result = tauri::async_runtime::spawn_blocking(move || {
        save_library_cache_if_connection_current(
            &cache_app,
            &cached_albums,
            connection_generation,
            sync_generation,
            &cached_credentials,
            true,
            full_sync_at,
        )
    })
    .await
    .map_err(|error| format!("Could not save the library cache: {error}"))??;
    if !cache_result {
        return Err("The Bandcamp connection changed before sync completed.".into());
    }

    Ok(albums)
}

#[tauri::command]
async fn fetch_library(
    app: tauri::AppHandle,
    on_progress: Channel<LibrarySyncEvent>,
    force_full: bool,
) -> Result<Vec<Album>, String> {
    let credentials = load_credentials()?;
    let connection_generation = CONNECTION_GENERATION.load(Ordering::Acquire);
    let sync_generation = LIBRARY_SYNC_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let now = player_timestamp_ms()?;
    let cached_snapshot = if force_full {
        None
    } else {
        let cache_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = LIBRARY_CACHE_LOCK
                .lock()
                .map_err(|_| "The library cache lock is unavailable.".to_string())?;
            load_library_cache_or_clear_invalid(&library_cache_path(&cache_app)?, now)
        })
        .await
        .map_err(|error| format!("Could not inspect the library cache: {error}"))??
    };

    if let Some(snapshot) = cached_snapshot {
        if !cache_requires_full_reconciliation(&snapshot, now) {
            ensure_library_sync_current(sync_generation, Some(connection_generation))?;
            let newest = fetch_newest_library_album(&credentials).await?;
            ensure_library_sync_current(sync_generation, Some(connection_generation))?;
            if newest_probe_matches_cache(&snapshot, newest.as_ref()) {
                let cached_albums = snapshot.albums;
                let response_albums = cached_albums.clone();
                let cache_app = app.clone();
                let cached_credentials = credentials.clone();
                let last_full_sync_at = snapshot.last_full_sync_at;
                let cache_result = tauri::async_runtime::spawn_blocking(move || {
                    save_library_cache_if_connection_current(
                        &cache_app,
                        &cached_albums,
                        connection_generation,
                        sync_generation,
                        &cached_credentials,
                        false,
                        last_full_sync_at,
                    )
                })
                .await
                .map_err(|error| format!("Could not refresh the library cache: {error}"))??;
                if !cache_result {
                    return Err("The Bandcamp connection changed before sync completed.".into());
                }
                return Ok(response_albums);
            }
        }
    }

    let albums = fetch_library_with_credentials(
        &credentials,
        &on_progress,
        Some(connection_generation),
        sync_generation,
    )
    .await?;
    let cache_app = app.clone();
    let cached_albums = albums.clone();
    let cached_credentials = credentials.clone();
    let full_sync_at = player_timestamp_ms()?;
    let cache_result = tauri::async_runtime::spawn_blocking(move || {
        save_library_cache_if_connection_current(
            &cache_app,
            &cached_albums,
            connection_generation,
            sync_generation,
            &cached_credentials,
            false,
            full_sync_at,
        )
    })
    .await
    .map_err(|error| format!("Could not save the library cache: {error}"))??;
    if !cache_result {
        return Err("The Bandcamp connection changed before sync completed.".into());
    }
    Ok(albums)
}

fn album_tracks_from_response(body: &Value, album_id: &str) -> Result<Vec<Track>, String> {
    let album = body
        .pointer("/subsonic-response/album")
        .and_then(Value::as_object)
        .ok_or_else(|| "Bandcamp returned an unexpected album response.".to_string())?;
    let returned_album_id = album
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| validate_identifier(value).is_ok())
        .ok_or_else(|| "Bandcamp returned an invalid album identifier.".to_string())?;
    if returned_album_id != album_id {
        return Err("Bandcamp returned a different album than Coda requested.".into());
    }
    let songs = match album.get("song") {
        None => &[][..],
        Some(value) => value
            .as_array()
            .map(Vec::as_slice)
            .ok_or_else(|| "Bandcamp returned an unexpected album response.".to_string())?,
    };
    if songs.len() > MAX_PLAYLIST_TRACKS {
        return Err("Bandcamp returned an unexpectedly large album.".into());
    }
    songs
        .iter()
        .map(|value| {
            bounded_track_from_value(value, album_id)
                .filter(|track| track.album_id == album_id)
                .ok_or_else(|| "Bandcamp returned invalid track metadata.".to_string())
        })
        .collect()
}

async fn fetch_album_from_bandcamp(
    album_id: &str,
    credentials: &ConnectionInput,
) -> Result<Vec<Track>, String> {
    let body = request_json("getAlbum", credentials, &[("id", album_id.to_string())]).await?;
    album_tracks_from_response(&body, album_id)
}

fn schedule_persist_album_tracks(
    app: tauri::AppHandle,
    cache_key: String,
    album_id: String,
    tracks: Vec<Track>,
    expected_generation: u64,
    expected_credentials: ConnectionInput,
    expected_refresh_generation: u64,
) {
    drop(tauri::async_runtime::spawn_blocking(move || {
        let Ok(database) = album_metadata_database(&app) else {
            return;
        };
        let Ok(now) = player_timestamp_ms() else {
            return;
        };
        let _ = write_persisted_album_tracks(
            database,
            &cache_key,
            &album_id,
            &tracks,
            now,
            Some((expected_generation, &expected_credentials)),
            Some((&album_id, expected_refresh_generation)),
        );
    }));
}

async fn load_persisted_album_tracks(
    app: tauri::AppHandle,
    cache_key: String,
    album_id: String,
) -> Option<Vec<Track>> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = album_metadata_database(&app).ok()?;
        let now = player_timestamp_ms().ok()?;
        read_persisted_album_tracks(database, &cache_key, &album_id, now)
            .ok()
            .flatten()
    })
    .await
    .ok()
    .flatten()
}

fn ensure_album_request_current(
    connection_generation: u64,
    album_id: &str,
    refresh_generation: u64,
) -> Result<(), String> {
    if CONNECTION_GENERATION.load(Ordering::Acquire) != connection_generation {
        return Err("The Bandcamp connection changed while the album was loading.".into());
    }
    if album_refresh_generation(album_id)? != refresh_generation {
        return Err("The album was refreshed while an older request was loading.".into());
    }
    Ok(())
}

#[tauri::command]
async fn fetch_album(
    app: tauri::AppHandle,
    album_id: String,
    force_refresh: bool,
) -> Result<Vec<Track>, String> {
    validate_identifier(&album_id)?;
    let connection_generation = CONNECTION_GENERATION.load(Ordering::Acquire);
    let refresh_generation = if force_refresh {
        bump_album_refresh_generation(&album_id)?
    } else {
        album_refresh_generation(&album_id)?
    };
    let credentials = load_credentials()?;
    let persistent_key = persisted_album_track_cache_key(&credentials, &album_id);

    if force_refresh {
        let tracks = fetch_album_from_bandcamp(&album_id, &credentials).await?;
        ensure_album_request_current(connection_generation, &album_id, refresh_generation)?;
        schedule_persist_album_tracks(
            app,
            persistent_key,
            album_id,
            tracks.clone(),
            connection_generation,
            credentials,
            refresh_generation,
        );
        return Ok(tracks);
    }

    if let Some(tracks) =
        load_persisted_album_tracks(app.clone(), persistent_key.clone(), album_id.clone()).await
    {
        ensure_album_request_current(connection_generation, &album_id, refresh_generation)?;
        return Ok(tracks);
    }

    let tracks = fetch_album_from_bandcamp(&album_id, &credentials).await?;
    ensure_album_request_current(connection_generation, &album_id, refresh_generation)?;
    schedule_persist_album_tracks(
        app,
        persistent_key,
        album_id,
        tracks.clone(),
        connection_generation,
        credentials,
        refresh_generation,
    );
    Ok(tracks)
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
    fetch_playlist_from_bandcamp(&playlist_id, &credentials)
        .await
        .map_err(|error| beta_feature_error("Playlist loading", error))
}

async fn fetch_playlist_from_bandcamp(
    playlist_id: &str,
    credentials: &ConnectionInput,
) -> Result<PlaylistDetail, String> {
    let body = request_json(
        "getPlaylist",
        credentials,
        &[("id", playlist_id.to_string())],
    )
    .await?;
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
async fn update_playlist(input: PlaylistUpdateInput) -> Result<Option<PlaylistDetail>, String> {
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
    playlist_update_from_response(&body, &playlist_id)
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
    let response = send_bandcamp_request(
        http_client()?
            .post(DISCOVER_ENDPOINT)
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request),
        "Bandcamp Discover",
        BandcampRetryPolicy::Never,
    )
    .await?;

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
async fn radio_shows(
    series_id: Option<u64>,
    cursor: Option<String>,
) -> Result<RadioShowsPage, String> {
    let requested_series = match series_id {
        Some(id) => Some(
            radio_series_by_id(id)
                .ok_or_else(|| "The Bandcamp Radio series is invalid.".to_string())?,
        ),
        None => None,
    };
    let cursor = validate_radio_cursor(cursor)?;
    let url = Url::parse(RADIO_SHOWS_ENDPOINT)
        .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
    let request = RadioShowsRequest {
        page_size: RADIO_SHOW_PAGE_SIZE,
        next_cursor: cursor.clone(),
        radio_franchise_id: requested_series.as_ref().map(|series| series.id),
    };
    let response = fetch_bounded_json_request::<RawRadioShowsPage>(
        http_client()?.post(url).json(&request),
        "Bandcamp Radio",
    )
    .await;

    let body = match response {
        Ok(body) => body,
        Err(_error) if requested_series.is_none() && cursor.is_none() => {
            let fallback_url = Url::parse(RADIO_LIST_ENDPOINT)
                .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
            let fallback: RawRadioList = fetch_bounded_json(fallback_url, "Bandcamp Radio").await?;
            return Ok(RadioShowsPage {
                results: fallback
                    .results
                    .into_iter()
                    .take(MAX_RADIO_SHOWS)
                    .filter_map(radio_summary_from_raw)
                    .collect(),
                cursor: None,
                has_more: false,
            });
        }
        Err(error) => return Err(error),
    };
    let next_cursor = validate_radio_cursor(body.next_cursor).ok().flatten();
    let results = body
        .items
        .into_iter()
        .take(RADIO_SHOW_PAGE_SIZE as usize)
        .filter_map(|show| radio_summary_from_series_raw(show, requested_series.as_ref()))
        .collect::<Vec<_>>();
    let has_more = next_cursor.is_some() && !results.is_empty();
    Ok(RadioShowsPage {
        results,
        cursor: next_cursor,
        has_more,
    })
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

#[cfg(desktop)]
fn with_window_state_plugin<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                StateFlags::POSITION
                    | StateFlags::SIZE
                    | StateFlags::MAXIMIZED
                    | StateFlags::VISIBLE,
            )
            .with_denylist(&["mini-player"])
            .build(),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());
    #[cfg(desktop)]
    let builder = with_window_state_plugin(builder);

    builder
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
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                let should_maximize_main_window = app
                    .path()
                    .app_config_dir()
                    .map(|directory| should_maximize_main_window_on_startup(&directory))
                    .unwrap_or(false);
                if should_maximize_main_window {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.maximize();
                    }
                }
                ensure_window_is_visible(app);

                #[cfg(target_os = "macos")]
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = macos_window::install_centered_title(&window) {
                        eprintln!("Could not install Coda's centered native title: {error}");
                    }
                }

                let product_name = app
                    .config()
                    .product_name
                    .clone()
                    .unwrap_or_else(|| "Coda".to_string());
                let show = MenuItem::with_id(
                    app,
                    "show",
                    format!("Show {product_name}"),
                    true,
                    None::<&str>,
                )?;
                let mini_player =
                    MenuItem::with_id(app, "mini-player", "Mini Player", true, None::<&str>)?;
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
                let quit = MenuItem::with_id(
                    app,
                    "quit",
                    format!("Quit {product_name}"),
                    true,
                    None::<&str>,
                )?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &show,
                        &mini_player,
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
                    .tooltip(product_name)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "mini-player" => toggle_mini_player(app, None, None),
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
                            position,
                            rect,
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            toggle_mini_player(tray.app_handle(), Some(rect), Some(position));
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
            load_library_cache,
            player_state_contract_version,
            record_player_state_diagnostic,
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
fn should_maximize_main_window_for_state_lookup(state_file_exists: std::io::Result<bool>) -> bool {
    matches!(state_file_exists, Ok(false))
}

#[cfg(desktop)]
fn should_maximize_main_window_on_startup(app_config_dir: &Path) -> bool {
    let state_path = app_config_dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);
    should_maximize_main_window_for_state_lookup(state_path.try_exists())
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("mini-player") {
        let _ = window.hide();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn toggle_mini_player(
    app: &tauri::AppHandle,
    event_rect: Option<tauri::Rect>,
    event_position: Option<tauri::PhysicalPosition<f64>>,
) {
    let Some(window) = app.get_webview_window("mini-player") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    let tray_rect = event_rect.or_else(|| {
        app.tray_by_id("coda-tray")
            .and_then(|tray| tray.rect().ok().flatten())
    });
    let approximate_scale = window.scale_factor().unwrap_or(1.0);
    let approximate_tray_center = tray_rect.map(|rect| {
        let position = rect.position.to_physical::<i32>(approximate_scale);
        let size = rect.size.to_physical::<u32>(approximate_scale);
        (
            f64::from(position.x) + f64::from(size.width) / 2.0,
            f64::from(position.y) + f64::from(size.height) / 2.0,
        )
    });
    let monitor = event_position
        .and_then(|position| {
            app.monitor_from_point(position.x, position.y)
                .ok()
                .flatten()
        })
        .or_else(|| {
            approximate_tray_center.and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
        })
        .or_else(|| {
            app.get_webview_window("main")
                .and_then(|main| main.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    };
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let area = [
        work_area.position.x,
        work_area.position.y,
        i32::try_from(work_area.size.width).unwrap_or(i32::MAX),
        i32::try_from(work_area.size.height).unwrap_or(i32::MAX),
    ];
    let tray = tray_rect
        .map(|rect| {
            let position = rect.position.to_physical::<i32>(scale_factor);
            let size = rect.size.to_physical::<u32>(scale_factor);
            [
                position.x,
                position.y,
                i32::try_from(size.width).unwrap_or(i32::MAX),
                i32::try_from(size.height).unwrap_or(i32::MAX),
            ]
        })
        .unwrap_or_else(|| {
            [
                area[0].saturating_add(area[2]).saturating_sub(32),
                area[1],
                24,
                24,
            ]
        });
    let size = tauri::LogicalSize::new(368.0, 240.0).to_physical::<u32>(scale_factor);
    let position = mini_player_position(tray, [size.width, size.height], area);
    let _ = window.set_position(tauri::PhysicalPosition::new(position[0], position[1]));
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(desktop)]
fn mini_player_position(tray: [i32; 4], window: [u32; 2], monitor: [i32; 4]) -> [i32; 2] {
    const EDGE_GUTTER: i64 = 8;
    const TRAY_GAP: i64 = 8;

    fn clamp_axis(
        desired: i64,
        monitor_start: i64,
        monitor_length: i64,
        window_length: i64,
    ) -> i32 {
        let minimum = monitor_start.saturating_add(EDGE_GUTTER);
        let maximum = monitor_start
            .saturating_add(monitor_length)
            .saturating_sub(window_length)
            .saturating_sub(EDGE_GUTTER)
            .max(minimum);
        desired.clamp(minimum, maximum) as i32
    }

    let [tray_x, tray_y, tray_width, tray_height] = tray.map(i64::from);
    let [window_width, window_height] = window.map(i64::from);
    let [monitor_x, monitor_y, monitor_width, monitor_height] = monitor.map(i64::from);
    let tray_center_x = tray_x.saturating_add(tray_width / 2);
    let tray_center_y = tray_y.saturating_add(tray_height / 2);
    let monitor_center_y = monitor_y.saturating_add(monitor_height / 2);
    let desired_x = tray_center_x.saturating_sub(window_width / 2);
    let desired_y = if tray_center_y <= monitor_center_y {
        tray_y.saturating_add(tray_height).saturating_add(TRAY_GAP)
    } else {
        tray_y
            .saturating_sub(window_height)
            .saturating_sub(TRAY_GAP)
    };

    [
        clamp_axis(desired_x, monitor_x, monitor_width, window_width),
        clamp_axis(desired_y, monitor_y, monitor_height, window_height),
    ]
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
    fn main_window_keeps_native_chrome_enabled() {
        let config: Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
        let main_window = config["app"]["windows"]
            .as_array()
            .and_then(|windows| {
                windows
                    .iter()
                    .find(|window| window["label"].as_str() == Some("main"))
            })
            .expect("main window config");

        assert_eq!(main_window["decorations"], Value::Bool(true));
        assert_eq!(
            main_window["titleBarStyle"],
            Value::String("Visible".into())
        );
        assert_eq!(main_window["closable"], Value::Bool(true));
        assert_eq!(main_window["minimizable"], Value::Bool(true));
        assert_eq!(main_window["maximizable"], Value::Bool(true));
        assert_eq!(main_window["resizable"], Value::Bool(true));
        assert_ne!(
            main_window.get("maximized").and_then(Value::as_bool),
            Some(true)
        );
        assert_ne!(
            main_window.get("center").and_then(Value::as_bool),
            Some(true)
        );
        assert_ne!(
            main_window.get("fullscreen").and_then(Value::as_bool),
            Some(true)
        );
        assert_ne!(
            main_window.get("simpleFullscreen").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[cfg(desktop)]
    #[test]
    fn window_state_plugin_registration_precedes_user_setup() {
        let source = include_str!("lib.rs");
        let run_source = source
            .split_once("pub fn run()")
            .map(|(_, run_source)| run_source)
            .expect("run function");
        let setup_index = run_source.find(".setup(|app|").expect("user setup");
        let registration_index = run_source
            .find("let builder = with_window_state_plugin(builder);")
            .expect("static window-state plugin registration");

        assert!(
            registration_index < setup_index,
            "window-state plugin must be registered before user setup"
        );

        let setup_source = &run_source[setup_index
            ..run_source
                .find(".on_window_event")
                .expect("end of user setup")];
        assert!(
            !setup_source.contains("tauri_plugin_window_state::Builder"),
            "window-state plugin must not be registered dynamically in user setup"
        );
    }

    // Tauri's mock runtime test feature currently produces a test executable
    // that cannot start on the hosted Windows runner. The source-order guard
    // above still covers Windows; macOS and Linux exercise the runtime state.
    #[cfg(all(desktop, not(target_os = "windows")))]
    #[test]
    fn window_state_plugin_is_initialized_before_user_setup_runs() {
        let setup_observed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let setup_observed_from_callback = setup_observed.clone();

        let mut app = with_window_state_plugin(tauri::test::mock_builder())
            .setup(move |app| {
                setup_observed_from_callback.store(
                    app.handle().filename() == tauri_plugin_window_state::DEFAULT_FILENAME,
                    std::sync::atomic::Ordering::SeqCst,
                );
                Ok(())
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app with static window-state plugin");

        #[allow(deprecated)]
        app.run_iteration(|_, _| {});
        assert!(setup_observed.load(std::sync::atomic::Ordering::SeqCst));
        drop(app);
    }

    #[cfg(desktop)]
    #[test]
    fn first_launch_maximization_requires_an_absent_window_state_file() {
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();
        let app_config_dir = std::env::temp_dir().join(format!("coda-window-state-{suffix}"));
        let state_path = app_config_dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);

        assert!(should_maximize_main_window_on_startup(&app_config_dir));

        fs::create_dir_all(&app_config_dir).unwrap();
        fs::write(&state_path, b"{}").unwrap();
        assert!(!should_maximize_main_window_on_startup(&app_config_dir));

        fs::remove_file(state_path).unwrap();
        fs::remove_dir(app_config_dir).unwrap();
    }

    #[cfg(desktop)]
    #[test]
    fn window_state_lookup_errors_do_not_override_a_restored_window() {
        let error = std::io::Error::from(std::io::ErrorKind::PermissionDenied);

        assert!(!should_maximize_main_window_for_state_lookup(Err(error)));
    }

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

    fn sample_album(id: &str) -> Album {
        Album {
            id: id.into(),
            title: "Soft Focus".into(),
            artist: "Night Archive".into(),
            song_count: 9,
            duration: 2_460,
            cover_art: Some("cover-1".into()),
            year: Some(2026),
            genre: Some("Ambient".into()),
            added_at: Some("2026-07-25T02:00:00Z".into()),
        }
    }

    fn sample_track(id: &str) -> Track {
        Track {
            id: id.into(),
            title: "Afterimage".into(),
            artist: "Night Archive".into(),
            album: "Soft Focus".into(),
            album_id: "album-1".into(),
            duration: 210,
            track: 1,
            disc: Some(1),
            album_artist: Some("Night Archive".into()),
            music_brainz_id: None,
            cover_art: Some("cover-1".into()),
        }
    }

    fn temporary_library_cache_path(label: &str) -> PathBuf {
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();
        std::env::temp_dir()
            .join(format!("coda-library-cache-{label}-{suffix}"))
            .join(LIBRARY_CACHE_FILE)
    }

    fn temporary_album_metadata_cache_path(label: &str) -> PathBuf {
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();
        std::env::temp_dir()
            .join(format!("coda-album-metadata-cache-{label}-{suffix}"))
            .join(ALBUM_METADATA_CACHE_FILE)
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
    fn rejects_invalid_or_unbounded_album_metadata() {
        assert!(bounded_album_from_value(&serde_json::json!({
            "id": "album-1",
            "name": "Soft Focus",
            "artist": "Night Archive",
            "songCount": 9,
            "duration": 2460,
            "coverArt": "cover-1"
        }))
        .is_some());
        assert!(bounded_album_from_value(&serde_json::json!({
            "id": "bad\nid",
            "name": "Soft Focus",
            "artist": "Night Archive"
        }))
        .is_none());
        assert!(bounded_album_from_value(&serde_json::json!({
            "id": "album-1",
            "name": "Bad\nTitle",
            "artist": "Night Archive"
        }))
        .is_none());
        assert!(bounded_album_from_value(&serde_json::json!({
            "id": "album-1",
            "name": "Soft Focus",
            "artist": "Night Archive",
            "songCount": MAX_PLAYLIST_TRACKS as u64 + 1
        }))
        .is_none());
        assert!(bounded_album_from_value(&serde_json::json!({
            "id": "album-1",
            "name": "Soft Focus",
            "artist": "Night Archive",
            "duration": MAX_SUBSONIC_DURATION_SECONDS + 1
        }))
        .is_none());
        assert!(bounded_album_from_value(&serde_json::json!({
            "id": "album-1",
            "name": "Soft Focus",
            "artist": "Night Archive",
            "coverArt": "bad\ncover"
        }))
        .is_none());
    }

    #[test]
    fn atomically_round_trips_bounded_library_cache_without_media_urls() {
        let path = temporary_library_cache_path("roundtrip");
        let now = 1_800_000_000_000;
        write_library_cache(&path, &[sample_album("album-1")], now, now).unwrap();

        let serialized = fs::read_to_string(&path).unwrap();
        assert!(!serialized.contains("artworkUrl"));
        assert!(!serialized.contains("streamUrl"));
        assert!(!serialized.contains("\"tracks\""));

        let restored = read_library_cache(&path, now + 1_000).unwrap().unwrap();
        assert_eq!(restored.version, LIBRARY_CACHE_VERSION);
        assert_eq!(restored.last_full_sync_at, now);
        assert_eq!(restored.albums.len(), 1);
        assert_eq!(restored.albums[0].id, "album-1");

        let directory = path.parent().unwrap().to_path_buf();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_expired_future_malformed_and_overfull_library_caches() {
        let now = 1_800_000_000_000;
        let valid = LibraryCacheSnapshot {
            version: LIBRARY_CACHE_VERSION,
            saved_at: now,
            last_full_sync_at: now,
            albums: vec![sample_album("album-1")],
        };
        assert!(validate_library_cache(&valid, now).is_ok());
        assert!(validate_library_cache(
            &LibraryCacheSnapshot {
                saved_at: now + 1,
                ..valid.clone()
            },
            now
        )
        .is_err());
        assert!(validate_library_cache(
            &LibraryCacheSnapshot {
                last_full_sync_at: now + 1,
                ..valid.clone()
            },
            now
        )
        .is_err());
        assert!(validate_library_cache(
            &LibraryCacheSnapshot {
                saved_at: now - LIBRARY_CACHE_TTL_MS - 1,
                ..valid.clone()
            },
            now
        )
        .is_err());
        assert!(validate_library_cache(
            &LibraryCacheSnapshot {
                albums: vec![sample_album("album"); MAX_LIBRARY_ALBUMS + 1],
                ..valid
            },
            now
        )
        .is_err());

        let path = temporary_library_cache_path("malformed");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{not-json").unwrap();
        assert!(load_library_cache_or_clear_invalid(&path, now)
            .unwrap()
            .is_none());
        assert!(!path.exists());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn newest_probe_skips_only_unchanged_recent_full_caches() {
        let now = 1_800_000_000_000;
        let mut older = sample_album("album-older");
        older.added_at = Some("2026-07-24T02:00:00Z".into());
        let newest = sample_album("album-newest");
        let snapshot = LibraryCacheSnapshot {
            version: LIBRARY_CACHE_VERSION,
            saved_at: now - 60_000,
            last_full_sync_at: now - 60_000,
            albums: vec![newest.clone(), older],
        };

        assert_eq!(
            newest_cached_album(&snapshot.albums).map(|album| album.id.as_str()),
            Some("album-newest")
        );
        assert!(newest_probe_matches_cache(&snapshot, Some(&newest)));
        assert!(!newest_probe_matches_cache(
            &snapshot,
            Some(&sample_album("album-unseen"))
        ));
        assert!(!cache_requires_full_reconciliation(&snapshot, now));
        assert!(cache_requires_full_reconciliation(
            &LibraryCacheSnapshot {
                last_full_sync_at: now - LIBRARY_FULL_RECONCILE_INTERVAL_MS,
                ..snapshot
            },
            now
        ));
    }

    #[test]
    fn forced_album_refresh_supersedes_older_cache_and_network_requests() {
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();
        let album_id = format!("album-refresh-{suffix}");
        let connection_generation = CONNECTION_GENERATION.load(Ordering::Acquire);
        let original_generation = album_refresh_generation(&album_id).unwrap();

        assert!(ensure_album_request_current(
            connection_generation,
            &album_id,
            original_generation,
        )
        .is_ok());

        let refreshed_generation = bump_album_refresh_generation(&album_id).unwrap();
        assert!(ensure_album_request_current(
            connection_generation,
            &album_id,
            original_generation,
        )
        .is_err());
        assert!(ensure_album_request_current(
            connection_generation,
            &album_id,
            refreshed_generation,
        )
        .is_ok());

        let path = temporary_album_metadata_cache_path("refresh-generation");
        let database = open_album_metadata_database(&path).unwrap();
        let credentials = ConnectionInput {
            username: format!("generated-user-{suffix}"),
            password: "generated-password".into(),
        };
        let cache_key = persisted_album_track_cache_key(&credentials, &album_id);
        let mut track = sample_track("track-refreshed");
        track.album_id = album_id.clone();
        let now = 1_800_000_000_000;

        assert!(!write_persisted_album_tracks(
            &database,
            &cache_key,
            &album_id,
            std::slice::from_ref(&track),
            now,
            None,
            Some((&album_id, original_generation)),
        )
        .unwrap());
        assert!(write_persisted_album_tracks(
            &database,
            &cache_key,
            &album_id,
            std::slice::from_ref(&track),
            now,
            None,
            Some((&album_id, refreshed_generation)),
        )
        .unwrap());
        let restored = read_persisted_album_tracks(&database, &cache_key, &album_id, now + 1)
            .unwrap()
            .unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, track.id);

        album_refresh_generations()
            .lock()
            .unwrap()
            .remove(&album_id);
        drop(database);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn redb_round_trips_bounded_album_metadata_without_credentials_or_media_urls() {
        let path = temporary_album_metadata_cache_path("roundtrip");
        let database = open_album_metadata_database(&path).unwrap();
        let credentials = ConnectionInput {
            username: "generated-user".into(),
            password: "generated-password".into(),
        };
        let another_account = ConnectionInput {
            username: "another-generated-user".into(),
            password: "another-generated-password".into(),
        };
        let cache_key = persisted_album_track_cache_key(&credentials, "album-1");
        let another_cache_key = persisted_album_track_cache_key(&another_account, "album-1");
        let now = 1_800_000_000_000;

        assert_ne!(cache_key, another_cache_key);
        assert!(write_persisted_album_tracks(
            &database,
            &cache_key,
            "album-1",
            &[sample_track("track-1")],
            now,
            None,
            None,
        )
        .unwrap());
        let restored =
            read_persisted_album_tracks(&database, &cache_key, "album-1", now + 1).unwrap();
        assert_eq!(restored.unwrap()[0].id, "track-1");
        assert!(
            read_persisted_album_tracks(&database, &another_cache_key, "album-1", now + 1,)
                .unwrap()
                .is_none()
        );

        let transaction = database.begin_read().unwrap();
        let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        let serialized = table.get(cache_key.as_str()).unwrap().unwrap();
        let serialized = String::from_utf8(serialized.value().to_vec()).unwrap();
        assert!(!cache_key.contains("generated-user"));
        assert!(!cache_key.contains("generated-password"));
        assert!(!serialized.contains("generated-user"));
        assert!(!serialized.contains("generated-password"));
        assert!(!serialized.contains("streamUrl"));
        assert!(!serialized.contains("artworkUrl"));
        drop(table);
        drop(transaction);
        drop(database);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn redb_discards_expired_and_incompatible_album_metadata() {
        let path = temporary_album_metadata_cache_path("expiry");
        let database = open_album_metadata_database(&path).unwrap();
        let credentials = ConnectionInput {
            username: "generated-user".into(),
            password: "generated-password".into(),
        };
        let cache_key = persisted_album_track_cache_key(&credentials, "album-1");
        let now = 1_800_000_000_000;

        assert!(write_persisted_album_tracks(
            &database,
            &cache_key,
            "album-1",
            &[sample_track("track-1")],
            now,
            None,
            None,
        )
        .unwrap());
        assert!(read_persisted_album_tracks(
            &database,
            &cache_key,
            "album-1",
            now + PERSISTED_ALBUM_TRACK_CACHE_TTL_MS + 1,
        )
        .unwrap()
        .is_none());

        let incompatible = serde_json::to_vec(&PersistedAlbumTracks {
            version: ALBUM_TRACK_CACHE_ENTRY_VERSION + 1,
            saved_at: now,
            album_id: "album-1".into(),
            tracks: vec![sample_track("track-1")],
        })
        .unwrap();
        let transaction = database.begin_write().unwrap();
        {
            let mut table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
            table
                .insert(cache_key.as_str(), incompatible.as_slice())
                .unwrap();
        }
        transaction.commit().unwrap();
        assert!(
            read_persisted_album_tracks(&database, &cache_key, "album-1", now)
                .unwrap()
                .is_none()
        );

        let transaction = database.begin_read().unwrap();
        let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        assert!(table.get(cache_key.as_str()).unwrap().is_none());
        drop(table);
        drop(transaction);
        drop(database);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn album_track_responses_require_bounded_valid_metadata() {
        let valid = serde_json::json!({
            "subsonic-response": {
                "album": {
                    "id": "album-1",
                    "song": [{
                        "id": "track-1",
                        "title": "Afterimage",
                        "artist": "Night Archive",
                        "album": "Soft Focus",
                        "albumId": "album-1",
                        "duration": 210,
                        "track": 1
                    }]
                }
            }
        });
        assert_eq!(
            album_tracks_from_response(&valid, "album-1").unwrap().len(),
            1
        );

        let wrong_shape = serde_json::json!({
            "subsonic-response": { "album": { "song": {} } }
        });
        assert!(album_tracks_from_response(&wrong_shape, "album-1").is_err());

        let wrong_album = serde_json::json!({
            "subsonic-response": {
                "album": {
                    "id": "album-1",
                    "song": [{
                        "id": "track-1",
                        "title": "Afterimage",
                        "artist": "Night Archive",
                        "album": "Soft Focus",
                        "albumId": "another-album"
                    }]
                }
            }
        });
        assert!(album_tracks_from_response(&wrong_album, "album-1").is_err());
    }

    #[test]
    fn bandcamp_read_retries_are_bounded_and_retry_after_aware() {
        let now = UNIX_EPOCH + Duration::from_secs(1_000);
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, reqwest::header::HeaderValue::from_static("5"));
        assert_eq!(
            bandcamp_retry_delay(Some(&headers), 0, now, 100),
            Duration::from_millis(5_100)
        );

        let retry_at = httpdate::fmt_http_date(now + Duration::from_secs(7));
        headers.insert(
            RETRY_AFTER,
            reqwest::header::HeaderValue::from_str(&retry_at).unwrap(),
        );
        assert_eq!(
            bandcamp_retry_delay(Some(&headers), 0, now, 0),
            Duration::from_secs(7)
        );

        headers.insert(
            RETRY_AFTER,
            reqwest::header::HeaderValue::from_static("120"),
        );
        assert_eq!(
            bandcamp_retry_delay(Some(&headers), 0, now, 100),
            BANDCAMP_MAX_RETRY_DELAY
        );
        assert_eq!(
            bandcamp_retry_delay(None, 0, now, 0),
            Duration::from_millis(BANDCAMP_RETRY_BASE_MS)
        );
        assert_eq!(
            bandcamp_retry_delay(None, 1, now, 0),
            Duration::from_millis(BANDCAMP_RETRY_BASE_MS * 2)
        );
    }

    #[test]
    fn bandcamp_read_retries_only_transient_statuses() {
        for status in [
            StatusCode::REQUEST_TIMEOUT,
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::BAD_GATEWAY,
            StatusCode::SERVICE_UNAVAILABLE,
            StatusCode::GATEWAY_TIMEOUT,
        ] {
            assert!(is_retryable_bandcamp_status(status));
        }
        for status in [
            StatusCode::BAD_REQUEST,
            StatusCode::UNAUTHORIZED,
            StatusCode::NOT_FOUND,
            StatusCode::INTERNAL_SERVER_ERROR,
        ] {
            assert!(!is_retryable_bandcamp_status(status));
        }
    }

    #[test]
    fn library_page_aggregation_preserves_order_deduplicates_and_caps_results() {
        let mut albums = vec![sample_album("album-0")];
        let mut ids = BTreeSet::from(["album-0".to_string()]);
        let appended = append_library_page(
            &mut albums,
            &mut ids,
            vec![
                sample_album("album-1"),
                sample_album("album-0"),
                sample_album("album-2"),
            ],
        );

        assert_eq!(
            albums
                .iter()
                .map(|album| album.id.as_str())
                .collect::<Vec<_>>(),
            ["album-0", "album-1", "album-2"]
        );
        assert_eq!(
            appended
                .iter()
                .map(|album| album.id.as_str())
                .collect::<Vec<_>>(),
            ["album-1", "album-2"]
        );

        let mut full = (0..MAX_LIBRARY_ALBUMS - 1)
            .map(|index| sample_album(&format!("album-{index}")))
            .collect::<Vec<_>>();
        let mut full_ids = full
            .iter()
            .map(|album| album.id.clone())
            .collect::<BTreeSet<_>>();
        append_library_page(
            &mut full,
            &mut full_ids,
            vec![sample_album("last-album"), sample_album("overflow-album")],
        );
        assert_eq!(full.len(), MAX_LIBRARY_ALBUMS);
        assert_eq!(
            full.last().map(|album| album.id.as_str()),
            Some("last-album")
        );
    }

    #[test]
    fn library_progress_uses_the_renderer_camel_case_contract() {
        let value = serde_json::to_value(LibrarySyncEvent::Page {
            page_index: 2,
            loaded: 1_500,
            albums: vec![sample_album("album-1")],
        })
        .unwrap();

        assert_eq!(value.get("kind").and_then(Value::as_str), Some("page"));
        assert_eq!(value.get("pageIndex").and_then(Value::as_u64), Some(2));
        assert_eq!(value.get("loaded").and_then(Value::as_u64), Some(1_500));
        assert!(value.get("page_index").is_none());
    }

    #[test]
    fn library_pages_require_the_bounded_subsonic_shape() {
        let empty = serde_json::json!({
            "subsonic-response": { "albumList2": {} }
        });
        assert_eq!(albums_from_library_page(&empty).unwrap(), (0, Vec::new()));

        let missing = serde_json::json!({
            "subsonic-response": {}
        });
        assert!(albums_from_library_page(&missing).is_err());

        let wrong_type = serde_json::json!({
            "subsonic-response": { "albumList2": { "album": {} } }
        });
        assert!(albums_from_library_page(&wrong_type).is_err());

        let oversized = serde_json::json!({
            "subsonic-response": {
                "albumList2": {
                    "album": (0..501)
                        .map(|index| serde_json::json!({
                            "id": format!("album-{index}"),
                            "name": "Soft Focus",
                            "artist": "Night Archive"
                        }))
                        .collect::<Vec<_>>()
                }
            }
        });
        assert!(albums_from_library_page(&oversized).is_err());
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
    fn reports_an_empty_successful_playlist_update_as_committed_without_detail() {
        let body = serde_json::json!({
            "subsonic-response": {
                "status": "ok",
                "version": "1.16.1"
            }
        });

        assert!(playlist_update_from_response(&body, "playlist-1")
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_playlist_detail_for_a_different_committed_update() {
        let body = serde_json::json!({
            "subsonic-response": {
                "status": "ok",
                "version": "1.16.1",
                "playlist": {
                    "id": "playlist-2",
                    "name": "Different playlist",
                    "songCount": 0,
                    "duration": 0
                }
            }
        });

        assert_eq!(
            playlist_update_from_response(&body, "playlist-1").unwrap_err(),
            "Bandcamp returned a different playlist than Coda updated."
        );
    }

    #[test]
    fn loads_playlist_tracks_using_the_parent_or_song_id_when_album_id_is_absent() {
        let detail = playlist_detail_from_value(&serde_json::json!({
            "id": "playlist-1",
            "name": "Night drives",
            "songCount": 2,
            "duration": 490,
            "entry": [
                {
                    "id": "song-1",
                    "parent": "album-1",
                    "title": "Afterimage",
                    "artist": "Night Archive",
                    "album": "Soft Focus",
                    "duration": 245,
                    "track": 2
                },
                {
                    "id": "standalone-song-1",
                    "title": "Signal",
                    "artist": "Night Archive",
                    "duration": 245,
                    "coverArt": "standalone-cover-1"
                }
            ]
        }))
        .unwrap();

        assert_eq!(detail.tracks[0].album_id, "album-1");
        assert_eq!(detail.tracks[1].album_id, "standalone-song-1");
    }

    #[test]
    fn rejects_malformed_playlist_album_associations() {
        for entry in [
            serde_json::json!({
                "id": "song-1",
                "albumId": 7,
                "title": "Afterimage"
            }),
            serde_json::json!({
                "id": "song-1",
                "parent": false,
                "title": "Afterimage"
            }),
        ] {
            let playlist = serde_json::json!({
                "id": "playlist-1",
                "name": "Night drives",
                "songCount": 1,
                "duration": 245,
                "entry": [entry]
            });
            assert!(playlist_detail_from_value(&playlist).is_err());
        }
    }

    #[test]
    fn accepts_an_empty_playlist_list_but_rejects_a_non_array_list() {
        let empty = serde_json::json!({
            "subsonic-response": {
                "playlists": {}
            }
        });
        assert!(playlists_from_response(&empty).unwrap().is_empty());

        let non_array = serde_json::json!({
            "subsonic-response": {
                "playlists": {
                    "playlist": {
                        "id": "playlist-1",
                        "name": "Night drives",
                        "songCount": 1,
                        "duration": 245
                    }
                }
            }
        });
        assert!(playlists_from_response(&non_array).is_err());
    }

    #[test]
    fn accepts_an_empty_playlist_but_rejects_non_array_entries() {
        let empty = playlist_detail_from_value(&serde_json::json!({
            "id": "playlist-1",
            "name": "Night drives",
            "songCount": 0,
            "duration": 0
        }))
        .unwrap();
        assert!(empty.tracks.is_empty());

        let non_array = serde_json::json!({
            "id": "playlist-1",
            "name": "Night drives",
            "songCount": 1,
            "duration": 245,
            "entry": {
                "id": "song-1",
                "parent": "album-1",
                "title": "Afterimage",
                "artist": "Night Archive",
                "album": "Soft Focus",
                "duration": 245
            }
        });
        assert!(playlist_detail_from_value(&non_array).is_err());
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
    fn preserves_missing_release_metadata_as_empty_across_native_track_boundaries() {
        let track = bounded_track_from_value(
            &serde_json::json!({
                "id": "song-1",
                "title": "Afterimage",
                "artist": "Night Archive",
                "albumId": "album-1",
                "duration": 210,
                "track": 2
            }),
            "album-1",
        )
        .expect("valid Subsonic track without release metadata");
        assert!(track.album.is_empty());
        assert!(bounded_track_from_value(
            &serde_json::json!({
                "id": "song-1",
                "title": "Afterimage",
                "artist": "Night Archive",
                "album": "Bad\nrelease",
                "albumId": "album-1"
            }),
            "album-1",
        )
        .is_none());

        let cached = PersistedAlbumTracks {
            version: ALBUM_TRACK_CACHE_ENTRY_VERSION,
            saved_at: 1_800_000_000_000,
            album_id: "album-1".into(),
            tracks: vec![track],
        };
        assert!(validate_persisted_album_tracks(&cached, "album-1", 1_800_000_000_000,).is_ok());

        let mut player = sample_player_state();
        player.queue[0].album.clear();
        assert!(validate_player_state(&player).is_ok());

        let mut invalid_cached = cached;
        invalid_cached.tracks[0].album = "Bad\nrelease".into();
        assert!(
            validate_persisted_album_tracks(&invalid_cached, "album-1", 1_800_000_000_000,)
                .is_err()
        );

        player.queue[0].album = "Bad\nrelease".into();
        assert!(validate_player_state(&player).is_err());
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
        assert!(summary.series.is_none());

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
        assert_eq!(show.series, radio_series_by_id(5));
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
    fn parses_series_radio_pages_and_validates_opaque_cursors() {
        let series = radio_series_by_id(5).unwrap();
        let summary = radio_summary_from_series_raw(
            serde_json::from_value(serde_json::json!({
                "itemId": 979,
                "title": "Kinrose",
                "description": "Episode notes",
                "date": "24 Jul 2026 00:00:00 GMT",
                "imageId": 46240870,
                "franchiseName": "The Hip Hop Show"
            }))
            .unwrap(),
            None,
        )
        .unwrap();
        assert_eq!(summary.series, Some(series));
        assert_eq!(
            validate_radio_cursor(Some("1770336000:901".into())).unwrap(),
            Some("1770336000:901".into())
        );
        assert!(validate_radio_cursor(Some("../not-a-cursor".into())).is_err());
        assert!(validate_radio_cursor(Some("".into())).is_err());
        assert!(radio_series_by_id(3).is_none());
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

    #[cfg(desktop)]
    #[test]
    fn positions_mini_player_below_a_top_menu_bar() {
        assert_eq!(
            mini_player_position([900, 0, 24, 24], [368, 240], [0, 0, 1_920, 1_080],),
            [728, 32],
        );
    }

    #[cfg(desktop)]
    #[test]
    fn positions_mini_player_above_a_bottom_taskbar() {
        assert_eq!(
            mini_player_position([900, 1_056, 24, 24], [368, 240], [0, 0, 1_920, 1_080],),
            [728, 808],
        );
    }

    #[cfg(desktop)]
    #[test]
    fn clamps_mini_player_inside_the_monitor_edges() {
        assert_eq!(
            mini_player_position([1_910, 0, 20, 24], [368, 240], [0, 0, 1_920, 1_080],),
            [1_544, 32],
        );
        assert_eq!(
            mini_player_position([-1_918, 0, 20, 24], [368, 240], [-1_920, 0, 1_920, 1_080],),
            [-1_912, 32],
        );
        assert_eq!(
            mini_player_position([150, 0, 20, 24], [300, 180], [0, 0, 320, 200],),
            [10, 12],
        );
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
