use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Deserialize;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Emitter;

const MAX_SYSTEM_MEDIA_TEXT_LENGTH: usize = 512;
const MAX_SYSTEM_MEDIA_SECONDS: f64 = 7.0 * 24.0 * 60.0 * 60.0;
const MAX_SYSTEM_FALLBACK_ARTWORK_DATA_URL_LENGTH: usize = 1024 * 1024;
const MAX_SYSTEM_FALLBACK_ARTWORK_BYTES: usize = 768 * 1024;
const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
#[cfg(target_os = "macos")]
const MAX_SYSTEM_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
#[cfg(target_os = "macos")]
#[derive(Default)]
struct SystemArtworkCache(std::sync::Mutex<Option<(String, Vec<u8>)>>);
#[cfg(target_os = "macos")]
static SYSTEM_MEDIA_UPDATE_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
impl SystemArtworkCache {
    fn get(&self, key: &str) -> Option<Vec<u8>> {
        let guard = self.0.lock().ok()?;
        let (cached_key, bytes) = guard.as_ref()?;
        (cached_key == key).then(|| bytes.clone())
    }

    fn insert(&self, key: String, bytes: Vec<u8>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some((key, bytes));
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SystemMediaTrack {
    title: String,
    artist: String,
    album: String,
    album_id: Option<String>,
    cover_art_id: Option<String>,
    artwork_url: Option<String>,
    fallback_artwork_data_url: Option<String>,
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

fn decode_fallback_artwork(value: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.len() > MAX_SYSTEM_FALLBACK_ARTWORK_DATA_URL_LENGTH {
        return Err("The system media fallback artwork is too large.".into());
    }
    let encoded = value
        .strip_prefix(PNG_DATA_URL_PREFIX)
        .ok_or_else(|| "The system media fallback artwork is invalid.".to_string())?;
    let bytes = BASE64_STANDARD
        .decode(encoded)
        .map_err(|_| "The system media fallback artwork is invalid.".to_string())?;
    if bytes.len() > MAX_SYSTEM_FALLBACK_ARTWORK_BYTES || !bytes.starts_with(PNG_SIGNATURE) {
        return Err("The system media fallback artwork is invalid.".into());
    }
    Ok(Some(bytes))
}

fn validate_input(input: &mut SystemMediaSessionInput) -> Result<Option<Vec<u8>>, String> {
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
        return Ok(None);
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
    decode_fallback_artwork(track.fallback_artwork_data_url.take().as_deref())
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
fn system_artwork_cache() -> &'static SystemArtworkCache {
    use std::sync::OnceLock;

    static CACHE: OnceLock<SystemArtworkCache> = OnceLock::new();
    CACHE.get_or_init(SystemArtworkCache::default)
}

#[cfg(target_os = "macos")]
fn artwork_cache_key(track: &SystemMediaTrack) -> Option<String> {
    track
        .cover_art_id
        .as_ref()
        .map(|id| format!("cover:{id}"))
        .or_else(|| track.album_id.as_ref().map(|id| format!("album:{id}")))
        .or_else(|| track.artwork_url.as_ref().map(|url| format!("url:{url}")))
}

#[cfg(target_os = "macos")]
async fn fetch_artwork_bytes(url: &str) -> Option<Vec<u8>> {
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
    Some(bytes)
}

#[cfg(target_os = "macos")]
async fn resolve_artwork_bytes(
    app: &tauri::AppHandle,
    track: &SystemMediaTrack,
) -> Option<Vec<u8>> {
    if let Some(url) = track.artwork_url.as_deref() {
        if let Some(bytes) = fetch_artwork_bytes(url).await {
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
    fetch_artwork_bytes(url.as_str()).await
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
        MPNowPlayingInfoMediaType, MPNowPlayingInfoPropertyDefaultPlaybackRate,
        MPNowPlayingInfoPropertyElapsedPlaybackTime, MPNowPlayingInfoPropertyMediaType,
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
            MPNowPlayingInfoPropertyMediaType,
        ];
        let mut values: Vec<Retained<AnyObject>> = vec![
            NSString::from_str(&track.title).into(),
            NSString::from_str(&track.artist).into(),
            NSString::from_str(&track.album).into(),
            NSNumber::new_f64(input.duration_seconds).into(),
            NSNumber::new_f64(input.position_seconds).into(),
            NSNumber::new_f64(if input.playing { 1.0 } else { 0.0 }).into(),
            NSNumber::new_f64(1.0).into(),
            NSNumber::new_usize(MPNowPlayingInfoMediaType::Audio.0).into(),
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
    let fallback_artwork = validate_input(&mut input)?;
    #[cfg(target_os = "macos")]
    {
        let update_generation = SYSTEM_MEDIA_UPDATE_GENERATION
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        let artwork_track = input.track.clone();
        let artwork_cache_key = artwork_track.as_ref().and_then(artwork_cache_key);
        let cached_artwork = artwork_cache_key
            .as_deref()
            .and_then(|key| system_artwork_cache().get(key));
        let initial_artwork = cached_artwork.clone().or(fallback_artwork);
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
            update_native_session(initial_input, initial_artwork);
        })
        .map_err(|error| format!("Could not update macOS media controls: {error}"))?;
        let artwork = match (cached_artwork, artwork_track.as_ref()) {
            (Some(_), _) | (_, None) => None,
            (None, Some(track)) => resolve_artwork_bytes(&app, track).await,
        };
        if SYSTEM_MEDIA_UPDATE_GENERATION.load(Ordering::Acquire) != update_generation {
            return Ok(());
        }
        if let Some(artwork) = artwork {
            if let Some(cache_key) = artwork_cache_key {
                system_artwork_cache().insert(cache_key, artwork.clone());
            }
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
        let _ = fallback_artwork;
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
                fallback_artwork_data_url: None,
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

    #[test]
    fn decodes_only_bounded_png_fallback_artwork() {
        let decoded = decode_fallback_artwork(Some(concat!(
            "data:image/png;base64,",
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lE",
            "QVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        )))
        .unwrap()
        .unwrap();
        assert_eq!(&decoded[..8], b"\x89PNG\r\n\x1a\n");
        assert!(decode_fallback_artwork(Some("data:image/jpeg;base64,Y29kYS1jb3Zlcg==",)).is_err());
        assert!(decode_fallback_artwork(Some("data:image/png;base64,not-valid-base64",)).is_err());
        let oversized = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_SYSTEM_FALLBACK_ARTWORK_DATA_URL_LENGTH),
        );
        assert!(decode_fallback_artwork(Some(&oversized)).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reuses_real_artwork_by_stable_cover_identity() {
        let mut first = sample_input().track.unwrap();
        let mut refreshed = first.clone();
        refreshed.artwork_url = Some("https://t4.bcbits.com/img/rotated-signed-cover.jpg".into());
        let key = artwork_cache_key(&first).unwrap();
        assert_eq!(artwork_cache_key(&refreshed).as_deref(), Some(key.as_str()));

        let cache = SystemArtworkCache::default();
        cache.insert(key.clone(), vec![1, 2, 3]);
        assert_eq!(cache.get(&key), Some(vec![1, 2, 3]));

        first.cover_art_id = None;
        assert_ne!(artwork_cache_key(&first), artwork_cache_key(&refreshed));
    }
}
