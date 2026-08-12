use crate::models::{
    LastFmPlaybackProgress, PlayerStateCheckpoint, PlayerStateSnapshot, RadioScrobbleProgress,
};
use crate::storage::{run_blocking, timestamp_ms, write_bytes_atomically};
use crate::validation::{MAX_MEDIA_SECONDS, MAX_RADIO_CHAPTERS, MAX_TRACK_NUMBER};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub(super) const PLAYER_STATE_VERSION: u8 = 1;
pub(super) const PLAYER_STATE_CONTRACT_VERSION: u8 = 2;
pub(super) const PLAYER_STATE_FILE: &str = "player-state.json";
const PLAYER_CHECKPOINT_FILE: &str = "player-state-checkpoint.json";
const PLAYER_DIAGNOSTIC_FILE: &str = "player-state-diagnostic.log";
const MAX_PLAYER_DIAGNOSTIC_BYTES: u64 = 64 * 1024;
const MAX_PLAYER_STATE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PLAYER_CHECKPOINT_BYTES: usize = 16 * 1024;
pub(super) const MAX_PLAYER_QUEUE_LENGTH: usize = 25_000;
const MAX_PLAYER_TEXT_LENGTH: usize = 1_024;
const MAX_PLAYER_TIMESTAMP_MS: u64 = 8_640_000_000_000_000;
const MAX_RADIO_CHAPTER_KEY_LENGTH: usize = 128;

static PLAYER_STATE_LOCK: Mutex<()> = Mutex::new(());

enum PersistedPlayerReadError {
    Discardable(String),
    Operational(String),
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PlayerStateWriteOutcome {
    CheckpointCleared,
    CheckpointRetained(String),
}

impl PersistedPlayerReadError {
    #[cfg(test)]
    fn into_message(self) -> String {
        match self {
            Self::Discardable(message) | Self::Operational(message) => message,
        }
    }
}

pub(super) fn player_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(PLAYER_STATE_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

pub(super) fn player_checkpoint_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(PLAYER_CHECKPOINT_FILE))
        .map_err(|error| format!("Could not locate Coda's application data directory: {error}"))
}

pub(super) fn player_state_track_kind(id: Option<&str>) -> &'static str {
    match id {
        Some(value) if value.starts_with("radio:") => "radio",
        Some(_) => "library",
        None => "none",
    }
}

pub(super) fn player_state_error_kind(error: &str) -> &'static str {
    if error.contains("lock") {
        "lock"
    } else if error.contains("malformed") {
        "malformed"
    } else if error.contains("invalid")
        || error.contains("belongs")
        || error.contains("conflicting")
    {
        "validation"
    } else if error.contains("open") {
        "open"
    } else if error.contains("read") || error.contains("inspect") {
        "read"
    } else if error.contains("write") || error.contains("replace") || error.contains("finalize") {
        "write"
    } else {
        "other"
    }
}

pub(super) fn append_player_state_diagnostic(
    app: &tauri::AppHandle,
    event: &str,
    queue_len: Option<usize>,
    current_index: Option<usize>,
    track_kind: &'static str,
    position_seconds: Option<f64>,
) {
    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join(PLAYER_DIAGNOSTIC_FILE);
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() >= MAX_PLAYER_DIAGNOSTIC_BYTES)
    {
        let _ = fs::remove_file(&path);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let queue = queue_len
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".into());
    let index = current_index
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".into());
    let position = position_seconds
        .filter(|value| value.is_finite())
        .map(|value| format!("{value:.3}"))
        .unwrap_or_else(|| "-".into());
    let line = format!(
        "{timestamp} event={event} queue={queue} index={index} kind={track_kind} position={position}\n"
    );
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub(super) fn append_player_state_snapshot_diagnostic(
    app: &tauri::AppHandle,
    event: &str,
    state: &PlayerStateSnapshot,
) {
    let current = state.queue.get(state.current_index);
    append_player_state_diagnostic(
        app,
        event,
        Some(state.queue.len()),
        Some(state.current_index),
        player_state_track_kind(current.map(|track| track.id.as_str())),
        Some(state.position_seconds),
    );
}

pub(super) fn valid_player_text(value: &str, required: bool) -> bool {
    value.len() <= MAX_PLAYER_TEXT_LENGTH
        && !value.chars().any(char::is_control)
        && (!required || !value.trim().is_empty())
}

pub(super) fn valid_player_seconds(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_MEDIA_SECONDS).contains(&value)
}

