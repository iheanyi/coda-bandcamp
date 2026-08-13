use crate::bandcamp_http::{
    send_bandcamp_request_with_priority, BandcampRequestPriority, BandcampRetryPolicy,
};
use crate::library::CONNECTION_CHANGE_IN_PROGRESS;
use crate::models::{
    Album, ConnectionInput, PlayerStateTrack, PlaylistDetail, PlaylistSummary, Track,
};
use crate::storage::{timestamp_ms, write_bytes_atomically};
use crate::subsonic::{
    authenticated_url, current_connection_generation, load_credentials, load_credentials_async,
    validate_identifier,
};
use crate::url_policy::{allowed_url, UrlKind};
use percent_encoding::percent_decode_str;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::future::Future;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{atomic::Ordering, Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

pub(super) const COVER_CACHE_VERSION: u8 = 1;
pub(super) const COVER_CACHE_DIRECTORY: &str = "cover-art-v1";
pub(super) const COVER_CACHE_INDEX_FILE: &str = "index.json";
pub(super) const COVER_CACHE_INVALIDATION_FILE: &str = "cover-art-v1.invalid";
pub(super) const MAX_COVER_CACHE_INDEX_BYTES: usize = 4 * 1024 * 1024;
pub(super) const MAX_COVER_CACHE_ENTRIES: usize = 5_000;
pub(super) const MAX_COVER_CACHE_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const MAX_COVER_ART_BYTES: usize = 5 * 1024 * 1024;
pub(super) const COVER_ART_FRESH_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub(super) const MAX_COVER_DIMENSION: u32 = 4_096;
pub(super) const MAX_COVER_PIXELS: u64 = 16_777_216;
const MAX_REVISION_LENGTH: usize = 128;
const MAX_COVER_REDIRECTS: usize = 10;
const ACCESS_FLUSH_INTERVAL: Duration = Duration::from_secs(30);
const ACCESS_FLUSH_TOUCHES: usize = 128;
const COVER_UPDATED_EVENT: &str = "coda://cover-art-updated";

static COVER_CACHE_STATE: OnceLock<Arc<CoverCacheInner>> = OnceLock::new();
static COVER_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static COVER_CACHE_PUBLICATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CoverCacheEntry {
    pub(super) key: String,
    pub(super) revision: String,
    pub(super) media_type: String,
    pub(super) extension: String,
    pub(super) byte_length: u64,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) validated_at: u64,
    pub(super) last_access_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CoverCacheIndex {
    pub(super) version: u8,
    pub(super) entries: BTreeMap<String, CoverCacheEntry>,
}

impl Default for CoverCacheIndex {
    fn default() -> Self {
        Self {
            version: COVER_CACHE_VERSION,
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CoverCacheReset {
    Cleared,
    Invalidated,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoverCacheDiagnostics {
    entry_count: usize,
    total_bytes: u64,
    hit_count: u64,
    miss_count: u64,
    stale_count: u64,
    cleanup_pending: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoverArtUpdatedPayload {
    cover_art_id: String,
    revision: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedCoverArt {
    pub(crate) bytes: Vec<u8>,
    pub(crate) media_type: String,
    pub(crate) revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParsedCoverProtocolRequest {
    pub(super) cover_art_id: String,
    pub(super) revision: String,
    pub(super) session_scope: String,
    pub(super) head: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CoverMediaType {
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

pub(super) struct CoverCacheRuntime {
    pub(super) generation: u64,
    pub(super) authorized_ids: HashSet<String>,
    pub(super) index: CoverCacheIndex,
    pub(super) leases: HashMap<String, usize>,
    pub(super) dirty_touches: usize,
    pub(super) hit_count: u64,
    pub(super) miss_count: u64,
    pub(super) stale_count: u64,
    pub(super) cleanup_pending: bool,
}

pub(super) struct CoverCacheInner {
    cache_directory: PathBuf,
    index_path: PathBuf,
    invalidation_path: PathBuf,
    runtime: Mutex<CoverCacheRuntime>,
    cleanup_lock: Mutex<()>,
    key_locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    background_fetches: Semaphore,
}

#[derive(Clone)]
pub(super) struct CoverCacheState(Arc<CoverCacheInner>);

impl CoverCacheState {
    pub(super) fn initialize(app: &AppHandle) -> Result<Self, String> {
        let cache_directory = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Could not locate Coda's cache directory: {error}"))?
            .join(COVER_CACHE_DIRECTORY);
        let invalidation_path = app
            .path()
            .app_data_dir()
            .map_err(|error| {
                format!("Could not locate Coda's application data directory: {error}")
            })?
            .join(COVER_CACHE_INVALIDATION_FILE);
        let index_path = cache_directory.join(COVER_CACHE_INDEX_FILE);
        let (index, cleanup_pending) =
            initialize_cache_index(&cache_directory, &index_path, &invalidation_path);

        let inner = Arc::new(CoverCacheInner {
            cache_directory,
            index_path,
            invalidation_path,
            runtime: Mutex::new(CoverCacheRuntime {
                generation: current_connection_generation(),
                authorized_ids: HashSet::new(),
                index,
                leases: HashMap::new(),
                dirty_touches: 0,
                hit_count: 0,
                miss_count: 0,
                stale_count: 0,
                cleanup_pending,
            }),
            cleanup_lock: Mutex::new(()),
            key_locks: Mutex::new(HashMap::new()),
            background_fetches: Semaphore::new(1),
        });
        COVER_CACHE_STATE
            .set(inner.clone())
            .map_err(|_| "The cover artwork cache was initialized twice.".to_string())?;
        start_access_flush_worker(app.clone(), inner.clone());
        Ok(Self(inner))
    }
}

fn cleanup_marker_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Could not inspect the cover artwork invalidation marker: {error}"
        )),
    }
}

fn write_cleanup_marker(path: &Path) -> Result<(), String> {
    write_bytes_atomically(
        path,
        b"cover-art-v1 invalid\n",
        "cover artwork invalidation marker",
    )
}

pub(super) fn initialize_cache_index(
    cache_directory: &Path,
    index_path: &Path,
    invalidation_path: &Path,
) -> (CoverCacheIndex, bool) {
    let cleanup_pending = match cleanup_marker_exists(invalidation_path) {
        Ok(pending) => pending,
        Err(error) => {
            eprintln!("{error}");
            true
        }
    };
    if cleanup_pending && clear_cache_directory(cache_directory).is_ok() {
        if let Err(error) = remove_file_if_exists(invalidation_path) {
            eprintln!("Could not finish clearing the cover artwork invalidation marker: {error}");
        }
    }
    let cleanup_pending = match cleanup_marker_exists(invalidation_path) {
        Ok(pending) => pending,
        Err(error) => {
            eprintln!("{error}");
            true
        }
    };
    if cleanup_pending {
        return (CoverCacheIndex::default(), true);
    }
    match load_and_repair_index(cache_directory, index_path) {
        Ok(index) => (index, false),
        Err(error) => {
            eprintln!("Could not recover the cover artwork cache: {error}");
            if let Err(marker_error) = write_cleanup_marker(invalidation_path) {
                eprintln!(
                    "Could not persist the cover artwork invalidation marker: {marker_error}"
                );
            }
            (CoverCacheIndex::default(), true)
        }
    }
}

fn state_from_app(app: &AppHandle) -> Result<Arc<CoverCacheInner>, String> {
    app.try_state::<CoverCacheState>()
        .map(|state| state.0.clone())
        .or_else(|| COVER_CACHE_STATE.get().cloned())
        .ok_or_else(|| "The cover artwork cache is unavailable.".to_string())
}

pub(super) fn cover_cache_key(cover_art_id: &str) -> Result<String, String> {
    validate_identifier(cover_art_id)?;
    let mut digest = Sha256::new();
    digest.update(b"v1/getCoverArt/600/");
    digest.update(cover_art_id.as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn cover_cache_publication_guard() -> Result<MutexGuard<'static, ()>, String> {
    COVER_CACHE_PUBLICATION_LOCK
        .lock()
        .map_err(|_| "The cover artwork publication state is unavailable.".to_string())
}

pub(super) fn content_revision(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_revision(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REVISION_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_session_scope(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

pub(super) fn entry_file_name(entry: &CoverCacheEntry) -> String {
    format!("{}-{}.{}", entry.key, entry.revision, entry.extension)
}

fn entry_path(cache_directory: &Path, entry: &CoverCacheEntry) -> PathBuf {
    cache_directory.join(entry_file_name(entry))
}

fn validate_entry(entry_key: &str, entry: &CoverCacheEntry) -> Result<(), String> {
    if entry_key != entry.key
        || !valid_hash(&entry.key)
        || !valid_revision(&entry.revision)
        || entry.byte_length == 0
        || entry.byte_length > MAX_COVER_ART_BYTES as u64
        || entry.width == 0
        || entry.height == 0
        || entry.width > MAX_COVER_DIMENSION
        || entry.height > MAX_COVER_DIMENSION
        || u64::from(entry.width) * u64::from(entry.height) > MAX_COVER_PIXELS
        || !matches!(
            (entry.media_type.as_str(), entry.extension.as_str()),
            ("image/jpeg", "jpg") | ("image/png", "png") | ("image/webp", "webp")
        )
        || entry.validated_at == 0
        || entry.last_access_at == 0
    {
        return Err("The cover artwork index contains invalid metadata.".into());
    }
    Ok(())
}

pub(super) fn validate_index(index: &CoverCacheIndex) -> Result<(), String> {
    if index.version != COVER_CACHE_VERSION || index.entries.len() > MAX_COVER_CACHE_ENTRIES {
        return Err("The cover artwork index is incompatible or too large.".into());
    }
    let mut total = 0_u64;
    for (key, entry) in &index.entries {
        validate_entry(key, entry)?;
        total = total
            .checked_add(entry.byte_length)
            .ok_or_else(|| "The cover artwork index byte count overflowed.".to_string())?;
    }
    if total > MAX_COVER_CACHE_BYTES {
        return Err("The cover artwork cache exceeds its byte limit.".into());
    }
    Ok(())
}

pub(super) fn serialize_index(index: &CoverCacheIndex) -> Result<Vec<u8>, String> {
    validate_index(index)?;
    let bytes = serde_json::to_vec(index)
        .map_err(|_| "Could not prepare the cover artwork index.".to_string())?;
    if bytes.len() > MAX_COVER_CACHE_INDEX_BYTES {
        return Err("The cover artwork index is unexpectedly large.".into());
    }
    Ok(bytes)
}

pub(super) fn write_index(path: &Path, index: &CoverCacheIndex) -> Result<(), String> {
    write_bytes_atomically(path, &serialize_index(index)?, "cover artwork index")
}

pub(super) fn read_index(path: &Path) -> Result<Option<CoverCacheIndex>, String> {
    let path_metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not inspect the cover artwork index: {error}"
            ))
        }
    };
    if path_metadata.file_type().is_symlink() || !path_metadata.is_file() {
        return Err("The cover artwork index is not a regular file.".into());
    }
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) => return Err(format!("Could not open the cover artwork index: {error}")),
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("Could not inspect the cover artwork index: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_COVER_CACHE_INDEX_BYTES as u64 {
        return Err("The cover artwork index is unexpectedly large or invalid.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_COVER_CACHE_INDEX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the cover artwork index: {error}"))?;
    if bytes.len() > MAX_COVER_CACHE_INDEX_BYTES {
        return Err("The cover artwork index is unexpectedly large.".into());
    }
    let index: CoverCacheIndex = serde_json::from_slice(&bytes)
        .map_err(|_| "The cover artwork index is malformed.".to_string())?;
    validate_index(&index)?;
    Ok(Some(index))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove local cover artwork data: {error}"
        )),
    }
}

fn clear_cache_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || metadata.is_file() => {
            remove_file_if_exists(path)
        }
        Ok(_) => fs::remove_dir_all(path)
            .map_err(|error| format!("Could not clear local cover artwork: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not inspect local cover artwork: {error}")),
    }
}

