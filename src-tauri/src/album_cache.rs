use crate::models::{ConnectionInput, PersistedAlbumTracks, Track};
use crate::storage::write_bytes_atomically;
use crate::subsonic::{
    advance_connection_generation, current_connection_generation, load_credentials,
    validate_identifier, validate_subsonic_id, MAX_SUBSONIC_DURATION_SECONDS,
};
use crate::validation::{
    valid_bounded_text, valid_musicbrainz_id, MAX_METADATA_TEXT_LENGTH, MAX_TRACK_NUMBER,
};
use redb::{
    Database, DatabaseError, ReadableDatabase, ReadableTable, ReadableTableMetadata, StorageError,
    TableDefinition,
};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::Manager;

pub(super) const ALBUM_METADATA_CACHE_FILE: &str = "album-metadata-cache-v1.redb";
pub(super) const ALBUM_METADATA_CACHE_INVALIDATION_FILE: &str =
    "album-metadata-cache-invalidated-v1";
pub(super) const ALBUM_TRACK_CACHE_ENTRY_VERSION: u8 = 1;
pub(super) const PERSISTED_ALBUM_TRACK_CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_ENTRIES: usize = 256;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_WEIGHT: usize = 4_096;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PERSISTED_ALBUM_TRACK_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const REDB_ALBUM_METADATA_MEMORY_CACHE_BYTES: usize = 8 * 1024 * 1024;
const REDB_MAGIC: [u8; 9] = [b'r', b'e', b'd', b'b', 0x1A, 0x0A, 0xA9, 0x0D, 0x0A];
const REDB_HEADER_BYTES: usize = 320;
const REDB_PAGE_SIZE: u64 = 4_096;
const REDB_REGION_HEADER_PAGES: u64 = 0;
const REDB_REGION_MAX_DATA_PAGES: u64 = 1_048_576;
const REDB_PAGE_SIZE_OFFSET: usize = 12;
const REDB_REGION_HEADER_PAGES_OFFSET: usize = 16;
const REDB_REGION_MAX_DATA_PAGES_OFFSET: usize = 20;
const REDB_FULL_REGIONS_OFFSET: usize = 24;
const REDB_TRAILING_DATA_PAGES_OFFSET: usize = 28;

static ALBUM_METADATA_CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_CACHE_GENERATION_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_DATABASE_INIT_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_DATABASE: OnceLock<Database> = OnceLock::new();
static ALBUM_REFRESH_GENERATIONS: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
pub(super) const ALBUM_TRACKS_TABLE: TableDefinition<&str, &[u8]> =
    TableDefinition::new("album_tracks_v1");

#[derive(Clone, Copy)]
pub(super) struct AlbumCacheWriteExpectation<'a> {
    connection_generation: Option<u64>,
    credentials: Option<&'a ConnectionInput>,
    refresh: Option<(&'a str, u64)>,
}