pub(super) fn valid_radio_track_id(value: &str) -> bool {
    let Some(show_id) = value.strip_prefix("radio:") else {
        return true;
    };
    !show_id.is_empty()
        && show_id.len() <= 16
        && !show_id.starts_with('0')
        && show_id.chars().all(|character| character.is_ascii_digit())
}

pub(super) fn validate_lastfm_progress(progress: &LastFmPlaybackProgress) -> Result<(), String> {
    if !valid_player_text(&progress.track_id, true)
        || !valid_player_seconds(progress.listened_seconds)
        || !valid_player_seconds(progress.last_position)
        || progress.started_at > MAX_PLAYER_TIMESTAMP_MS / 1_000
        || !matches!(
            progress.scrobble_state.as_str(),
            "idle" | "pending" | "sent" | "failed"
        )
    {
        return Err("The saved Last.fm playback progress is invalid.".into());
    }
    Ok(())
}

pub(super) fn validate_radio_scrobble_progress(
    progress: &RadioScrobbleProgress,
) -> Result<(), String> {
    if !progress.show_track_id.starts_with("radio:")
        || !valid_radio_track_id(&progress.show_track_id)
        || progress.active_chapter_key.as_deref().is_some_and(|value| {
            value.is_empty()
                || value.len() > MAX_RADIO_CHAPTER_KEY_LENGTH
                || value.chars().any(char::is_control)
        })
        || progress.chapter_started_at > MAX_PLAYER_TIMESTAMP_MS / 1_000
        || !valid_player_seconds(progress.chapter_listened_seconds)
        || !valid_player_seconds(progress.last_position)
        || !matches!(
            progress.chapter_scrobble_state.as_str(),
            "idle" | "pending" | "sent" | "failed"
        )
        || progress.show_started_at > MAX_PLAYER_TIMESTAMP_MS / 1_000
        || !valid_player_seconds(progress.show_listened_seconds)
        || !matches!(
            progress.show_scrobble_state.as_str(),
            "idle" | "pending" | "sent" | "failed"
        )
        || progress.scrobbled_chapter_keys.len() > MAX_RADIO_CHAPTERS
        || progress.scrobbled_chapter_keys.iter().any(|value| {
            value.is_empty()
                || value.len() > MAX_RADIO_CHAPTER_KEY_LENGTH
                || value.chars().any(char::is_control)
        })
    {
        return Err("The saved Radio scrobble progress is invalid.".into());
    }
    Ok(())
}

pub(super) fn validate_player_state(state: &PlayerStateSnapshot) -> Result<(), String> {
    if state.version != PLAYER_STATE_VERSION {
        return Err("The saved player state uses an unsupported version.".into());
    }
    if state.saved_at > MAX_PLAYER_TIMESTAMP_MS {
        return Err("The saved player timestamp is invalid.".into());
    }
    if state.queue.len() > MAX_PLAYER_QUEUE_LENGTH {
        return Err("The saved queue is too large.".into());
    }
    for track in &state.queue {
        if !valid_player_text(&track.id, true)
            || track.id.starts_with("discover:")
            || !valid_radio_track_id(&track.id)
            || !valid_player_text(&track.title, true)
            || !valid_player_text(&track.artist, true)
            || !valid_player_text(&track.album, false)
            || !valid_player_text(&track.album_id, true)
            || track.duration as f64 > MAX_MEDIA_SECONDS
            || track.track > MAX_TRACK_NUMBER
            || track.disc.is_some_and(|disc| disc > MAX_TRACK_NUMBER)
            || track
                .cover_art
                .as_deref()
                .is_some_and(|value| !valid_player_text(value, false))
            || track.palette.iter().any(|color| {
                color.is_empty() || color.len() > 64 || color.chars().any(char::is_control)
            })
        {
            return Err("The saved queue contains invalid track metadata.".into());
        }
    }
    if !valid_player_seconds(state.position_seconds)
        || !state.volume.is_finite()
        || !(0.0..=1.0).contains(&state.volume)
        || !matches!(state.repeat_mode.as_str(), "off" | "all" | "one")
    {
        return Err("The saved playback settings are invalid.".into());
    }
    if state.queue.is_empty() {
        if state.current_index != 0
            || state.position_seconds != 0.0
            || state.last_fm_progress.is_some()
            || state.radio_scrobble_progress.is_some()
        {
            return Err("The saved empty queue has an invalid playback position.".into());
        }
    } else if state.current_index >= state.queue.len() {
        return Err("The saved current track is outside the queue.".into());
    }
    if let Some(progress) = &state.last_fm_progress {
        validate_lastfm_progress(progress)?;
        if state.queue[state.current_index].id.starts_with("radio:")
            || state.queue[state.current_index].id != progress.track_id
        {
            return Err("The saved Last.fm progress belongs to another track.".into());
        }
    }
    if let Some(progress) = &state.radio_scrobble_progress {
        validate_radio_scrobble_progress(progress)?;
        if !state.queue[state.current_index].id.starts_with("radio:")
            || state.queue[state.current_index].id != progress.show_track_id
        {
            return Err("The saved Radio progress belongs to another show.".into());
        }
    }
    if state.last_fm_progress.is_some() && state.radio_scrobble_progress.is_some() {
        return Err("The saved player state has conflicting scrobble progress.".into());
    }
    Ok(())
}