pub(super) fn load_and_repair_index(
    cache_directory: &Path,
    index_path: &Path,
) -> Result<CoverCacheIndex, String> {
    if cache_directory.exists()
        && fs::symlink_metadata(cache_directory)
            .map(|metadata| metadata.file_type().is_symlink() || !metadata.is_dir())
            .unwrap_or(true)
    {
        clear_cache_directory(cache_directory)?;
    }
    fs::create_dir_all(cache_directory)
        .map_err(|error| format!("Could not create the cover artwork cache: {error}"))?;

    let mut index = match read_index(index_path) {
        Ok(Some(index)) => index,
        Ok(None) => CoverCacheIndex::default(),
        Err(_) => {
            clear_cache_directory(cache_directory)?;
            fs::create_dir_all(cache_directory)
                .map_err(|error| format!("Could not recover the cover artwork cache: {error}"))?;
            CoverCacheIndex::default()
        }
    };
    let mut changed = false;
    index.entries.retain(|_, entry| {
        let path = entry_path(cache_directory, entry);
        let valid = fs::symlink_metadata(&path)
            .map(|metadata| {
                metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && metadata.len() == entry.byte_length
            })
            .unwrap_or(false);
        changed |= !valid;
        valid
    });
    let referenced = index
        .entries
        .values()
        .map(entry_file_name)
        .chain(std::iter::once(COVER_CACHE_INDEX_FILE.to_string()))
        .collect::<HashSet<_>>();
    for item in fs::read_dir(cache_directory)
        .map_err(|error| format!("Could not inspect the cover artwork cache: {error}"))?
    {
        let item = item.map_err(|error| format!("Could not inspect cached artwork: {error}"))?;
        let name = item.file_name().to_string_lossy().to_string();
        if !referenced.contains(&name) {
            let metadata = item
                .file_type()
                .map_err(|error| format!("Could not inspect cached artwork: {error}"))?;
            if metadata.is_dir() && !metadata.is_symlink() {
                fs::remove_dir_all(item.path())
                    .map_err(|error| format!("Could not remove orphaned artwork: {error}"))?;
            } else {
                remove_file_if_exists(&item.path())?;
            }
        }
    }
    if changed {
        write_index(index_path, &index)?;
    }
    Ok(index)
}

