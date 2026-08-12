use crate::models::{ConnectionInput, PersistedAlbumTracks, Track};
use crate::storage::write_bytes_atomically;
use crate::subsonic::{
    current_connection_generation, load_credentials, validate_identifier, validate_subsonic_id,
    MAX_SUBSONIC_DURATION_SECONDS,
};
use crate::validation::{
    valid_bounded_text, valid_musicbrainz_id, MAX_METADATA_TEXT_LENGTH, MAX_TRACK_NUMBER,
};
use redb::{
    Database, DatabaseError, ReadableDatabase, ReadableTable, ReadableTableMetadata, StorageError,
    TableDefinition,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
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

static ALBUM_METADATA_CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_DATABASE_INIT_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_DATABASE: OnceLock<Database> = OnceLock::new();
static ALBUM_REFRESH_GENERATIONS: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
pub(super) const ALBUM_TRACKS_TABLE: TableDefinition<&str, &[u8]> =
    TableDefinition::new("album_tracks_v1");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AlbumMetadataCacheReset {
    Cleared,
    Invalidated,
}

pub(super) fn album_refresh_generations() -> &'static Mutex<BTreeMap<String, u64>> {
    ALBUM_REFRESH_GENERATIONS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub(super) fn album_refresh_generation(album_id: &str) -> Result<u64, String> {
    album_refresh_generations()
        .lock()
        .map_err(|_| "The album refresh state is unavailable.".to_string())
        .map(|generations| generations.get(album_id).copied().unwrap_or(0))
}

pub(super) fn bump_album_refresh_generation(album_id: &str) -> Result<u64, String> {
    let mut generations = album_refresh_generations()
        .lock()
        .map_err(|_| "The album refresh state is unavailable.".to_string())?;
    let generation = generations.entry(album_id.to_string()).or_default();
    *generation = generation.saturating_add(1);
    Ok(*generation)
}

pub(super) fn clear_album_refresh_generations() {
    if let Some(generations) = ALBUM_REFRESH_GENERATIONS.get() {
        if let Ok(mut generations) = generations.lock() {
            generations.clear();
        }
    }
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

pub(super) fn remove_persisted_album_tracks(
    database: &Database,
    cache_key: &str,
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

pub(super) fn write_persisted_album_tracks(
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
        current_connection_generation() != expected_generation
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