pub(super) fn validate_player_checkpoint(checkpoint: &PlayerStateCheckpoint) -> Result<(), String> {
    if !valid_player_text(&checkpoint.current_track_id, true)
        || checkpoint.current_track_id.starts_with("discover:")
        || !valid_radio_track_id(&checkpoint.current_track_id)
        || !valid_player_seconds(checkpoint.position_seconds)
    {
        return Err("The player checkpoint is invalid.".into());
    }
    if let Some(progress) = &checkpoint.last_fm_progress {
        validate_lastfm_progress(progress)?;
        if checkpoint.current_track_id.starts_with("radio:")
            || progress.track_id != checkpoint.current_track_id
        {
            return Err("The Last.fm checkpoint belongs to another track.".into());
        }
    }
    if let Some(progress) = &checkpoint.radio_scrobble_progress {
        validate_radio_scrobble_progress(progress)?;
        if !checkpoint.current_track_id.starts_with("radio:")
            || progress.show_track_id != checkpoint.current_track_id
        {
            return Err("The Radio checkpoint belongs to another show.".into());
        }
    }
    if checkpoint.last_fm_progress.is_some() && checkpoint.radio_scrobble_progress.is_some() {
        return Err("The player checkpoint has conflicting scrobble progress.".into());
    }
    Ok(())
}

pub(super) fn normalize_restored_radio_scrobble_progress(progress: &mut RadioScrobbleProgress) {
    progress.chapter_started_at = 0;
    progress.chapter_now_playing_sent = false;
    if progress.chapter_scrobble_state == "pending" {
        if let Some(key) = &progress.active_chapter_key {
            if !progress.scrobbled_chapter_keys.contains(key) {
                progress.scrobbled_chapter_keys.push(key.clone());
            }
        }
        progress.chapter_scrobble_state = "sent".into();
    }
    if progress.scrobbled_chapter_keys.len() > MAX_RADIO_CHAPTERS {
        let excess = progress.scrobbled_chapter_keys.len() - MAX_RADIO_CHAPTERS;
        progress.scrobbled_chapter_keys.drain(..excess);
    }
    progress.show_started_at = 0;
    if progress.show_scrobble_state == "pending" {
        progress.show_scrobble_state = "sent".into();
    }
}

pub(super) fn normalize_restored_player_progress(state: &mut PlayerStateSnapshot) {
    if let Some(progress) = &mut state.last_fm_progress {
        progress.started_at = 0;
        progress.now_playing_sent = false;
        if progress.scrobble_state == "pending" {
            progress.scrobble_state = "sent".into();
        }
    }
    if let Some(progress) = &mut state.radio_scrobble_progress {
        normalize_restored_radio_scrobble_progress(progress);
    }
}

pub(super) fn apply_player_checkpoint(
    state: &mut PlayerStateSnapshot,
    checkpoint: PlayerStateCheckpoint,
) -> bool {
    if checkpoint.persistence_generation != state.persistence_generation
        || checkpoint.current_index >= state.queue.len()
        || state.queue[checkpoint.current_index].id != checkpoint.current_track_id
    {
        return false;
    }
    state.current_index = checkpoint.current_index;
    state.position_seconds = checkpoint.position_seconds;
    state.last_fm_progress = checkpoint.last_fm_progress;
    state.radio_scrobble_progress = checkpoint.radio_scrobble_progress;
    true
}

#[cfg(test)]
pub(super) fn read_player_state(path: &Path) -> Result<Option<PlayerStateSnapshot>, String> {
    read_player_state_classified(path).map_err(PersistedPlayerReadError::into_message)
}