#[cfg(test)]
impl<'a> AlbumCacheWriteExpectation<'a> {
    pub(super) fn generations(
        connection_generation: Option<u64>,
        refresh: Option<(&'a str, u64)>,
    ) -> Self {
        Self {
            connection_generation,
            credentials: None,
            refresh,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AlbumMetadataCacheReset {
    Cleared,
    Invalidated,
}

pub(super) fn album_refresh_generations() -> &'static Mutex<BTreeMap<String, u64>> {
    ALBUM_REFRESH_GENERATIONS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn album_metadata_cache_generation_guard() -> MutexGuard<'static, ()> {
    ALBUM_METADATA_CACHE_GENERATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn album_refresh_generation_unlocked(album_id: &str) -> Result<u64, String> {
    album_refresh_generations()
        .lock()
        .map_err(|_| "The album refresh state is unavailable.".to_string())
        .map(|generations| generations.get(album_id).copied().unwrap_or(0))
}

pub(super) fn album_refresh_generation(album_id: &str) -> Result<u64, String> {
    let _generation_guard = album_metadata_cache_generation_guard();
    album_refresh_generation_unlocked(album_id)
}

pub(super) fn bump_album_refresh_generation(album_id: &str) -> Result<u64, String> {
    let _generation_guard = album_metadata_cache_generation_guard();
    let mut generations = album_refresh_generations()
        .lock()
        .map_err(|_| "The album refresh state is unavailable.".to_string())?;
    let generation = generations.entry(album_id.to_string()).or_default();
    *generation = generation.saturating_add(1);
    Ok(*generation)
}

fn clear_album_refresh_generations_unlocked() {
    if let Some(generations) = ALBUM_REFRESH_GENERATIONS.get() {
        if let Ok(mut generations) = generations.lock() {
            generations.clear();
        }
    }
}

pub(super) fn advance_album_cache_connection_generation() -> u64 {
    // Keep every connection generation change ordered with the final cache
    // validity check and commit below. A caller must not advance the
    // connection generation directly.
    let _generation_guard = album_metadata_cache_generation_guard();
    let generation = advance_connection_generation();
    clear_album_refresh_generations_unlocked();
    generation
}

pub(super) fn album_metadata_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(ALBUM_METADATA_CACHE_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

pub(super) fn album_metadata_cache_invalidation_path(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(ALBUM_METADATA_CACHE_INVALIDATION_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

pub(super) fn album_metadata_cache_invalidated_at(path: &Path) -> Result<bool, String> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Could not inspect the album metadata cache invalidation marker: {error}"
        )),
    }
}

pub(super) fn album_metadata_cache_access_allowed_at(path: &Path) -> Result<(), String> {
    if album_metadata_cache_invalidated_at(path)? {
        Err("The album metadata cache remains disabled until local cleanup succeeds.".into())
    } else {
        Ok(())
    }
}

pub(super) fn reset_album_metadata_cache_at<F>(
    invalidation_path: &Path,
    clear: F,
) -> Result<AlbumMetadataCacheReset, String>
where
    F: FnOnce() -> Result<(), String>,
{
    let invalidation_result = match album_metadata_cache_invalidated_at(invalidation_path) {
        Ok(true) => Ok(()),
        Ok(false) | Err(_) => write_bytes_atomically(
            invalidation_path,
            b"coda-album-metadata-cache-invalidated-v1\n",
            "album metadata cache invalidation marker",
        ),
    };
    let clear_result = clear();

    match clear_result {
        Ok(()) => match fs::remove_file(invalidation_path) {
            Ok(()) => Ok(AlbumMetadataCacheReset::Cleared),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(AlbumMetadataCacheReset::Cleared)
            }
            // The data is gone and the remaining marker keeps access fail-closed.
            Err(_) => Ok(AlbumMetadataCacheReset::Invalidated),
        },
        Err(_) if invalidation_result.is_ok() => Ok(AlbumMetadataCacheReset::Invalidated),
        Err(clear_error) => Err(format!(
            "The album metadata cache could not be cleared or invalidated ({clear_error}; {}).",
            invalidation_result.unwrap_err()
        )),
    }
}

pub(super) fn open_album_metadata_database(path: &Path) -> Result<Database, String> {
    let directory = path
        .parent()
        .ok_or_else(|| "The album metadata cache path is invalid.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create Coda's application data directory: {error}"))?;
    let mut file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
    {
        Ok(file) => file,
        Err(error) => {
            return Err(format!("Could not open the album metadata cache: {error}"));
        }
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("Could not inspect the album metadata cache: {error}"))?;
    if !metadata.is_file() {
        return Err("The album metadata cache path is not a file.".into());
    }
    let replace_file = metadata.len() > MAX_PERSISTED_ALBUM_TRACK_CACHE_FILE_BYTES
        || !album_metadata_cache_layout_fits_file(&mut file, metadata.len())?;
    if replace_file {
        drop(file);
        fs::remove_file(path).map_err(|error| {
            format!("Could not replace the corrupted album metadata cache: {error}")
        })?;
        file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| format!("Could not recreate the album metadata cache: {error}"))?;
    }

