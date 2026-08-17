use super::state_from_app;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoverCacheDiagnostics {
    entry_count: usize,
    total_bytes: u64,
    hit_count: u64,
    miss_count: u64,
    stale_count: u64,
    cleanup_pending: bool,
}

#[tauri::command]
pub(crate) async fn cover_cache_diagnostics(
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
