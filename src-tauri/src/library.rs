use crate::album_cache::{
    advance_album_cache_connection_generation, album_metadata_database_for_access,
    album_refresh_generation, bump_album_refresh_generation, persisted_album_track_cache_key,
    read_persisted_album_tracks, reset_album_metadata_cache, write_persisted_album_tracks,
    AlbumMetadataCacheReset,
};
use crate::cover_cache::{
    authorize_albums, authorize_tracks, cover_cache_publication_guard, reset_cover_art_cache,
    revoke_cover_art_access, CoverCacheReset,
};
use crate::library_cache::{
    library_cache_path, load_library_cache_or_clear_invalid, write_library_cache,
    LIBRARY_CACHE_LOCK, LIBRARY_FULL_RECONCILE_INTERVAL_MS, MAX_LIBRARY_ALBUMS,
};
use crate::models::{Album, ConnectionInput, LibraryCacheSnapshot, LibrarySyncEvent, Track};
use crate::storage::{run_blocking, timestamp_ms};
use crate::subsonic::{
    bounded_album_from_value, bounded_track_from_value, credential_entry,
    current_connection_generation, load_credentials, load_credentials_async, request_json,
    store_credentials_async, validate_credentials, validate_identifier, MAX_PLAYLIST_TRACKS,
};
use chrono::DateTime;
use serde_json::Value;
use std::collections::{BTreeSet, VecDeque};
use std::fs;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex, OnceLock,
};
use tauri::ipc::Channel;

const MAX_PENDING_ALBUM_CACHE_WRITES: usize = 16;

struct AlbumPersistJob {
    app: tauri::AppHandle,
    cache_key: String,
    album_id: String,
    tracks: Vec<Track>,
    expected_generation: u64,
    expected_credentials: ConnectionInput,
    expected_refresh_generation: u64,
}

static ALBUM_PERSIST_QUEUE: OnceLock<Mutex<VecDeque<AlbumPersistJob>>> = OnceLock::new();
static ALBUM_PERSIST_WORKER_RUNNING: AtomicBool = AtomicBool::new(false);
pub(super) static CONNECTION_CHANGE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static LIBRARY_SYNC_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(super) struct ConnectionChangeGuard {
    album_cache_generation: u64,
}

impl ConnectionChangeGuard {
    pub(super) fn begin() -> Result<Self, String> {
        CONNECTION_CHANGE_IN_PROGRESS
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                "Another Bandcamp connection change is already in progress.".to_string()
            })?;
        let cover_publication_guard = match cover_cache_publication_guard() {
            Ok(guard) => guard,
            Err(error) => {
                CONNECTION_CHANGE_IN_PROGRESS.store(false, Ordering::Release);
                return Err(error);
            }
        };
        let album_cache_generation = advance_album_cache_connection_generation();
        revoke_cover_art_access(album_cache_generation);
        drop(cover_publication_guard);
        Ok(Self {
            album_cache_generation,
        })
    }

    fn album_cache_generation(&self) -> u64 {
        self.album_cache_generation
    }
}

impl Drop for ConnectionChangeGuard {
    fn drop(&mut self) {
        CONNECTION_CHANGE_IN_PROGRESS.store(false, Ordering::Release);
    }
}

pub(super) fn album_request_connection_is_current(
    expected_generation: u64,
    current_generation: u64,
    connection_change_in_progress: bool,
) -> bool {
    !connection_change_in_progress && expected_generation == current_generation
}

pub(super) fn library_sync_generation() -> u64 {
    LIBRARY_SYNC_GENERATION.load(Ordering::Acquire)
}