fn read_player_state_classified(
    path: &Path,
) -> Result<Option<PlayerStateSnapshot>, PersistedPlayerReadError> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(PersistedPlayerReadError::Operational(format!(
                "Could not open the saved player state: {error}"
            )))
        }
    };
    if file
        .metadata()
        .map_err(|error| {
            PersistedPlayerReadError::Operational(format!(
                "Could not inspect the saved player state: {error}"
            ))
        })?
        .len()
        > MAX_PLAYER_STATE_BYTES as u64
    {
        return Err(PersistedPlayerReadError::Discardable(
            "The saved player state is unexpectedly large.".into(),
        ));
    }
    let mut bytes = Vec::new();
    file.take((MAX_PLAYER_STATE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            PersistedPlayerReadError::Operational(format!(
                "Could not read the saved player state: {error}"
            ))
        })?;
    if bytes.len() > MAX_PLAYER_STATE_BYTES {
        return Err(PersistedPlayerReadError::Discardable(
            "The saved player state is unexpectedly large.".into(),
        ));
    }
    let state: PlayerStateSnapshot = serde_json::from_slice(&bytes).map_err(|_| {
        PersistedPlayerReadError::Discardable("The saved player state is malformed.".into())
    })?;
    validate_player_state(&state).map_err(PersistedPlayerReadError::Discardable)?;
    Ok(Some(state))
}

pub(super) fn write_player_state(path: &Path, state: &PlayerStateSnapshot) -> Result<(), String> {
    validate_player_state(state)?;
    let serialized = serde_json::to_vec(state)
        .map_err(|error| format!("Could not prepare the player state: {error}"))?;
    if serialized.len() > MAX_PLAYER_STATE_BYTES {
        return Err("The saved player state is unexpectedly large.".into());
    }
    write_bytes_atomically(path, &serialized, "player state")
}

fn write_player_state_without_stale_checkpoint(
    state_path: &Path,
    checkpoint_path: &Path,
    state: &PlayerStateSnapshot,
) -> Result<PlayerStateWriteOutcome, String> {
    write_player_state(state_path, state)?;
    match fs::remove_file(checkpoint_path) {
        Ok(()) => Ok(PlayerStateWriteOutcome::CheckpointCleared),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PlayerStateWriteOutcome::CheckpointCleared)
        }
        Err(error) => Ok(PlayerStateWriteOutcome::CheckpointRetained(format!(
            "Could not clear the prior player checkpoint: {error}"
        ))),
    }
}

#[cfg(test)]
pub(super) fn write_player_state_without_stale_checkpoint_for_test(
    state_path: &Path,
    checkpoint_path: &Path,
    state: &PlayerStateSnapshot,
) -> Result<bool, String> {
    write_player_state_without_stale_checkpoint(state_path, checkpoint_path, state)
        .map(|outcome| matches!(outcome, PlayerStateWriteOutcome::CheckpointRetained(_)))
}

pub(super) fn next_player_persistence_generation(state_path: &Path) -> Result<u64, String> {
    let prior_generation = load_player_state_or_clear_invalid(state_path)?
        .map_or(0, |persisted| persisted.persistence_generation);
    prior_generation
        .checked_add(1)
        .ok_or_else(|| "The player persistence generation is exhausted.".to_string())
}

fn read_player_checkpoint_classified(
    path: &Path,
) -> Result<Option<PlayerStateCheckpoint>, PersistedPlayerReadError> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(PersistedPlayerReadError::Operational(format!(
                "Could not open the player checkpoint: {error}"
            )))
        }
    };
    if file
        .metadata()
        .map_err(|error| {
            PersistedPlayerReadError::Operational(format!(
                "Could not inspect the player checkpoint: {error}"
            ))
        })?
        .len()
        > MAX_PLAYER_CHECKPOINT_BYTES as u64
    {
        return Err(PersistedPlayerReadError::Discardable(
            "The player checkpoint is unexpectedly large.".into(),
        ));
    }
    let mut bytes = Vec::new();
    file.take((MAX_PLAYER_CHECKPOINT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            PersistedPlayerReadError::Operational(format!(
                "Could not read the player checkpoint: {error}"
            ))
        })?;
    if bytes.len() > MAX_PLAYER_CHECKPOINT_BYTES {
        return Err(PersistedPlayerReadError::Discardable(
            "The player checkpoint is unexpectedly large.".into(),
        ));
    }
    let checkpoint: PlayerStateCheckpoint = serde_json::from_slice(&bytes).map_err(|_| {
        PersistedPlayerReadError::Discardable("The player checkpoint is malformed.".into())
    })?;
    validate_player_checkpoint(&checkpoint).map_err(PersistedPlayerReadError::Discardable)?;
    Ok(Some(checkpoint))
}

