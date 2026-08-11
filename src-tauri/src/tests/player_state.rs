use super::*;

#[test]
fn validates_bounded_player_state_and_rejects_unrestorable_tracks() {
    let valid = sample_player_state();
    assert!(validate_player_state(&valid).is_ok());

    let mut control_character = valid.clone();
    control_character.queue[0].title = "Bad\nTitle".into();
    assert!(validate_player_state(&control_character).is_err());

    let mut bad_palette = valid.clone();
    bad_palette.queue[0].palette[0] = "#fff\u{7f}".into();
    assert!(validate_player_state(&bad_palette).is_err());

    let mut discover = valid.clone();
    discover.queue[0].id = "discover:featured".into();
    assert!(validate_player_state(&discover).is_err());

    let mut radio = valid.clone();
    radio.queue[0].id = "radio:979".into();
    radio.last_fm_progress = None;
    radio.radio_scrobble_progress = Some(RadioScrobbleProgress {
        show_track_id: "radio:979".into(),
        active_chapter_key: Some("60:chapter".into()),
        chapter_started_at: 1_700_000_000,
        chapter_listened_seconds: 61.0,
        last_position: 121.0,
        chapter_now_playing_sent: true,
        chapter_scrobble_state: "pending".into(),
        show_started_at: 1_700_000_000,
        show_listened_seconds: 121.0,
        show_scrobble_state: "idle".into(),
        scrobbled_chapter_keys: Vec::new(),
    });
    assert!(validate_player_state(&radio).is_ok());
    normalize_restored_player_progress(&mut radio);
    let radio_progress = radio.radio_scrobble_progress.unwrap();
    assert_eq!(radio_progress.chapter_started_at, 0);
    assert!(!radio_progress.chapter_now_playing_sent);
    assert_eq!(radio_progress.chapter_scrobble_state, "sent");
    assert_eq!(radio_progress.scrobbled_chapter_keys, ["60:chapter"]);

    let mut implausible_track_number = valid.clone();
    implausible_track_number.queue[0].track = MAX_PLAYER_TRACK_NUMBER + 1;
    assert!(validate_player_state(&implausible_track_number).is_err());

    let mut oversized = valid;
    oversized.queue = vec![sample_player_track("track"); MAX_PLAYER_QUEUE_LENGTH.saturating_add(1)];
    assert!(validate_player_state(&oversized).is_err());
}

#[test]
fn matches_the_shared_renderer_radio_persistence_contract() {
    let contract: Value = serde_json::from_str(include_str!(
        "../../../test/fixtures/player-state-radio-contract.json"
    ))
    .unwrap();
    assert_eq!(
        contract["contractVersion"].as_u64(),
        Some(u64::from(PLAYER_STATE_CONTRACT_VERSION))
    );

    let mut state: PlayerStateSnapshot =
        serde_json::from_value(contract["snapshot"].clone()).unwrap();
    let checkpoint: PlayerStateCheckpoint =
        serde_json::from_value(contract["checkpoint"].clone()).unwrap();
    assert!(validate_player_state(&state).is_ok());
    assert!(validate_player_checkpoint(&checkpoint).is_ok());
    assert!(apply_player_checkpoint(&mut state, checkpoint));
    normalize_restored_player_progress(&mut state);

    assert_eq!(state.position_seconds, 125.0);
    let progress = state.radio_scrobble_progress.unwrap();
    assert_eq!(progress.show_track_id, "radio:979");
    assert_eq!(progress.chapter_scrobble_state, "sent");
    assert_eq!(progress.scrobbled_chapter_keys, ["60:chapter"]);
}

#[test]
fn persisted_player_shape_rejects_urls_and_unknown_fields() {
    let state = sample_player_state();
    let serialized = serde_json::to_string(&state).unwrap();
    assert!(!serialized.contains("streamUrl"));
    assert!(!serialized.contains("artworkUrl"));

    let mut value = serde_json::to_value(state).unwrap();
    value["queue"][0]["streamUrl"] =
        Value::String("https://bandcamp.com/api/subsonic/rest/stream.view?t=signed".into());
    assert!(serde_json::from_value::<PlayerStateSnapshot>(value).is_err());
}

#[test]
fn atomically_round_trips_player_state_and_discards_corruption() {
    let path = temporary_player_state_path("roundtrip");
    let directory = path.parent().unwrap().to_path_buf();
    let state = sample_player_state();

    write_player_state(&path, &state).unwrap();
    let restored = read_player_state(&path).unwrap().unwrap();
    assert_eq!(restored.queue[0].id, "track-1");
    assert_eq!(restored.position_seconds, 42.0);

    fs::write(&path, b"{ definitely not valid json").unwrap();
    assert!(load_player_state_or_clear_invalid(&path).unwrap().is_none());
    assert!(!path.exists());
    fs::remove_dir(directory).unwrap();
}

#[test]
fn lightweight_checkpoint_applies_only_to_the_matching_track() {
    let mut state = sample_player_state();
    let checkpoint = PlayerStateCheckpoint {
        current_index: 0,
        current_track_id: "track-1".into(),
        position_seconds: 90.0,
        last_fm_progress: Some(LastFmPlaybackProgress {
            track_id: "track-1".into(),
            started_at: 1_700_000_000,
            listened_seconds: 85.0,
            last_position: 90.0,
            now_playing_sent: true,
            scrobble_state: "pending".into(),
        }),
        radio_scrobble_progress: None,
    };
    assert!(apply_player_checkpoint(&mut state, checkpoint));
    normalize_restored_player_progress(&mut state);
    assert_eq!(state.position_seconds, 90.0);
    let progress = state.last_fm_progress.unwrap();
    assert_eq!(progress.started_at, 0);
    assert!(!progress.now_playing_sent);
    assert_eq!(progress.scrobble_state, "sent");

    let mut another_state = sample_player_state();
    let stale = PlayerStateCheckpoint {
        current_index: 0,
        current_track_id: "another-track".into(),
        position_seconds: 120.0,
        last_fm_progress: None,
        radio_scrobble_progress: None,
    };
    assert!(!apply_player_checkpoint(&mut another_state, stale));
    assert_eq!(another_state.position_seconds, 42.0);
}