pub(super) fn authorize_cover_art_ids<'a>(
    generation: u64,
    expected_credentials: &ConnectionInput,
    cover_art_ids: impl IntoIterator<Item = &'a str>,
) -> Result<(), String> {
    if generation != current_connection_generation() {
        return Err("The Bandcamp connection changed before artwork authorization.".into());
    }
    let Some(state) = COVER_CACHE_STATE.get() else {
        return Ok(());
    };
    let _publication_guard = cover_cache_publication_guard()?;
    let connection_change_in_progress = CONNECTION_CHANGE_IN_PROGRESS.load(Ordering::Acquire);
    let current_credentials = load_credentials().ok();
    if connection_change_in_progress
        || generation != current_connection_generation()
        || current_credentials.as_ref() != Some(expected_credentials)
    {
        return Err("The Bandcamp connection changed before artwork authorization.".into());
    }
    if let Err(error) = retry_cleanup_if_needed(state) {
        // The cache is optional, but access remains fail-closed while the
        // application-data marker survives. A cleanup problem must not discard
        // otherwise valid library metadata.
        eprintln!("Could not retry cover artwork cleanup: {error}");
        return Ok(());
    }
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork authorization state is unavailable.".to_string())?;
    if !authorization_is_current(
        &runtime,
        generation,
        current_connection_generation(),
        connection_change_in_progress,
        expected_credentials,
        current_credentials.as_ref(),
    ) {
        return Err("The Bandcamp connection changed before artwork authorization.".into());
    }
    for id in cover_art_ids {
        validate_identifier(id)?;
        runtime.authorized_ids.insert(id.to_string());
    }
    Ok(())
}