fn advance_library_sync_generation() -> u64 {
    LIBRARY_SYNC_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

pub(super) fn save_library_cache_if_connection_current(
    app: &tauri::AppHandle,
    albums: &[Album],
    expected_generation: u64,
    expected_sync_generation: u64,
    expected_credentials: &ConnectionInput,
    last_full_sync_at: u64,
) -> Result<bool, String> {
    let _guard = LIBRARY_CACHE_LOCK
        .lock()
        .map_err(|_| "The library cache lock is unavailable.".to_string())?;
    if current_connection_generation() != expected_generation
        || library_sync_generation() != expected_sync_generation
        || load_credentials().ok().as_ref() != Some(expected_credentials)
    {
        return Ok(false);
    }
    write_library_cache(
        &library_cache_path(app)?,
        albums,
        timestamp_ms()?,
        last_full_sync_at,
    )?;
    Ok(true)
}

pub(super) fn connection_owner_changed(
    previous_credentials: Option<&ConnectionInput>,
    next_credentials: &ConnectionInput,
) -> bool {
    previous_credentials
        .map(|credentials| credentials.username != next_credentials.username)
        .unwrap_or(true)
}

fn clear_library_cache_file(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = LIBRARY_CACHE_LOCK
        .lock()
        .map_err(|_| "The library cache lock is unavailable.".to_string())?;
    match fs::remove_file(library_cache_path(app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove the prior saved library: {error}")),
    }
}

fn cancel_pending_album_cache_writes() {
    if let Some(queue) = ALBUM_PERSIST_QUEUE.get() {
        if let Ok(mut queue) = queue.lock() {
            queue.clear();
        }
    }
}

pub(super) fn finish_disconnect_cache_cleanup(
    library_result: Result<(), String>,
    album_result: Result<AlbumMetadataCacheReset, String>,
    cover_result: Result<CoverCacheReset, String>,
) -> Option<&'static str> {
    let cover_cleanup_finished = matches!(cover_result, Ok(CoverCacheReset::Cleared));
    if library_result.is_ok() && album_result.is_ok() && cover_cleanup_finished {
        if matches!(album_result, Ok(AlbumMetadataCacheReset::Invalidated)) {
            eprintln!("The album metadata cache remains disabled while local cleanup retries.");
        }
        return None;
    }
    Some(
        "Bandcamp credentials were removed, but Coda could not finish clearing local library metadata or cover artwork. No credentials remain; retry connecting later and Coda will retry cleanup before saving credentials."
    )
}

#[tauri::command]
pub(super) async fn has_connection() -> bool {
    run_blocking("Could not finish checking the Bandcamp connection", || {
        Ok(load_credentials().is_ok())
    })
    .await
    .unwrap_or(false)
}

fn disconnect_blocking_with_guard(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            advance_library_sync_generation();
            cancel_pending_album_cache_writes();
            let library_result = clear_library_cache_file(app);
            let album_result = reset_album_metadata_cache(app);
            let cover_result = reset_cover_art_cache(app);
            let warning =
                finish_disconnect_cache_cleanup(library_result, album_result, cover_result);
            if let Some(warning) = &warning {
                eprintln!("Could not finish disconnect cleanup: {warning}");
            }
            Ok(warning.map(str::to_string))
        }
        Err(error) => Err(format!("Could not remove credentials: {error}")),
    }
}

fn disconnect_blocking(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let _connection_change_guard = ConnectionChangeGuard::begin()?;
    disconnect_blocking_with_guard(&app)
}

#[tauri::command]
pub(super) async fn disconnect(app: tauri::AppHandle) -> Result<Option<String>, String> {
    run_blocking("Could not finish disconnecting Bandcamp", move || {
        disconnect_blocking(app)
    })
    .await
}

#[tauri::command]
pub(super) async fn load_library_cache(
    app: tauri::AppHandle,
) -> Result<Option<LibraryCacheSnapshot>, String> {
    let credentials = load_credentials_async().await?;
    let generation = current_connection_generation();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_CACHE_LOCK
            .lock()
            .map_err(|_| "The library cache lock is unavailable.".to_string())?;
        load_library_cache_or_clear_invalid(&library_cache_path(&app)?, timestamp_ms()?)
    })
    .await
    .map_err(|error| format!("Could not load the saved library: {error}"))??;
    if let Some(snapshot) = &snapshot {
        authorize_albums(generation, &credentials, &snapshot.albums)?;
    }
    Ok(snapshot)
}

pub(super) async fn fetch_library_page(
    credentials: &ConnectionInput,
    page_index: u64,
) -> Result<(usize, Vec<Album>), String> {
    fetch_album_list_page(credentials, "alphabeticalByArtist", 500, page_index * 500).await
}

pub(super) async fn fetch_newest_library_album(
    credentials: &ConnectionInput,
) -> Result<Option<Album>, String> {
    let (_, albums) = fetch_album_list_page(credentials, "newest", 1, 0).await?;
    Ok(albums.into_iter().next())
}

pub(super) async fn fetch_album_list_page(
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
    run_blocking(
        "Could not finish processing the Bandcamp library page",
        move || albums_from_library_page(&body),
    )
    .await
}

