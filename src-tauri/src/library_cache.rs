use crate::models::{Album, ConnectionInput, LibraryCacheSnapshot};
use crate::storage::{timestamp_ms, write_bytes_atomically};
use crate::subsonic::{load_credentials, validate_album};
use crate::{
    CONNECTION_GENERATION, LIBRARY_CACHE_FILE, LIBRARY_CACHE_LOCK, LIBRARY_CACHE_TTL_MS,
    LIBRARY_CACHE_VERSION, LIBRARY_SYNC_GENERATION, MAX_LIBRARY_ALBUMS, MAX_LIBRARY_CACHE_BYTES,
};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::Manager;

pub(super) fn library_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LIBRARY_CACHE_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

pub(super) fn validate_library_cache(
    snapshot: &LibraryCacheSnapshot,
    now: u64,
) -> Result<(), String> {
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

pub(super) fn read_library_cache(
    path: &Path,
    now: u64,
) -> Result<Option<LibraryCacheSnapshot>, String> {
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

pub(super) fn write_library_cache(
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

pub(super) fn load_library_cache_or_clear_invalid(
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

pub(super) fn save_library_cache_if_connection_current(
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
    write_library_cache(&path, albums, timestamp_ms()?, last_full_sync_at)?;
    Ok(true)
}