pub(super) fn authorization_is_current(
    runtime: &CoverCacheRuntime,
    expected_generation: u64,
    current_generation: u64,
    connection_change_in_progress: bool,
    expected_credentials: &ConnectionInput,
    current_credentials: Option<&ConnectionInput>,
) -> bool {
    !connection_change_in_progress
        && !runtime.cleanup_pending
        && runtime.generation == expected_generation
        && expected_generation == current_generation
        && current_credentials == Some(expected_credentials)
}

fn retry_cleanup_if_needed(state: &CoverCacheInner) -> Result<(), String> {
    let _cleanup_guard = state
        .cleanup_lock
        .lock()
        .map_err(|_| "The cover artwork cleanup state is unavailable.".to_string())?;
    let pending = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?
        .cleanup_pending;
    if !pending {
        return Ok(());
    }
    clear_cache_directory(&state.cache_directory)?;
    remove_file_if_exists(&state.invalidation_path)?;
    fs::create_dir_all(&state.cache_directory)
        .map_err(|error| format!("Could not recover the cover artwork cache: {error}"))?;
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    runtime.index = CoverCacheIndex::default();
    runtime.cleanup_pending = false;
    Ok(())
}

pub(super) fn authorize_albums(
    generation: u64,
    expected_credentials: &ConnectionInput,
    albums: &[Album],
) -> Result<(), String> {
    authorize_cover_art_ids(
        generation,
        expected_credentials,
        albums.iter().filter_map(|album| album.cover_art.as_deref()),
    )
}

