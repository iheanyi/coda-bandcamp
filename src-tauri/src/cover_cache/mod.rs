mod diagnostics;
mod fetch;
mod protocol;
mod store;

pub(super) use crate::cover_ordering::{
    cover_cache_publication_guard, next_cover_ordering_sequence, publication_is_current,
    CoverArtInvalidationReceipt, CoverArtUpdatedPayload,
};
pub(super) use diagnostics::cover_cache_diagnostics;
pub(crate) use fetch::{invalidate_cover_art, resolve_cover_art};
pub(super) use protocol::cover_protocol_response;
pub(super) use store::{
    flush_cover_art_accesses, reset_cover_art_cache, CoverCacheIndex, CoverCacheReset,
    COVER_CACHE_DIRECTORY, COVER_CACHE_INDEX_FILE, COVER_CACHE_INVALIDATION_FILE,
};

#[cfg(test)]
pub(super) use fetch::{
    cover_art_url, cover_redirect_target_is_allowed, cover_request_uses_shared_coordinator,
    invalidate_entry_ordered, jpeg_dimensions, media_type_from_header, release_key_lock,
    resolve_cover_art_from_state, validate_cover_response, validate_image, webp_dimensions,
    CoverMediaType,
};
#[cfg(test)]
pub(super) use protocol::{cover_protocol_success_response, parse_cover_protocol_request};
#[cfg(test)]
pub(super) use store::{
    content_revision, cover_cache_key, entry_file_name, entry_is_stale, initialize_cache_index,
    load_and_repair_index, read_index, select_evictions, serialize_index, validate_index,
    write_index, CoverCacheEntry, COVER_ART_FRESH_MS, MAX_COVER_ART_BYTES, MAX_COVER_CACHE_BYTES,
    MAX_COVER_CACHE_ENTRIES, MAX_COVER_CACHE_INDEX_BYTES,
};

use crate::library::CONNECTION_CHANGE_IN_PROGRESS;
use crate::models::{
    Album, ConnectionInput, PlayerStateTrack, PlaylistDetail, PlaylistSummary, Track,
};
use crate::subsonic::{current_connection_generation, load_credentials, validate_identifier};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{atomic::Ordering, Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

static COVER_CACHE_STATE: OnceLock<Arc<CoverCacheInner>> = OnceLock::new();

#[derive(Debug, Clone)]
pub(crate) struct ResolvedCoverArt {
    pub(crate) bytes: Vec<u8>,
    pub(crate) media_type: String,
    pub(crate) revision: String,
}

pub(super) struct CoverCacheRuntime {
    pub(super) generation: u64,
    pub(super) ordering_sequence: u64,
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
    pub(in crate::cover_cache) cache_directory: PathBuf,
    pub(in crate::cover_cache) index_path: PathBuf,
    pub(in crate::cover_cache) invalidation_path: PathBuf,
    pub(in crate::cover_cache) runtime: Mutex<CoverCacheRuntime>,
    pub(in crate::cover_cache) cleanup_lock: Mutex<()>,
    pub(in crate::cover_cache) key_locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    pub(in crate::cover_cache) background_fetches: Semaphore,
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
            store::initialize_cache_index(&cache_directory, &index_path, &invalidation_path);

        let inner = Arc::new(CoverCacheInner {
            cache_directory,
            index_path,
            invalidation_path,
            runtime: Mutex::new(CoverCacheRuntime {
                generation: current_connection_generation(),
                ordering_sequence: 0,
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
        store::start_access_flush_worker(app.clone(), inner.clone());
        Ok(Self(inner))
    }
}

pub(in crate::cover_cache) fn state_from_app(
    app: &AppHandle,
) -> Result<Arc<CoverCacheInner>, String> {
    app.try_state::<CoverCacheState>()
        .map(|state| state.0.clone())
        .or_else(|| COVER_CACHE_STATE.get().cloned())
        .ok_or_else(|| "The cover artwork cache is unavailable.".to_string())
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
    if let Err(error) = store::retry_cleanup_if_needed(state) {
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

pub(in crate::cover_cache) fn ensure_authorized(
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
            ordering_sequence: 0,
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

#[cfg(test)]
pub(super) fn next_cover_ordering_sequence_for_test(
    state: &CoverCacheInner,
) -> Result<u64, String> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "The cover artwork cache lock is unavailable.".to_string())?;
    next_cover_ordering_sequence(&mut runtime.ordering_sequence)
}
