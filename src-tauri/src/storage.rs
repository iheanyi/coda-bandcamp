use rand::{distributions::Alphanumeric, Rng};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const FALLBACK_TEMP_FILE_NAME: &str = "coda-state.json";

#[cfg(not(target_os = "windows"))]
fn sync_parent_directory(directory: &Path, label: &str) -> Result<(), String> {
    fs::File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Could not finalize the {label}: {error}"))
}

#[cfg(target_os = "windows")]
fn sync_parent_directory(_directory: &Path, _label: &str) -> Result<(), String> {
    // Windows rename/replace below requests write-through explicitly.
    Ok(())
}

#[cfg(target_os = "windows")]
fn rename_file_atomically(temporary: &Path, path: &Path, label: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let existing = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: Both UTF-16 buffers are NUL-terminated and remain alive for the
    // duration of the call.
    unsafe {
        MoveFileExW(
            PCWSTR(existing.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| format!("Could not finalize the {label}: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn rename_file_atomically(temporary: &Path, path: &Path, label: &str) -> Result<(), String> {
    fs::rename(temporary, path)
        .map_err(|error| format!("Could not finalize the {label}: {error}"))?;
    sync_parent_directory(
        path.parent()
            .ok_or_else(|| format!("The {label} path is invalid."))?,
        label,
    )
}

#[cfg(target_os = "windows")]
fn replace_existing_file(
    temporary: &Path,
    path: &Path,
    label: &str,
    first_error: std::io::Error,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let replaced = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replacement = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: Both UTF-16 buffers are NUL-terminated and remain alive for the
    // duration of the call. No optional backup/exclusion buffers are supplied.
    unsafe {
        ReplaceFileW(
            PCWSTR(replaced.as_ptr()),
            PCWSTR(replacement.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_WRITE_THROUGH,
            None,
            None,
        )
    }
    .map_err(|error| format!("Could not atomically replace the {label} ({first_error}; {error})"))
}

#[cfg(not(target_os = "windows"))]
fn replace_existing_file(
    _temporary: &Path,
    _path: &Path,
    label: &str,
    first_error: std::io::Error,
) -> Result<(), String> {
    Err(format!(
        "Could not atomically replace the {label}: {first_error}"
    ))
}

pub(crate) async fn run_blocking<T, F>(context: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{context}: {error}"))?
}

pub(crate) fn timestamp_ms() -> Result<u64, String> {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is invalid.".to_string())?
        .as_millis();
    u64::try_from(milliseconds).map_err(|_| "The system clock is invalid.".to_string())
}

pub(crate) fn write_bytes_atomically(
    path: &Path,
    serialized: &[u8],
    label: &str,
) -> Result<(), String> {
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
        .unwrap_or(FALLBACK_TEMP_FILE_NAME);
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

        rename_file_atomically(&temporary, path, label).or_else(|first_error| {
            if path.exists() {
                replace_existing_file(&temporary, path, label, std::io::Error::other(first_error))?;
                sync_parent_directory(directory, label)
            } else {
                Err(first_error)
            }
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