pub(super) fn write_player_checkpoint(
    path: &Path,
    checkpoint: &PlayerStateCheckpoint,
) -> Result<(), String> {
    validate_player_checkpoint(checkpoint)?;
    let serialized = serde_json::to_vec(checkpoint)
        .map_err(|error| format!("Could not prepare the player checkpoint: {error}"))?;
    if serialized.len() > MAX_PLAYER_CHECKPOINT_BYTES {
        return Err("The player checkpoint is unexpectedly large.".into());
    }
    write_bytes_atomically(path, &serialized, "player checkpoint")
}

pub(super) fn load_player_state_or_clear_invalid(
    path: &Path,
) -> Result<Option<PlayerStateSnapshot>, String> {
    match read_player_state_classified(path) {
        Ok(state) => Ok(state),
        Err(PersistedPlayerReadError::Discardable(error)) => {
            fs::remove_file(path)
                .or_else(|remove_error| {
                    if remove_error.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(remove_error)
                    }
                })
                .map_err(|remove_error| {
                    format!("{error} Coda could not discard that state: {remove_error}")
                })?;
            Ok(None)
        }
        Err(PersistedPlayerReadError::Operational(error)) => Err(error),
    }
}

#[tauri::command]
pub(super) async fn player_state_contract_version() -> u8 {
    PLAYER_STATE_CONTRACT_VERSION
}

#[tauri::command]
pub(super) async fn record_player_state_diagnostic(
    app: tauri::AppHandle,
    event: String,
) -> Result<(), String> {
    if !matches!(
        event.as_str(),
        "renderer.load.ok"
            | "renderer.load.none"
            | "renderer.load.invalid"
            | "renderer.load.native-error"
            | "renderer.play.request"
            | "renderer.stream.request"
            | "renderer.stream.ready"
            | "renderer.stream.error"
            | "renderer.audio.play-request"
            | "renderer.audio.play-ready"
            | "renderer.audio.play-error"
            | "renderer.audio.media-error"
    ) {
        return Err("The player-state diagnostic event is invalid.".into());
    }
    run_blocking(
        "Could not finish writing the player diagnostic",
        move || {
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
            Ok(())
        },
    )
    .await
}

#[tauri::command]
pub(super) async fn load_player_state(
    app: tauri::AppHandle,
) -> Result<Option<PlayerStateSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result: Result<Option<PlayerStateSnapshot>, String> = (|| {
            let _guard = PLAYER_STATE_LOCK
                .lock()
                .map_err(|_| "The player state lock is unavailable.".to_string())?;
            let state_path = player_state_path(&app)?;
            let state_existed = state_path.exists();
            let checkpoint_path = player_checkpoint_path(&app)?;
            let Some(mut state) = load_player_state_or_clear_invalid(&state_path)? else {
                let _ = fs::remove_file(checkpoint_path);
                append_player_state_diagnostic(
                    &app,
                    if state_existed {
                        "native.load.cleared-invalid"
                    } else {
                        "native.load.none"
                    },
                    Some(0),
                    Some(0),
                    "none",
                    Some(0.0),
                );
                return Ok(None);
            };

            match read_player_checkpoint_classified(&checkpoint_path) {
                Ok(Some(checkpoint)) => {
                    if !apply_player_checkpoint(&mut state, checkpoint) {
                        let _ = fs::remove_file(&checkpoint_path);
                        append_player_state_diagnostic(
                            &app,
                            "native.load.dropped-stale-checkpoint",
                            Some(state.queue.len()),
                            Some(state.current_index),
                            player_state_track_kind(
                                state
                                    .queue
                                    .get(state.current_index)
                                    .map(|track| track.id.as_str()),
                            ),
                            Some(state.position_seconds),
                        );
                    }
                }
                Ok(None) => {}
                Err(PersistedPlayerReadError::Discardable(_)) => {
                    let _ = fs::remove_file(&checkpoint_path);
                    append_player_state_snapshot_diagnostic(
                        &app,
                        "native.load.dropped-invalid-checkpoint",
                        &state,
                    );
                }
                Err(PersistedPlayerReadError::Operational(error)) => return Err(error),
            }
            normalize_restored_player_progress(&mut state);
            validate_player_state(&state)?;
            append_player_state_snapshot_diagnostic(&app, "native.load.ok", &state);
            Ok(Some(state))
        })();
        if let Err(error) = &result {
            let event = format!("native.load.error.{}", player_state_error_kind(error));
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
        }
        result
    })
    .await
    .map_err(|error| format!("Could not load the player state: {error}"))?
}