    let create_database = |file: File| {
        let mut builder = Database::builder();
        builder.set_cache_size(REDB_ALBUM_METADATA_MEMORY_CACHE_BYTES);
        builder.create_file(file)
    };
    let database = match create_database(file) {
        Ok(database) => database,
        Err(open_error) if discardable_album_metadata_database_error(&open_error) => {
            fs::remove_file(path).map_err(|remove_error| {
                format!("Could not recover the album metadata cache ({open_error}; {remove_error})")
            })?;
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|error| format!("Could not recreate the album metadata cache: {error}"))?;
            create_database(file)
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

fn read_redb_header_u32(header: &[u8; REDB_HEADER_BYTES], offset: usize) -> u32 {
    u32::from_le_bytes(
        header[offset..offset + 4]
            .try_into()
            .expect("fixed header field"),
    )
}

fn album_metadata_cache_layout_fits_file(file: &mut File, file_len: u64) -> Result<bool, String> {
    if file_len == 0 {
        return Ok(true);
    }
    if file_len < REDB_HEADER_BYTES as u64 {
        return Ok(false);
    }
    let mut header = [0_u8; REDB_HEADER_BYTES];
    file.read_exact(&mut header)
        .map_err(|error| format!("Could not inspect the album metadata cache header: {error}"))?;
    if header[..REDB_MAGIC.len()] != REDB_MAGIC {
        return Ok(false);
    }

    // redb 4.1 asserts instead of returning an error when a valid header
    // advertises a layout beyond a truncated file. Mirror only the stable
    // fixed-width layout fields needed to reject that impossible shape before
    // handing the disposable cache to redb.
    let page_size = u64::from(read_redb_header_u32(&header, REDB_PAGE_SIZE_OFFSET));
    let region_header_pages = u64::from(read_redb_header_u32(
        &header,
        REDB_REGION_HEADER_PAGES_OFFSET,
    ));
    let region_max_data_pages = u64::from(read_redb_header_u32(
        &header,
        REDB_REGION_MAX_DATA_PAGES_OFFSET,
    ));
    let full_regions = u64::from(read_redb_header_u32(&header, REDB_FULL_REGIONS_OFFSET));
    let trailing_data_pages = u64::from(read_redb_header_u32(
        &header,
        REDB_TRAILING_DATA_PAGES_OFFSET,
    ));
    // Coda uses redb's production defaults (4 KiB pages and 4 GiB regions),
    // and caps this disposable cache below one full region. Accept only that
    // exact shape: merely length-consistent forged layouts can still trip
    // redb's allocator assertions before it can report corruption.
    if page_size != REDB_PAGE_SIZE
        || region_header_pages != REDB_REGION_HEADER_PAGES
        || region_max_data_pages != REDB_REGION_MAX_DATA_PAGES
        || full_regions != 0
        || trailing_data_pages == 0
        || trailing_data_pages >= region_max_data_pages
    {
        return Ok(false);
    }

    let full_region_bytes = region_header_pages
        .checked_add(region_max_data_pages)
        .and_then(|pages| pages.checked_mul(page_size));
    let full_regions_bytes = full_region_bytes.and_then(|bytes| bytes.checked_mul(full_regions));
    let trailing_region_bytes = if trailing_data_pages == 0 {
        Some(0)
    } else {
        region_header_pages
            .checked_add(trailing_data_pages)
            .and_then(|pages| pages.checked_mul(page_size))
    };
    let expected_len = full_regions_bytes
        .and_then(|bytes| bytes.checked_add(trailing_region_bytes?))
        .and_then(|bytes| bytes.checked_add(page_size));
    Ok(expected_len.is_some_and(|expected_len| expected_len == file_len))
}

fn discardable_album_metadata_database_error(error: &DatabaseError) -> bool {
    matches!(
        error,
        DatabaseError::Storage(StorageError::Corrupted(_)) | DatabaseError::UpgradeRequired(_)
    ) || matches!(
        error,
        DatabaseError::Storage(StorageError::Io(error))
            if matches!(error.kind(), ErrorKind::InvalidData | ErrorKind::UnexpectedEof)
    )
}

pub(super) fn album_metadata_database(app: &tauri::AppHandle) -> Result<&'static Database, String> {
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

pub(super) fn reset_album_metadata_cache(
    app: &tauri::AppHandle,
) -> Result<AlbumMetadataCacheReset, String> {
    let invalidation_path = album_metadata_cache_invalidation_path(app)?;
    reset_album_metadata_cache_at(&invalidation_path, || {
        album_metadata_database(app).and_then(clear_persisted_album_tracks)
    })
}

pub(super) fn album_metadata_database_for_access(
    app: &tauri::AppHandle,
) -> Result<Option<&'static Database>, String> {
    let invalidation_path = album_metadata_cache_invalidation_path(app)?;
    match album_metadata_cache_access_allowed_at(&invalidation_path) {
        Ok(()) => album_metadata_database(app).map(Some),
        Err(_) if album_metadata_cache_invalidated_at(&invalidation_path)? => {
            match reset_album_metadata_cache(app)? {
                AlbumMetadataCacheReset::Cleared => album_metadata_database(app).map(Some),
                AlbumMetadataCacheReset::Invalidated => Ok(None),
            }
        }
        Err(error) => Err(error),
    }
}

pub(super) fn album_track_cache_namespace(credentials: &ConnectionInput) -> String {
    // This is an opaque, stable cache namespace rather than a security
    // boundary. The password is deliberately excluded so neither credential
    // is persisted and password rotation does not strand valid metadata.
    format!("{:x}", md5::compute(credentials.username.as_bytes()))
}

pub(super) fn persisted_album_track_cache_key(
    credentials: &ConnectionInput,
    album_id: &str,
) -> String {
    format!("{}:{album_id}", album_track_cache_namespace(credentials))
}

pub(super) fn album_id_from_persisted_cache_key(key: &str) -> Option<&str> {
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

pub(super) fn validate_persisted_album_tracks(
    entry: &PersistedAlbumTracks,
    album_id: &str,
    now: u64,
) -> Result<(), String> {
    if entry.version != ALBUM_TRACK_CACHE_ENTRY_VERSION
        || entry.saved_at > now
        || now.saturating_sub(entry.saved_at) > PERSISTED_ALBUM_TRACK_CACHE_TTL_MS
        || entry.album_id != album_id
        || entry.tracks.is_empty()
        || entry.tracks.len() > MAX_PERSISTED_ALBUM_TRACK_CACHE_WEIGHT
    {
        return Err("The saved album metadata is stale or incompatible.".into());
    }
    if entry.tracks.iter().any(|track| {
        track.album_id != album_id
            || validate_subsonic_id(&track.id, "song").is_err()
            || validate_subsonic_id(&track.album_id, "album").is_err()
            || !valid_bounded_text(&track.title, MAX_METADATA_TEXT_LENGTH, true)
            || !valid_bounded_text(&track.artist, MAX_METADATA_TEXT_LENGTH, true)
            || !valid_bounded_text(&track.album, MAX_METADATA_TEXT_LENGTH, false)
            || track.duration > MAX_SUBSONIC_DURATION_SECONDS
            || track.track > MAX_TRACK_NUMBER
            || track.disc.is_some_and(|disc| disc > MAX_TRACK_NUMBER)
            || track
                .album_artist
                .as_deref()
                .is_some_and(|artist| !valid_bounded_text(artist, MAX_METADATA_TEXT_LENGTH, false))
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

fn remove_persisted_album_tracks_if_unchanged(
    database: &Database,
    cache_key: &str,
    expected_serialized: &[u8],
) -> Result<(), String> {
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
        let unchanged = table
            .get(cache_key)
            .map_err(|error| format!("Could not inspect the album metadata cache: {error}"))?
            .is_some_and(|value| value.value() == expected_serialized);
        if !unchanged {
            return Ok(());
        }
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

pub(super) fn read_persisted_album_tracks(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    now: u64,
) -> Result<Option<Vec<Track>>, String> {
    read_persisted_album_tracks_inner(database, cache_key, album_id, now, || {})
}

fn read_persisted_album_tracks_inner<F>(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    now: u64,
    before_prune: F,
) -> Result<Option<Vec<Track>>, String>
where
    F: FnOnce(),
{
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
        before_prune();
        remove_persisted_album_tracks_if_unchanged(database, cache_key, &serialized)?;
        return Ok(None);
    }
    let entry = match serde_json::from_slice::<PersistedAlbumTracks>(&serialized) {
        Ok(entry) if validate_persisted_album_tracks(&entry, album_id, now).is_ok() => entry,
        _ => {
            before_prune();
            remove_persisted_album_tracks_if_unchanged(database, cache_key, &serialized)?;
            return Ok(None);
        }
    };
    Ok(Some(entry.tracks))
}

#[cfg(test)]
pub(super) fn read_persisted_album_tracks_with_before_prune<F>(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    now: u64,
    before_prune: F,
) -> Result<Option<Vec<Track>>, String>
where
    F: FnOnce(),
{
    read_persisted_album_tracks_inner(database, cache_key, album_id, now, before_prune)
}

#[derive(Debug)]
struct PersistedAlbumTrackIndex {
    key: String,
    saved_at: u64,
    bytes: usize,
}

pub(super) fn write_persisted_album_tracks(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    tracks: &[Track],
    now: u64,
    expected_connection: Option<(u64, &ConnectionInput)>,
    expected_refresh: Option<(&str, u64)>,
) -> Result<bool, String> {
    let expectation = AlbumCacheWriteExpectation {
        connection_generation: expected_connection.map(|(generation, _)| generation),
        credentials: expected_connection.map(|(_, credentials)| credentials),
        refresh: expected_refresh,
    };
    write_persisted_album_tracks_inner(
        database,
        cache_key,
        album_id,
        tracks,
        now,
        expectation,
        || {},
    )
}

fn expected_album_cache_generations_are_current(
    expectation: AlbumCacheWriteExpectation<'_>,
) -> bool {
    !expectation
        .connection_generation
        .is_some_and(|expected_generation| current_connection_generation() != expected_generation)
        && !expectation
            .refresh
            .is_some_and(|(expected_album_id, expected_generation)| {
                album_refresh_generation_unlocked(expected_album_id).ok()
                    != Some(expected_generation)
            })
}

fn write_persisted_album_tracks_inner<F>(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    tracks: &[Track],
    now: u64,
    expectation: AlbumCacheWriteExpectation<'_>,
    before_commit: F,
) -> Result<bool, String>
where
    F: FnOnce(),
{
    let _guard = ALBUM_METADATA_CACHE_WRITE_LOCK
        .lock()
        .map_err(|_| "The album metadata cache lock is unavailable.".to_string())?;
    {
        let _generation_guard = album_metadata_cache_generation_guard();
        if !expected_album_cache_generations_are_current(expectation)
            || expectation.credentials.is_some_and(|expected_credentials| {
                load_credentials().ok().as_ref() != Some(expected_credentials)
            })
        {
            return Ok(false);
        }
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
    before_commit();
    let _generation_guard = album_metadata_cache_generation_guard();
    if !expected_album_cache_generations_are_current(expectation) {
        return Ok(false);
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not save the album metadata cache: {error}"))?;
    Ok(true)
}

#[cfg(test)]
pub(super) fn write_persisted_album_tracks_with_before_commit<F>(
    database: &Database,
    cache_key: &str,
    album_id: &str,
    tracks: &[Track],
    now: u64,
    expectation: AlbumCacheWriteExpectation<'_>,
    before_commit: F,
) -> Result<bool, String>
where
    F: FnOnce(),
{
    write_persisted_album_tracks_inner(
        database,
        cache_key,
        album_id,
        tracks,
        now,
        expectation,
        before_commit,
    )
}

pub(super) fn clear_persisted_album_tracks(database: &Database) -> Result<(), String> {
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