pub(super) fn authorize_tracks(
    generation: u64,
    expected_credentials: &ConnectionInput,
    tracks: &[Track],
) -> Result<(), String> {
    authorize_cover_art_ids(
        generation,
        expected_credentials,
        tracks.iter().filter_map(|track| track.cover_art.as_deref()),
    )
}

pub(super) fn authorize_playlist_summaries(
    generation: u64,
    expected_credentials: &ConnectionInput,
    playlists: &[PlaylistSummary],
) -> Result<(), String> {
    authorize_cover_art_ids(
        generation,
        expected_credentials,
        playlists
            .iter()
            .filter_map(|playlist| playlist.cover_art.as_deref()),
    )
}

pub(super) fn authorize_playlist(
    generation: u64,
    expected_credentials: &ConnectionInput,
    playlist: &PlaylistDetail,
) -> Result<(), String> {
    authorize_cover_art_ids(
        generation,
        expected_credentials,
        playlist.cover_art.as_deref().into_iter().chain(
            playlist
                .tracks
                .iter()
                .filter_map(|track| track.cover_art.as_deref()),
        ),
    )
}

pub(super) fn authorize_player_tracks(
    generation: u64,
    expected_credentials: &ConnectionInput,
    tracks: &[PlayerStateTrack],
) -> Result<(), String> {
    authorize_cover_art_ids(
        generation,
        expected_credentials,
        tracks
            .iter()
            .filter(|track| {
                !track.id.starts_with("radio:")
                    && !track.id.starts_with("daily:")
                    && !track.id.starts_with("discover:")
            })
            .filter_map(|track| track.cover_art.as_deref()),
    )
}

pub(super) fn revoke_cover_art_access(generation: u64) {
    let Some(state) = COVER_CACHE_STATE.get() else {
        return;
    };
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.generation = generation;
        runtime.authorized_ids.clear();
        runtime.leases.clear();
    }
    if let Ok(mut locks) = state.key_locks.lock() {
        locks.clear();
    }
}

fn ensure_authorized(
    state: &CoverCacheInner,
    cover_art_id: &str,
    generation: u64,
) -> Result<(), String> {
    validate_identifier(cover_art_id)?;
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork authorization state is unavailable.".to_string())?;
    if !runtime_authorizes(
        &runtime,
        cover_art_id,
        generation,
        current_connection_generation(),
    ) {
        return Err("The requested cover artwork is not authorized for this connection.".into());
    }
    Ok(())
}

pub(super) fn runtime_authorizes(
    runtime: &CoverCacheRuntime,
    cover_art_id: &str,
    expected_generation: u64,
    current_generation: u64,
) -> bool {
    !runtime.cleanup_pending
        && runtime.generation == expected_generation
        && expected_generation == current_generation
        && runtime.authorized_ids.contains(cover_art_id)
}

pub(super) fn publication_is_current(
    runtime: &CoverCacheRuntime,
    cover_art_id: &str,
    current_generation: u64,
    expected_credentials: &crate::models::ConnectionInput,
    current_credentials: Option<&crate::models::ConnectionInput>,
) -> bool {
    runtime_authorizes(
        runtime,
        cover_art_id,
        runtime.generation,
        current_generation,
    ) && current_credentials == Some(expected_credentials)
}

fn cached_entry(
    state: &CoverCacheInner,
    cover_art_id: &str,
    generation: u64,
) -> Result<Option<(CoverCacheEntry, bool)>, String> {
    ensure_authorized(state, cover_art_id, generation)?;
    let key = cover_cache_key(cover_art_id)?;
    let now = timestamp_ms()?;
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    Ok(runtime
        .index
        .entries
        .get(&key)
        .cloned()
        .map(|entry| (entry.clone(), entry_is_stale(&entry, now))))
}

pub(super) fn entry_is_stale(entry: &CoverCacheEntry, now: u64) -> bool {
    now.saturating_sub(entry.validated_at) >= COVER_ART_FRESH_MS
}

struct ServingLease {
    state: Arc<CoverCacheInner>,
    key: String,
}