#[tauri::command]
pub(super) async fn save_player_state(
    app: tauri::AppHandle,
    mut state: PlayerStateSnapshot,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result: Result<(), String> = (|| {
            let _guard = PLAYER_STATE_LOCK
                .lock()
                .map_err(|_| "The player state lock is unavailable.".to_string())?;
            state.saved_at = timestamp_ms()?;
            normalize_restored_player_progress(&mut state);
            validate_player_state(&state)?;
            let state_path = player_state_path(&app)?;
            let checkpoint_path = player_checkpoint_path(&app)?;
            state.persistence_generation = next_player_persistence_generation(&state_path)?;
            let outcome =
                write_player_state_without_stale_checkpoint(&state_path, &checkpoint_path, &state)?;
            if let PlayerStateWriteOutcome::CheckpointRetained(error) = outcome {
                append_player_state_snapshot_diagnostic(
                    &app,
                    "native.save.retained-stale-checkpoint",
                    &state,
                );
                eprintln!("{error}");
            }
            append_player_state_snapshot_diagnostic(&app, "native.save.ok", &state);
            Ok(())
        })();
        if let Err(error) = &result {
            let event = format!("native.save.error.{}", player_state_error_kind(error));
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
        }
        result
    })
    .await
    .map_err(|error| format!("Could not save the player state: {error}"))?
}

#[tauri::command]
pub(super) async fn checkpoint_player_state(
    app: tauri::AppHandle,
    mut checkpoint: PlayerStateCheckpoint,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result: Result<bool, String> = (|| {
            let _guard = PLAYER_STATE_LOCK
                .lock()
                .map_err(|_| "The player state lock is unavailable.".to_string())?;
            validate_player_checkpoint(&checkpoint)?;
            let state_path = player_state_path(&app)?;
            let Some(state) = load_player_state_or_clear_invalid(&state_path)? else {
                append_player_state_diagnostic(
                    &app,
                    "native.checkpoint.skipped-no-state",
                    None,
                    Some(checkpoint.current_index),
                    player_state_track_kind(Some(&checkpoint.current_track_id)),
                    Some(checkpoint.position_seconds),
                );
                return Ok(false);
            };
            if checkpoint.current_index >= state.queue.len()
                || state.queue[checkpoint.current_index].id != checkpoint.current_track_id
            {
                append_player_state_diagnostic(
                    &app,
                    "native.checkpoint.skipped-mismatch",
                    Some(state.queue.len()),
                    Some(checkpoint.current_index),
                    player_state_track_kind(Some(&checkpoint.current_track_id)),
                    Some(checkpoint.position_seconds),
                );
                return Ok(false);
            }
            checkpoint.persistence_generation = state.persistence_generation;
            if let Some(progress) = &mut checkpoint.last_fm_progress {
                progress.started_at = 0;
                progress.now_playing_sent = false;
                if progress.scrobble_state == "pending" {
                    progress.scrobble_state = "sent".into();
                }
            }
            if let Some(progress) = &mut checkpoint.radio_scrobble_progress {
                normalize_restored_radio_scrobble_progress(progress);
            }
            let checkpoint_path = player_checkpoint_path(&app)?;
            write_player_checkpoint(&checkpoint_path, &checkpoint)?;
            append_player_state_diagnostic(
                &app,
                "native.checkpoint.ok",
                Some(state.queue.len()),
                Some(checkpoint.current_index),
                player_state_track_kind(Some(&checkpoint.current_track_id)),
                Some(checkpoint.position_seconds),
            );
            Ok(true)
        })();
        if let Err(error) = &result {
            let event = format!("native.checkpoint.error.{}", player_state_error_kind(error));
            append_player_state_diagnostic(&app, &event, None, None, "none", None);
        }
        result
    })
    .await
    .map_err(|error| format!("Could not checkpoint the player state: {error}"))?
}

#[tauri::command]
pub(super) async fn clear_player_state(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = PLAYER_STATE_LOCK
            .lock()
            .map_err(|_| "The player state lock is unavailable.".to_string())?;
        for path in [player_state_path(&app)?, player_checkpoint_path(&app)?] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("Could not clear the saved player state: {error}"))
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Could not clear the player state: {error}"))?
}