pub(super) fn newest_cached_album(albums: &[Album]) -> Option<&Album> {
    albums
        .iter()
        .filter_map(|album| {
            let added_at = album.added_at.as_deref()?;
            let parsed = DateTime::parse_from_rfc3339(added_at)
                .or_else(|_| DateTime::parse_from_rfc2822(added_at))
                .ok()?;
            Some(((parsed.timestamp(), parsed.timestamp_subsec_nanos()), album))
        })
        .max_by(|(left_added, left), (right_added, right)| {
            left_added
                .cmp(right_added)
                .then_with(|| left.id.cmp(&right.id))
        })
        .map(|(_, album)| album)
}

pub(super) fn newest_probe_matches_cache(
    snapshot: &LibraryCacheSnapshot,
    newest: Option<&Album>,
) -> bool {
    match (newest_cached_album(&snapshot.albums), newest) {
        (None, None) => snapshot.albums.is_empty(),
        (Some(cached), Some(incoming)) => cached == incoming,
        _ => false,
    }
}

pub(super) fn cache_requires_full_reconciliation(
    snapshot: &LibraryCacheSnapshot,
    now: u64,
) -> bool {
    snapshot.last_full_sync_at == 0
        || snapshot.last_full_sync_at > now
        || now.saturating_sub(snapshot.last_full_sync_at) >= LIBRARY_FULL_RECONCILE_INTERVAL_MS
}

