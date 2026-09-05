use super::{ensure_authorized, state_from_app, CoverCacheInner, CoverCacheRuntime};
use crate::storage::{timestamp_ms, write_bytes_atomically};
use crate::subsonic::validate_identifier;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub(crate) const COVER_CACHE_VERSION: u8 = 1;
pub(crate) const COVER_CACHE_DIRECTORY: &str = "cover-art-v1";
pub(crate) const COVER_CACHE_INDEX_FILE: &str = "index.json";
pub(crate) const COVER_CACHE_INVALIDATION_FILE: &str = "cover-art-v1.invalid";
pub(crate) const MAX_COVER_CACHE_INDEX_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_COVER_CACHE_ENTRIES: usize = 5_000;
pub(crate) const MAX_COVER_CACHE_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_COVER_ART_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const COVER_ART_FRESH_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub(crate) const MAX_COVER_DIMENSION: u32 = 4_096;
pub(crate) const MAX_COVER_PIXELS: u64 = 16_777_216;
const MAX_REVISION_LENGTH: usize = 128;
const ACCESS_FLUSH_INTERVAL: Duration = Duration::from_secs(30);
const ACCESS_FLUSH_TOUCHES: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CoverCacheEntry {
    pub(crate) key: String,
    pub(crate) revision: String,
    pub(crate) media_type: String,
    pub(crate) extension: String,
    pub(crate) byte_length: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) validated_at: u64,
    pub(crate) last_access_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CoverCacheIndex {
    pub(crate) version: u8,
    pub(crate) entries: BTreeMap<String, CoverCacheEntry>,
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
pub(crate) enum CoverCacheReset {
    Cleared,
    Invalidated,
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

pub(crate) fn initialize_cache_index(
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

pub(crate) fn cover_cache_key(cover_art_id: &str) -> Result<String, String> {
    validate_identifier(cover_art_id)?;
    let mut digest = Sha256::new();
    digest.update(b"v1/getCoverArt/600/");
    digest.update(cover_art_id.as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}

pub(crate) fn content_revision(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn valid_revision(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REVISION_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub(crate) fn entry_file_name(entry: &CoverCacheEntry) -> String {
    format!("{}-{}.{}", entry.key, entry.revision, entry.extension)
}

pub(crate) fn entry_path(cache_directory: &Path, entry: &CoverCacheEntry) -> PathBuf {
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

pub(crate) fn validate_index(index: &CoverCacheIndex) -> Result<(), String> {
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

pub(crate) fn serialize_index(index: &CoverCacheIndex) -> Result<Vec<u8>, String> {
    validate_index(index)?;
    let bytes = serde_json::to_vec(index)
        .map_err(|_| "Could not prepare the cover artwork index.".to_string())?;
    if bytes.len() > MAX_COVER_CACHE_INDEX_BYTES {
        return Err("The cover artwork index is unexpectedly large.".into());
    }
    Ok(bytes)
}

pub(crate) fn write_index(path: &Path, index: &CoverCacheIndex) -> Result<(), String> {
    write_bytes_atomically(path, &serialize_index(index)?, "cover artwork index")
}

pub(crate) fn read_index(path: &Path) -> Result<Option<CoverCacheIndex>, String> {
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

pub(crate) fn remove_file_if_exists(path: &Path) -> Result<(), String> {
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

pub(crate) fn load_and_repair_index(
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

pub(crate) fn retry_cleanup_if_needed(state: &CoverCacheInner) -> Result<(), String> {
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

pub(crate) fn cached_entry(
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

pub(crate) fn entry_is_stale(entry: &CoverCacheEntry, now: u64) -> bool {
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

pub(crate) fn read_cached_bytes(
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

pub(crate) async fn record_access(state: Arc<CoverCacheInner>, key: &str) {
    if !matches!(touch_entry(&state, key), Ok(true)) {
        return;
    }
    let _ = tauri::async_runtime::spawn_blocking(move || flush_accesses(&state)).await;
}

pub(crate) fn start_access_flush_worker(app: AppHandle, state: Arc<CoverCacheInner>) {
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

pub(crate) fn flush_cover_art_accesses(app: &AppHandle) -> Result<(), String> {
    let state = state_from_app(app)?;
    flush_accesses(&state)
}

pub(crate) fn select_evictions(
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
    if count <= MAX_COVER_CACHE_ENTRIES && bytes <= MAX_COVER_CACHE_BYTES {
        return Some(Vec::new());
    }
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

pub(crate) fn remove_indexed_entry(
    state: &CoverCacheInner,
    runtime: &mut CoverCacheRuntime,
    key: &str,
) -> Result<(), String> {
    let Some(entry) = runtime.index.entries.remove(key) else {
        return Ok(());
    };
    if let Err(error) = write_index(&state.index_path, &runtime.index) {
        runtime.index.entries.insert(key.to_string(), entry);
        return Err(error);
    }
    if let Err(error) = remove_file_if_exists(&entry_path(&state.cache_directory, &entry)) {
        eprintln!("Could not finish removing invalidated cover artwork: {error}");
    }
    Ok(())
}

pub(crate) fn reset_cover_art_cache(app: &AppHandle) -> Result<CoverCacheReset, String> {
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
