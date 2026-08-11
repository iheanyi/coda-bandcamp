use super::*;

#[test]
fn system_media_metadata_is_bounded_and_keeps_artwork_allowlisted() {
    let valid = SystemMediaMetadataInput {
        title: "Afterimage".into(),
        artist: "Night Archive".into(),
        album: "Soft Focus".into(),
        artwork_url: Some("https://f4.bcbits.com/img/a123_10.jpg".into()),
        can_previous: true,
        can_next: true,
    };
    assert_eq!(
        validate_system_media_metadata(&valid).unwrap().as_deref(),
        Some("https://f4.bcbits.com/img/a123_10.jpg")
    );

    let mut invalid = valid.clone();
    invalid.title = "bad\nmetadata".into();
    assert!(validate_system_media_metadata(&invalid).is_err());
    invalid = valid;
    invalid.artwork_url = Some("https://evil.example/cover.jpg".into());
    assert!(validate_system_media_metadata(&invalid).is_err());
}

#[test]
fn system_media_artwork_accepts_only_bounded_supported_images() {
    assert!(valid_system_media_artwork_bytes(&[0xff, 0xd8, 0xff, 0xe0]));
    assert!(valid_system_media_artwork_bytes(b"\x89PNG\r\n\x1a\nrest"));
    assert!(valid_system_media_artwork_bytes(b"RIFFsizeWEBPrest"));
    assert!(!valid_system_media_artwork_bytes(b"<html>not an image"));
    assert!(!valid_system_media_artwork_bytes(&vec![
        0xff;
        MAX_SYSTEM_MEDIA_ARTWORK_BYTES
            + 1
    ]));
}

#[test]
fn playback_blocking_commands_are_dispatched_off_the_window_thread() {
    let media_source = include_str!("../media_session.rs").replace("\r\n", "\n");
    assert!(media_source
        .contains("#[tauri::command]\npub(super) async fn update_system_media_playback"));
    assert!(media_source
        .contains("#[tauri::command]\npub(super) async fn update_system_media_timeline"));
    assert!(media_source.contains("pub(super) async fn spawn_system_media_blocking"));
    assert!(media_source.contains("tauri::async_runtime::spawn_blocking"));

    let playlist_source = include_str!("../playlists.rs").replace("\r\n", "\n");
    assert!(playlist_source.contains("#[tauri::command]\npub(super) async fn get_stream_url"));
    assert!(playlist_source.contains("#[tauri::command]\npub(super) async fn get_cover_url"));
}