pub(super) fn albums_from_library_page(body: &Value) -> Result<(usize, Vec<Album>), String> {
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

pub(super) fn append_library_page(
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

pub(super) fn emit_library_page(
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

pub(super) fn ensure_library_sync_current(
    expected_sync_generation: u64,
    expected_connection_generation: Option<u64>,
) -> Result<(), String> {
    if library_sync_generation() != expected_sync_generation
        || expected_connection_generation
            .is_some_and(|expected| current_connection_generation() != expected)
    {
        return Err("The Bandcamp connection changed before sync completed.".into());
    }
    Ok(())
}

pub(super) async fn fetch_library_with_credentials(
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

pub(super) fn connection_error(error: String) -> String {
    if error.contains("HTTP 500") {
        "Bandcamp could not authenticate those generated credentials. Generate a new pair in Fan Settings and try again; Bandcamp's Subsonic service is still in beta.".to_string()
    } else {
        error
    }
}

pub(super) fn finish_library_cache_write(
    result: Result<bool, String>,
    operation: &str,
) -> Result<(), String> {
    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err("The Bandcamp connection changed before sync completed.".into()),
        Err(error) => {
            // The live library is already usable and the credential state is
            // committed. A restart-safe cache is an optimization, so a local
            // disk failure must not turn a successful connection or sync into
            // a false user-facing failure.
            eprintln!("{operation}: {error}");
            Ok(())
        }
    }
}

#[tauri::command]
pub(super) async fn connect(
    app: tauri::AppHandle,
    input: ConnectionInput,
    on_progress: Channel<LibrarySyncEvent>,
) -> Result<Vec<Album>, String> {
    validate_credentials(&input)?;
    let previous_credentials = run_blocking(
        "Could not finish reading the previous Bandcamp connection",
        || Ok(load_credentials().ok()),
    )
    .await?;
    let sync_generation = advance_library_sync_generation();
    let albums = fetch_library_with_credentials(&input, &on_progress, None, sync_generation)
        .await
        .map_err(connection_error)?;
    ensure_library_sync_current(sync_generation, None)?;
    let owner_changed = connection_owner_changed(previous_credentials.as_ref(), &input);
    let connection_change_guard = ConnectionChangeGuard::begin()?;
    let connection_generation = connection_change_guard.album_cache_generation();
    if owner_changed {
        cancel_pending_album_cache_writes();
        let album_cache_app = app.clone();
        let reset = run_blocking("Could not finish resetting the album cache", move || {
            reset_album_metadata_cache(&album_cache_app)
        })
        .await
        .map_err(|_| {
            "Coda could not safely revoke the prior album metadata. The Bandcamp connection was not changed; retry connecting."
                .to_string()
        })?;
        if reset == AlbumMetadataCacheReset::Invalidated {
            eprintln!("The prior album metadata cache remains disabled while cleanup retries.");
        }

        let library_cache_app = app.clone();
        run_blocking("Could not finish resetting the library cache", move || {
            clear_library_cache_file(&library_cache_app)
        })
        .await?;

        let cover_cache_app = app.clone();
        let cover_reset = run_blocking("Could not finish resetting the artwork cache", move || {
            reset_cover_art_cache(&cover_cache_app)
        })
        .await?;
        if cover_reset == CoverCacheReset::Invalidated {
            eprintln!("The prior cover artwork cache remains disabled while cleanup retries.");
        }
    }
    ensure_library_sync_current(sync_generation, None)?;
    store_credentials_async(input.clone()).await?;

    let stored = match load_credentials_async().await {
        Ok(stored) => stored,
        Err(error) => {
            let cleanup_app = app.clone();
            if let Err(cleanup_error) = run_blocking(
                "Could not finish removing an unverified Bandcamp connection",
                move || disconnect_blocking_with_guard(&cleanup_app),
            )
            .await
            {
                return Err(format!(
                    "Credentials were accepted but could not be verified or removed from the system vault: {error}. {cleanup_error}"
                ));
            }
            return Err(format!(
                "Credentials were accepted but could not be verified in the system vault, so Coda removed them: {error}"
            ));
        }
    };
    if stored.username != input.username || stored.password != input.password {
        let cleanup_app = app.clone();
        run_blocking(
            "Could not finish removing an unverified Bandcamp connection",
            move || disconnect_blocking_with_guard(&cleanup_app),
        )
        .await?;
        return Err(
            "Credentials were accepted but the system vault did not return the saved connection."
                .into(),
        );
    }

    drop(connection_change_guard);
    authorize_albums(connection_generation, &input, &albums)?;
    let cache_app = app.clone();
    let cached_albums = albums.clone();
    let cached_credentials = input.clone();
    let full_sync_at = timestamp_ms()?;
    let cache_result = tauri::async_runtime::spawn_blocking(move || {
        save_library_cache_if_connection_current(
            &cache_app,
            &cached_albums,
            connection_generation,
            sync_generation,
            &cached_credentials,
            full_sync_at,
        )
    })
    .await
    .map_err(|error| format!("Could not save the library cache: {error}"))?;
    finish_library_cache_write(cache_result, "Could not save the library cache")?;

    Ok(albums)
}

#[tauri::command]
pub(super) async fn fetch_library(
    app: tauri::AppHandle,
    on_progress: Channel<LibrarySyncEvent>,
    force_full: bool,
) -> Result<Vec<Album>, String> {
    let credentials = load_credentials_async().await?;
    let connection_generation = current_connection_generation();
    let sync_generation = advance_library_sync_generation();
    let now = timestamp_ms()?;
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
                        last_full_sync_at,
                    )
                })
                .await
                .map_err(|error| format!("Could not refresh the library cache: {error}"))?;
                finish_library_cache_write(cache_result, "Could not refresh the library cache")?;
                authorize_albums(connection_generation, &credentials, &response_albums)?;
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
    let full_sync_at = timestamp_ms()?;
    let cache_result = tauri::async_runtime::spawn_blocking(move || {
        save_library_cache_if_connection_current(
            &cache_app,
            &cached_albums,
            connection_generation,
            sync_generation,
            &cached_credentials,
            full_sync_at,
        )
    })
    .await
    .map_err(|error| format!("Could not save the library cache: {error}"))?;
    finish_library_cache_write(cache_result, "Could not save the library cache")?;
    authorize_albums(connection_generation, &credentials, &albums)?;
    Ok(albums)
}

