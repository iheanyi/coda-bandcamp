use crate::models::{Album, LibraryCacheSnapshot};
use crate::storage::write_bytes_atomically;
use crate::subsonic::validate_album;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub(super) const LIBRARY_CACHE_VERSION: u8 = 1;
pub(super) const LIBRARY_CACHE_FILE: &str = "library-cache-v1.json";
pub(super) const LIBRARY_CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub(super) const LIBRARY_FULL_RECONCILE_INTERVAL_MS: u64 = 24 * 60 * 60 * 1_000;
pub(super) const MAX_LIBRARY_ALBUMS: usize = 5_000;
const MAX_LIBRARY_CACHE_BYTES: usize = 32 * 1024 * 1024;

pub(super) static LIBRARY_CACHE_LOCK: Mutex<()> = Mutex::new(());

enum LibraryCacheReadError {
    Discardable(String),
    Operational(String),
}

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

fn read_library_cache_classified(
    path: &Path,
    now: u64,
) -> Result<Option<LibraryCacheSnapshot>, LibraryCacheReadError> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(LibraryCacheReadError::Operational(format!(
                "Could not open the saved library: {error}"
            )))
        }
    };
    if file
        .metadata()
        .map_err(|error| {
            LibraryCacheReadError::Operational(format!(
                "Could not inspect the saved library: {error}"
            ))
        })?
        .len()
        > MAX_LIBRARY_CACHE_BYTES as u64
    {
        return Err(LibraryCacheReadError::Discardable(
            "The saved library is unexpectedly large.".into(),
        ));
    }
    let mut bytes = Vec::new();
    file.take((MAX_LIBRARY_CACHE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            LibraryCacheReadError::Operational(format!("Could not read the saved library: {error}"))
        })?;
    if bytes.len() > MAX_LIBRARY_CACHE_BYTES {
        return Err(LibraryCacheReadError::Discardable(
            "The saved library is unexpectedly large.".into(),
        ));
    }
    let snapshot: LibraryCacheSnapshot = serde_json::from_slice(&bytes).map_err(|_| {
        LibraryCacheReadError::Discardable("The saved library is malformed.".into())
    })?;
    validate_library_cache(&snapshot, now).map_err(LibraryCacheReadError::Discardable)?;
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
    match read_library_cache_classified(path, now) {
        Ok(snapshot) => Ok(snapshot),
        Err(LibraryCacheReadError::Discardable(error)) => match fs::remove_file(path) {
            Ok(()) => Ok(None),
            Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(remove_error) => Err(format!(
                "Could not remove an invalid saved library ({error}; {remove_error})"
            )),
        },
        Err(LibraryCacheReadError::Operational(error)) => Err(error),
    }
}