impl ServingLease {
    fn acquire(state: Arc<CoverCacheInner>, key: String) -> Result<Self, String> {
        {
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
            *runtime.leases.entry(key.clone()).or_default() += 1;
        }
        Ok(Self { state, key })
    }
}

impl Drop for ServingLease {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.state.runtime.lock() {
            if let Some(count) = runtime.leases.get_mut(&self.key) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    runtime.leases.remove(&self.key);
                }
            }
        }
    }
}

fn read_cached_bytes(
    state: Arc<CoverCacheInner>,
    entry: &CoverCacheEntry,
) -> Result<Vec<u8>, String> {
    let _lease = ServingLease::acquire(state.clone(), entry.key.clone())?;
    let path = entry_path(&state.cache_directory, entry);
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| "Cached cover artwork is missing.".to_string())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() != entry.byte_length
    {
        return Err("Cached cover artwork is invalid.".into());
    }
    let mut bytes = Vec::with_capacity(entry.byte_length as usize);
    fs::File::open(path)
        .and_then(|file| {
            file.take((MAX_COVER_ART_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
        })
        .map_err(|_| "Cached cover artwork could not be read.".to_string())?;
    if bytes.len() as u64 != entry.byte_length || bytes.len() > MAX_COVER_ART_BYTES {
        return Err("Cached cover artwork is invalid.".into());
    }
    Ok(bytes)
}

fn touch_entry(state: &CoverCacheInner, key: &str) -> Result<bool, String> {
    let now = timestamp_ms()?;
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    if let Some(entry) = runtime.index.entries.get_mut(key) {
        entry.last_access_at = now;
        runtime.dirty_touches += 1;
        runtime.hit_count = runtime.hit_count.saturating_add(1);
        return Ok(runtime.dirty_touches >= ACCESS_FLUSH_TOUCHES);
    }
    Ok(false)
}

fn flush_accesses(state: &CoverCacheInner) -> Result<(), String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    if runtime.dirty_touches == 0 || runtime.cleanup_pending {
        return Ok(());
    }
    write_index(&state.index_path, &runtime.index)?;
    runtime.dirty_touches = 0;
    Ok(())
}

async fn record_access(state: Arc<CoverCacheInner>, key: &str) {
    if !matches!(touch_entry(&state, key), Ok(true)) {
        return;
    }
    let _ = tauri::async_runtime::spawn_blocking(move || flush_accesses(&state)).await;
}

fn start_access_flush_worker(app: AppHandle, state: Arc<CoverCacheInner>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(ACCESS_FLUSH_INTERVAL);
        interval.tick().await;
        loop {
            interval.tick().await;
            let state = state.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || flush_accesses(&state)).await;
            if app.get_webview_window("main").is_none() {
                return;
            }
        }
    });
}