pub(super) fn album_tracks_from_response(
    body: &Value,
    album_id: &str,
) -> Result<Vec<Track>, String> {
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

pub(super) async fn fetch_album_from_bandcamp(
    album_id: &str,
    credentials: &ConnectionInput,
) -> Result<Vec<Track>, String> {
    let body = request_json("getAlbum", credentials, &[("id", album_id.to_string())]).await?;
    let expected_album_id = album_id.to_string();
    run_blocking(
        "Could not finish processing the Bandcamp album",
        move || album_tracks_from_response(&body, &expected_album_id),
    )
    .await
}

pub(super) fn schedule_persist_album_tracks(
    app: tauri::AppHandle,
    cache_key: String,
    album_id: String,
    tracks: Vec<Track>,
    expected_generation: u64,
    expected_credentials: ConnectionInput,
    expected_refresh_generation: u64,
) {
    let job = AlbumPersistJob {
        app,
        cache_key,
        album_id,
        tracks,
        expected_generation,
        expected_credentials,
        expected_refresh_generation,
    };
    let should_start_worker = {
        let queue = ALBUM_PERSIST_QUEUE.get_or_init(|| Mutex::new(VecDeque::new()));
        let Ok(mut queue) = queue.lock() else {
            return;
        };
        if let Some(index) = queue
            .iter()
            .position(|pending| pending.album_id == job.album_id)
        {
            queue.remove(index);
        } else if queue.len() >= MAX_PENDING_ALBUM_CACHE_WRITES {
            queue.pop_front();
        }
        queue.push_back(job);
        !ALBUM_PERSIST_WORKER_RUNNING.swap(true, Ordering::AcqRel)
    };
    if should_start_worker {
        drop(tauri::async_runtime::spawn(run_album_persist_worker()));
    }
}

async fn run_album_persist_worker() {
    loop {
        let next = {
            let queue = ALBUM_PERSIST_QUEUE.get_or_init(|| Mutex::new(VecDeque::new()));
            let Ok(mut queue) = queue.lock() else {
                ALBUM_PERSIST_WORKER_RUNNING.store(false, Ordering::Release);
                return;
            };
            match queue.pop_front() {
                Some(job) => Some(job),
                None => {
                    ALBUM_PERSIST_WORKER_RUNNING.store(false, Ordering::Release);
                    None
                }
            }
        };
        let Some(job) = next else {
            return;
        };
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let Ok(Some(database)) = album_metadata_database_for_access(&job.app) else {
                return;
            };
            let Ok(now) = timestamp_ms() else {
                return;
            };
            let _ = write_persisted_album_tracks(
                database,
                &job.cache_key,
                &job.album_id,
                &job.tracks,
                now,
                Some((job.expected_generation, &job.expected_credentials)),
                Some((&job.album_id, job.expected_refresh_generation)),
            );
        })
        .await;
    }
}

pub(super) async fn load_persisted_album_tracks(
    app: tauri::AppHandle,
    cache_key: String,
    album_id: String,
) -> Option<Vec<Track>> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = album_metadata_database_for_access(&app).ok().flatten()?;
        let now = timestamp_ms().ok()?;
        read_persisted_album_tracks(database, &cache_key, &album_id, now)
            .ok()
            .flatten()
    })
    .await
    .ok()
    .flatten()
}

pub(super) fn ensure_album_request_current(
    connection_generation: u64,
    album_id: &str,
    refresh_generation: u64,
) -> Result<(), String> {
    if !album_request_connection_is_current(
        connection_generation,
        current_connection_generation(),
        CONNECTION_CHANGE_IN_PROGRESS.load(Ordering::Acquire),
    ) {
        return Err("The Bandcamp connection changed while the album was loading.".into());
    }
    if album_refresh_generation(album_id)? != refresh_generation {
        return Err("The album was refreshed while an older request was loading.".into());
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn fetch_album(
    app: tauri::AppHandle,
    album_id: String,
    force_refresh: bool,
) -> Result<Vec<Track>, String> {
    validate_identifier(&album_id)?;
    if CONNECTION_CHANGE_IN_PROGRESS.load(Ordering::Acquire) {
        return Err("The Bandcamp connection is changing; retry the album shortly.".into());
    }
    let connection_generation = current_connection_generation();
    let refresh_generation = if force_refresh {
        bump_album_refresh_generation(&album_id)?
    } else {
        album_refresh_generation(&album_id)?
    };
    let credentials = load_credentials_async().await?;
    let persistent_key = persisted_album_track_cache_key(&credentials, &album_id);

    if force_refresh {
        let tracks = fetch_album_from_bandcamp(&album_id, &credentials).await?;
        ensure_album_request_current(connection_generation, &album_id, refresh_generation)?;
        authorize_tracks(connection_generation, &credentials, &tracks)?;
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
        authorize_tracks(connection_generation, &credentials, &tracks)?;
        return Ok(tracks);
    }

    let tracks = fetch_album_from_bandcamp(&album_id, &credentials).await?;
    ensure_album_request_current(connection_generation, &album_id, refresh_generation)?;
    authorize_tracks(connection_generation, &credentials, &tracks)?;
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
