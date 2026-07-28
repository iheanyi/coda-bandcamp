use serde::Deserialize;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Emitter;

const MAX_SYSTEM_MEDIA_TEXT_LENGTH: usize = 512;
const MAX_SYSTEM_MEDIA_SECONDS: f64 = 7.0 * 24.0 * 60.0 * 60.0;
#[cfg(target_os = "macos")]
const MAX_SYSTEM_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
#[cfg(target_os = "macos")]
type SystemArtworkCache = std::sync::Mutex<Option<(String, Vec<u8>)>>;
#[cfg(target_os = "macos")]
static SYSTEM_MEDIA_UPDATE_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SystemMediaTrack {
    title: String,
    artist: String,
    album: String,
    album_id: Option<String>,
    cover_art_id: Option<String>,
    artwork_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SystemMediaSessionInput {
    track: Option<SystemMediaTrack>,
    playing: bool,
    position_seconds: f64,
    duration_seconds: f64,
    can_previous: bool,
    can_next: bool,
}

fn valid_text(value: &str, allow_empty: bool) -> bool {
    value.len() <= MAX_SYSTEM_MEDIA_TEXT_LENGTH
        && (allow_empty || !value.trim().is_empty())
        && !value.chars().any(char::is_control)
}

fn validate_input(input: &mut SystemMediaSessionInput) -> Result<(), String> {
    if !input.position_seconds.is_finite()
        || !input.duration_seconds.is_finite()
        || input.position_seconds < 0.0
        || input.duration_seconds < 0.0
        || input.duration_seconds > MAX_SYSTEM_MEDIA_SECONDS
        || input.position_seconds > input.duration_seconds
    {
        return Err("The system media playback position is invalid.".into());
    }
    let Some(track) = input.track.as_mut() else {
        input.playing = false;
        input.can_previous = false;
        input.can_next = false;
        return Ok(());
    };
    if !valid_text(&track.title, false)
        || !valid_text(&track.artist, false)
        || !valid_text(&track.album, true)
    {
        return Err("The system media metadata is invalid.".into());
    }
    if let Some(url) = track.artwork_url.as_deref() {
        track.artwork_url = Some(
            super::allowed_url(url, "media")
                .or_else(|| super::allowed_url(url, "bandcamp"))
                .ok_or_else(|| "The system media artwork URL is invalid.".to_string())?,
        );
    }
    if let Some(cover_art_id) = track.cover_art_id.as_deref() {
        super::validate_identifier(cover_art_id)?;
    }
    if let Some(album_id) = track.album_id.as_deref() {
        super::validate_identifier(album_id)?;
    }
    Ok(())
}

pub(crate) const fn native_supported() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
pub(crate) fn install_remote_commands(app: &tauri::AppHandle) {
    use block2::RcBlock;
    use objc2_media_player::{
        MPNowPlayingInfoCenter, MPNowPlayingPlaybackState, MPRemoteCommand, MPRemoteCommandCenter,
        MPRemoteCommandEvent, MPRemoteCommandHandlerStatus,
    };
    use std::ptr::NonNull;

    fn add_handler(command: &MPRemoteCommand, app: tauri::AppHandle, action: &'static str) {
        let handler = RcBlock::new(move |_event: NonNull<MPRemoteCommandEvent>| {
            unsafe {
                let info_center = MPNowPlayingInfoCenter::defaultCenter();
                if action == "play" {
                    info_center.setPlaybackState(MPNowPlayingPlaybackState::Playing);
                } else if action == "pause" {
                    info_center.setPlaybackState(MPNowPlayingPlaybackState::Paused);
                } else if action == "play-pause" {
                    info_center.setPlaybackState(
                        if info_center.playbackState() == MPNowPlayingPlaybackState::Playing {
                            MPNowPlayingPlaybackState::Paused
                        } else {
                            MPNowPlayingPlaybackState::Playing
                        },
                    );
                }
            }
            let _ = app.emit_to("main", "coda://tray-control", action);
            MPRemoteCommandHandlerStatus::Success
        });
        unsafe {
            let _ = command.addTargetWithHandler(&handler);
        }
    }

    unsafe {
        let center = MPRemoteCommandCenter::sharedCommandCenter();
        let play = center.playCommand();
        let pause = center.pauseCommand();
        let toggle = center.togglePlayPauseCommand();
        let previous = center.previousTrackCommand();
        let next = center.nextTrackCommand();
        for command in [&play, &pause, &toggle, &previous, &next] {
            command.removeTarget(None);
        }
        add_handler(&play, app.clone(), "play");
        add_handler(&pause, app.clone(), "pause");
        add_handler(&toggle, app.clone(), "play-pause");
        add_handler(&previous, app.clone(), "previous");
        add_handler(&next, app.clone(), "next");
        center.skipBackwardCommand().setEnabled(false);
        center.skipForwardCommand().setEnabled(false);
        center.seekBackwardCommand().setEnabled(false);
        center.seekForwardCommand().setEnabled(false);
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn install_remote_commands(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
fn clear_remote_commands() {
    use objc2_media_player::MPRemoteCommandCenter;

    unsafe {
        let center = MPRemoteCommandCenter::sharedCommandCenter();
        for command in [
            center.playCommand(),
            center.pauseCommand(),
            center.togglePlayPauseCommand(),
            center.previousTrackCommand(),
            center.nextTrackCommand(),
        ] {
            command.removeTarget(None);
            command.setEnabled(false);
        }
    }
}

#[cfg(target_os = "macos")]
async fn artwork_bytes(url: &str) -> Option<Vec<u8>> {
    use std::sync::OnceLock;

    static CACHE: OnceLock<SystemArtworkCache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| SystemArtworkCache::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((cached_url, bytes)) = guard.as_ref() {
            if cached_url == url {
                return Some(bytes.clone());
            }
        }
    }

    let response = super::http_client().ok()?.get(url).send().await.ok()?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_SYSTEM_ARTWORK_BYTES as u64)
    {
        return None;
    }
    let bytes = response.bytes().await.ok()?.to_vec();
    if bytes.is_empty() || bytes.len() > MAX_SYSTEM_ARTWORK_BYTES {
        return None;
    }
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((url.to_string(), bytes.clone()));
    }
    Some(bytes)
}

#[cfg(target_os = "macos")]
async fn resolve_artwork_bytes(
    app: &tauri::AppHandle,
    track: &SystemMediaTrack,
) -> Option<Vec<u8>> {
    if let Some(url) = track.artwork_url.as_deref() {
        if let Some(bytes) = artwork_bytes(url).await {
            return Some(bytes);
        }
    }

    let cover_art_id = if let Some(cover_art_id) = track.cover_art_id.clone() {
        cover_art_id
    } else {
        let album_id = track.album_id.clone()?;
        super::fetch_album(app.clone(), album_id, false)
            .await
            .ok()?
            .into_iter()
            .find_map(|album_track| album_track.cover_art)?
    };
    let credentials = super::load_credentials().ok()?;
    let url = super::authenticated_url(
        "getCoverArt",
        &credentials,
        &[("id", cover_art_id), ("size", "600".into())],
    )
    .ok()?;
    artwork_bytes(url.as_str()).await
}

#[cfg(target_os = "macos")]
fn media_artwork(
    bytes: Vec<u8>,
) -> Option<objc2::rc::Retained<objc2_media_player::MPMediaItemArtwork>> {
    use block2::RcBlock;
    use objc2::AnyThread;
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::CGSize;
    use objc2_foundation::NSData;
    use objc2_media_player::MPMediaItemArtwork;
    use std::ptr::NonNull;

    let data = NSData::from_vec(bytes);
    let image = NSImage::initWithData(NSImage::alloc(), &data)?;
    let bounds = image.size();
    let request_handler = RcBlock::new(move |_size: CGSize| NonNull::from(&*image));
    Some(unsafe {
        MPMediaItemArtwork::initWithBoundsSize_requestHandler(
            MPMediaItemArtwork::alloc(),
            bounds,
            &request_handler,
        )
    })
}

#[cfg(target_os = "macos")]
fn update_native_session(input: SystemMediaSessionInput, artwork: Option<Vec<u8>>) {
    use objc2::{rc::Retained, runtime::AnyObject};
    use objc2_foundation::{NSDictionary, NSNumber, NSString};
    use objc2_media_player::{
        MPMediaItemPropertyAlbumTitle, MPMediaItemPropertyArtist, MPMediaItemPropertyArtwork,
        MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle, MPNowPlayingInfoCenter,
        MPNowPlayingInfoPropertyDefaultPlaybackRate, MPNowPlayingInfoPropertyElapsedPlaybackTime,
        MPNowPlayingInfoPropertyPlaybackRate, MPNowPlayingPlaybackState, MPRemoteCommandCenter,
    };

    unsafe {
        let info_center = MPNowPlayingInfoCenter::defaultCenter();
        let command_center = MPRemoteCommandCenter::sharedCommandCenter();
        let Some(track) = input.track else {
            info_center.setNowPlayingInfo(None);
            info_center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
            command_center.previousTrackCommand().setEnabled(false);
            command_center.nextTrackCommand().setEnabled(false);
            return;
        };

        let mut keys: Vec<&NSString> = vec![
            MPMediaItemPropertyTitle,
            MPMediaItemPropertyArtist,
            MPMediaItemPropertyAlbumTitle,
            MPMediaItemPropertyPlaybackDuration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime,
            MPNowPlayingInfoPropertyPlaybackRate,
            MPNowPlayingInfoPropertyDefaultPlaybackRate,
        ];
        let mut values: Vec<Retained<AnyObject>> = vec![
            NSString::from_str(&track.title).into(),
            NSString::from_str(&track.artist).into(),
            NSString::from_str(&track.album).into(),
            NSNumber::new_f64(input.duration_seconds).into(),
            NSNumber::new_f64(input.position_seconds).into(),
            NSNumber::new_f64(if input.playing { 1.0 } else { 0.0 }).into(),
            NSNumber::new_f64(1.0).into(),
        ];
        if let Some(artwork) = artwork.and_then(media_artwork) {
            keys.push(MPMediaItemPropertyArtwork);
            values.push(artwork.into());
        }
        let now_playing_info =
            NSDictionary::<NSString, AnyObject>::from_retained_objects(&keys, &values);
        info_center.setNowPlayingInfo(Some(&now_playing_info));
        info_center.setPlaybackState(if input.playing {
            MPNowPlayingPlaybackState::Playing
        } else {
            MPNowPlayingPlaybackState::Paused
        });
        command_center
            .previousTrackCommand()
            .setEnabled(input.can_previous);
        command_center.nextTrackCommand().setEnabled(input.can_next);
    }
}

pub(crate) async fn update_session(
    app: tauri::AppHandle,
    mut input: SystemMediaSessionInput,
) -> Result<(), String> {
    validate_input(&mut input)?;
    #[cfg(target_os = "macos")]
    {
        let update_generation = SYSTEM_MEDIA_UPDATE_GENERATION
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        let artwork_track = input.track.clone();
        let main_thread_app = app.clone();
        let initial_input = input.clone();
        app.run_on_main_thread(move || {
            if SYSTEM_MEDIA_UPDATE_GENERATION.load(Ordering::Acquire) != update_generation {
                return;
            }
            if initial_input.track.is_some() {
                install_remote_commands(&main_thread_app);
            } else {
                clear_remote_commands();
            }
            update_native_session(initial_input, None);
        })
        .map_err(|error| format!("Could not update macOS media controls: {error}"))?;
        let artwork = match artwork_track.as_ref() {
            Some(track) => resolve_artwork_bytes(&app, track).await,
            None => None,
        };
        if SYSTEM_MEDIA_UPDATE_GENERATION.load(Ordering::Acquire) != update_generation {
            return Ok(());
        }
        if let Some(artwork) = artwork {
            let artwork_app = app.clone();
            app.run_on_main_thread(move || {
                if SYSTEM_MEDIA_UPDATE_GENERATION.load(Ordering::Acquire) != update_generation {
                    return;
                }
                install_remote_commands(&artwork_app);
                update_native_session(input, Some(artwork));
            })
            .map_err(|error| format!("Could not update macOS media artwork: {error}"))?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = input;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> SystemMediaSessionInput {
        SystemMediaSessionInput {
            track: Some(SystemMediaTrack {
                title: "First Light".into(),
                artist: "Night Archive".into(),
                album: "Soft Focus".into(),
                album_id: Some("album-1".into()),
                cover_art_id: Some("ca:496796527".into()),
                artwork_url: Some("https://t4.bcbits.com/img/cover.jpg".into()),
            }),
            playing: true,
            position_seconds: 42.0,
            duration_seconds: 180.0,
            can_previous: true,
            can_next: true,
        }
    }

    #[test]
    fn validates_bounded_system_media_metadata() {
        assert!(validate_input(&mut sample_input()).is_ok());

        let mut invalid_artwork = sample_input();
        invalid_artwork.track.as_mut().unwrap().artwork_url =
            Some("https://example.com/cover.jpg".into());
        assert!(validate_input(&mut invalid_artwork).is_err());

        let mut invalid_position = sample_input();
        invalid_position.position_seconds = 181.0;
        assert!(validate_input(&mut invalid_position).is_err());

        let mut invalid_album = sample_input();
        invalid_album.track.as_mut().unwrap().album_id = Some("bad\nalbum".into());
        assert!(validate_input(&mut invalid_album).is_err());
    }
}