pub(super) fn flush_cover_art_accesses(app: &AppHandle) -> Result<(), String> {
    let state = state_from_app(app)?;
    flush_accesses(&state)
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

pub(super) fn cover_redirect_target_is_allowed(target: &url::Url, redirect_count: usize) -> bool {
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

pub(super) fn media_type_from_header(value: &str) -> Option<CoverMediaType> {
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

pub(super) fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
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

pub(super) fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
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

pub(super) fn validate_image(
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

pub(super) fn cover_art_url(
    cover_art_id: &str,
    credentials: &crate::models::ConnectionInput,
) -> Result<url::Url, String> {
    authenticated_url(
        "getCoverArt",
        credentials,
        &[("id", cover_art_id.to_string()), ("size", "600".into())],
    )
}

pub(super) async fn validate_cover_response(
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
    credentials: &crate::models::ConnectionInput,
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

pub(super) fn cover_request_uses_shared_coordinator(priority: BandcampRequestPriority) -> bool {
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

pub(super) fn release_key_lock(
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

pub(super) fn select_evictions(
    runtime: &CoverCacheRuntime,
    replacing_key: &str,
    incoming_bytes: u64,
) -> Option<Vec<String>> {
    let mut count = runtime.index.entries.len();
    let mut bytes = runtime
        .index
        .entries
        .values()
        .map(|entry| entry.byte_length)
        .sum::<u64>();
    if let Some(replaced) = runtime.index.entries.get(replacing_key) {
        bytes = bytes.saturating_sub(replaced.byte_length);
    } else {
        count += 1;
    }
    bytes = bytes.saturating_add(incoming_bytes);
    let mut candidates = runtime
        .index
        .entries
        .iter()
        .filter(|(key, _)| key.as_str() != replacing_key && !runtime.leases.contains_key(*key))
        .map(|(key, entry)| (entry.last_access_at, key.clone()))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let mut evictions = Vec::new();
    for (_, key) in candidates {
        if count <= MAX_COVER_CACHE_ENTRIES && bytes <= MAX_COVER_CACHE_BYTES {
            break;
        }
        let entry = &runtime.index.entries[&key];
        count = count.saturating_sub(1);
        bytes = bytes.saturating_sub(entry.byte_length);
        evictions.push(key);
    }
    (count <= MAX_COVER_CACHE_ENTRIES && bytes <= MAX_COVER_CACHE_BYTES).then_some(evictions)
}

fn publish_cover(
    state: &CoverCacheInner,
    cover_art_id: &str,
    generation: u64,
    expected_credentials: &crate::models::ConnectionInput,
    cover: ValidatedCover<'_>,
) -> Result<(CoverCacheEntry, bool, bool), String> {
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
            &runtime,
            cover_art_id,
            current_connection_generation(),
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
            return Ok((existing, false, true));
        }
    }

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
        return Ok((entry, true, false));
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
    Ok((entry, true, true))
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
    let (entry, changed, persisted) = tauri::async_runtime::spawn_blocking(move || {
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
    if changed {
        let _ = app.emit(
            COVER_UPDATED_EVENT,
            CoverArtUpdatedPayload {
                cover_art_id: cover_art_id.to_string(),
                revision: entry.revision.clone(),
            },
        );
    }
    if persisted {
        record_access(state.clone(), &entry.key).await;
    }
    Ok(ResolvedCoverArt {
        bytes,
        media_type: entry.media_type,
        revision: entry.revision,
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
            let _ = invalidate_entry(&state, cover_art_id);
            Ok(None)
        }
    }
}

pub(super) async fn resolve_cover_art_from_state<Fetch, FetchFuture>(
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

#[cfg(test)]
pub(super) fn cover_cache_state_for_test(
    cache_directory: PathBuf,
    invalidation_path: PathBuf,
    generation: u64,
    authorized_ids: HashSet<String>,
    index: CoverCacheIndex,
) -> Arc<CoverCacheInner> {
    Arc::new(CoverCacheInner {
        index_path: cache_directory.join(COVER_CACHE_INDEX_FILE),
        cache_directory,
        invalidation_path,
        runtime: Mutex::new(CoverCacheRuntime {
            generation,
            authorized_ids,
            index,
            leases: HashMap::new(),
            dirty_touches: 0,
            hit_count: 0,
            miss_count: 0,
            stale_count: 0,
            cleanup_pending: false,
        }),
        cleanup_lock: Mutex::new(()),
        key_locks: Mutex::new(HashMap::new()),
        background_fetches: Semaphore::new(1),
    })
}

fn invalidate_entry(state: &CoverCacheInner, cover_art_id: &str) -> Result<(), String> {
    let key = cover_cache_key(cover_art_id)?;
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    let Some(entry) = runtime.index.entries.remove(&key) else {
        return Ok(());
    };
    if let Err(error) = write_index(&state.index_path, &runtime.index) {
        runtime.index.entries.insert(key, entry);
        return Err(error);
    }
    if let Err(error) = remove_file_if_exists(&entry_path(&state.cache_directory, &entry)) {
        eprintln!("Could not finish removing invalidated cover artwork: {error}");
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn invalidate_cover_art(
    app: AppHandle,
    cover_art_id: String,
) -> Result<(), String> {
    let state = state_from_app(&app)?;
    ensure_authorized(&state, &cover_art_id, current_connection_generation())?;
    tauri::async_runtime::spawn_blocking(move || invalidate_entry(&state, &cover_art_id))
        .await
        .map_err(|error| format!("Could not finish invalidating cover artwork: {error}"))?
}

#[tauri::command]
pub(super) async fn cover_cache_diagnostics(
    app: AppHandle,
) -> Result<CoverCacheDiagnostics, String> {
    let state = state_from_app(&app)?;
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    Ok(CoverCacheDiagnostics {
        entry_count: runtime.index.entries.len(),
        total_bytes: runtime
            .index
            .entries
            .values()
            .map(|entry| entry.byte_length)
            .sum(),
        hit_count: runtime.hit_count,
        miss_count: runtime.miss_count,
        stale_count: runtime.stale_count,
        cleanup_pending: runtime.cleanup_pending,
    })
}

pub(super) fn reset_cover_art_cache(app: &AppHandle) -> Result<CoverCacheReset, String> {
    let state = state_from_app(app)?;
    let _cleanup_guard = state
        .cleanup_lock
        .lock()
        .map_err(|_| "The cover artwork cleanup state is unavailable.".to_string())?;
    write_cleanup_marker(&state.invalidation_path)?;
    {
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
        runtime.cleanup_pending = true;
        runtime.authorized_ids.clear();
        runtime.index = CoverCacheIndex::default();
        runtime.dirty_touches = 0;
    }
    match clear_cache_directory(&state.cache_directory) {
        Ok(()) => {
            remove_file_if_exists(&state.invalidation_path)?;
            fs::create_dir_all(&state.cache_directory)
                .map_err(|error| format!("Could not recreate the cover artwork cache: {error}"))?;
            let mut runtime = state
                .runtime
                .lock()
                .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
            runtime.cleanup_pending = false;
            Ok(CoverCacheReset::Cleared)
        }
        Err(error) => {
            eprintln!("Could not finish clearing local cover artwork: {error}");
            Ok(CoverCacheReset::Invalidated)
        }
    }
}

pub(super) fn parse_cover_protocol_request(
    method: &Method,
    path_and_query: &str,
) -> Result<ParsedCoverProtocolRequest, StatusCode> {
    let head = match *method {
        Method::GET => false,
        Method::HEAD => true,
        _ => return Err(StatusCode::METHOD_NOT_ALLOWED),
    };
    let (path, query) = path_and_query
        .split_once('?')
        .ok_or(StatusCode::BAD_REQUEST)?;
    let encoded_id = path
        .strip_prefix("/v1/600/")
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .ok_or(StatusCode::NOT_FOUND)?;
    let cover_art_id = percent_decode_str(encoded_id)
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .into_owned();
    if validate_identifier(&cover_art_id).is_err() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut revision = None;
    let mut session_scope = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            return Err(StatusCode::BAD_REQUEST);
        };
        match key {
            "v" if revision.is_none() && valid_revision(value) => {
                revision = Some(value.to_string());
            }
            "s" if session_scope.is_none() && valid_session_scope(value) => {
                session_scope = Some(value.to_string());
            }
            _ => return Err(StatusCode::BAD_REQUEST),
        }
    }
    Ok(ParsedCoverProtocolRequest {
        cover_art_id,
        revision: revision.ok_or(StatusCode::BAD_REQUEST)?,
        session_scope: session_scope.ok_or(StatusCode::BAD_REQUEST)?,
        head,
    })
}

fn protocol_error(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("the static cover protocol response is valid")
}

pub(super) fn cover_protocol_success_response(
    resolved: ResolvedCoverArt,
    head: bool,
) -> Response<Vec<u8>> {
    let length = resolved.bytes.len();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, resolved.media_type)
        .header(header::CONTENT_LENGTH, length.to_string())
        // The source URL contains a renderer-generated session scope plus the
        // content revision. Disconnect and account replacement rotate the
        // scope, while an artwork update rotates the revision.
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header("X-Content-Type-Options", "nosniff")
        .body(if head { Vec::new() } else { resolved.bytes })
        .unwrap_or_else(|_| protocol_error(StatusCode::INTERNAL_SERVER_ERROR))
}

pub(super) async fn cover_protocol_response(
    app: &AppHandle,
    webview_label: &str,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if !matches!(webview_label, "main" | "mini-player") {
        return protocol_error(StatusCode::FORBIDDEN);
    }
    let Some(path_and_query) = request.uri().path_and_query().map(|value| value.as_str()) else {
        return protocol_error(StatusCode::BAD_REQUEST);
    };
    let parsed = match parse_cover_protocol_request(request.method(), path_and_query) {
        Ok(parsed) => parsed,
        Err(status) => return protocol_error(status),
    };
    let resolved = match resolve_cover_art(app, &parsed.cover_art_id).await {
        Ok(resolved) => resolved,
        Err(_) => return protocol_error(StatusCode::NOT_FOUND),
    };
    cover_protocol_success_response(resolved, parsed.head)
}
