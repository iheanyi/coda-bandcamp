use super::*;

#[test]
fn signs_lastfm_parameters_in_sorted_order_without_format_or_callback() {
    let parameters = BTreeMap::from([
        ("track".into(), "Afterimage".into()),
        ("format".into(), "json".into()),
        ("artist".into(), "Night Archive".into()),
        ("callback".into(), "https://example.test".into()),
    ]);
    let expected = format!(
        "{:x}",
        md5::compute(format!(
            "artistNight ArchivetrackAfterimage{LASTFM_SHARED_SECRET}"
        ))
    );
    assert_eq!(lastfm_signature(&parameters), expected);
}

#[test]
fn validates_lastfm_track_metadata() {
    let valid = LastFmTrackInput {
        artist: "Night Archive".into(),
        title: "Afterimage".into(),
        album: "Soft Focus".into(),
        album_artist: Some("Night Archive".into()),
        music_brainz_id: Some("189002e7-3285-4e2e-92a3-7f6c30d407a2".into()),
        duration: 210,
        track_number: 2,
        chosen_by_user: None,
    };
    assert!(validate_lastfm_track(&valid).is_ok());
    assert!(validate_lastfm_track(&LastFmTrackInput {
        title: "Bad\nTitle".into(),
        ..valid.clone()
    })
    .is_err());

    let radio = LastFmTrackInput {
        artist: "North Star".into(),
        title: "First light".into(),
        album: "Daybreak".into(),
        album_artist: None,
        music_brainz_id: None,
        duration: 120,
        track_number: 2,
        chosen_by_user: Some(false),
    };
    let parameters = lastfm_scrobble_parameters(&radio);
    assert_eq!(
        parameters.get("chosenByUser").map(String::as_str),
        Some("0")
    );
    assert!(!lastfm_track_parameters(&radio).contains_key("chosenByUser"));
    assert_eq!(
        lastfm_track_parameters(&valid)
            .get("albumArtist")
            .map(String::as_str),
        Some("Night Archive")
    );
    assert_eq!(
        lastfm_track_parameters(&valid)
            .get("mbid")
            .map(String::as_str),
        Some("189002e7-3285-4e2e-92a3-7f6c30d407a2")
    );
    assert!(validate_lastfm_track(&LastFmTrackInput {
        music_brainz_id: Some("not-an-mbid".into()),
        ..valid.clone()
    })
    .is_err());
    assert!(validate_lastfm_track(&LastFmTrackInput {
        duration: MAX_MEDIA_SECONDS as u64 + 1,
        ..valid.clone()
    })
    .is_err());
    assert!(validate_lastfm_track(&LastFmTrackInput {
        track_number: MAX_TRACK_NUMBER + 1,
        ..valid.clone()
    })
    .is_err());

    let serialized = serde_json::json!({
        "artist": valid.artist,
        "title": valid.title,
        "album": valid.album,
        "albumArtist": valid.album_artist,
        "musicBrainzId": valid.music_brainz_id,
        "duration": valid.duration,
        "trackNumber": valid.track_number,
        "chosenByUser": valid.chosen_by_user,
        "unexpected": true
    });
    assert!(serde_json::from_value::<LastFmTrackInput>(serialized).is_err());
}

#[test]
fn validates_lastfm_sessions_before_secure_storage() {
    assert!(validate_lastfm_session(&LastFmSession {
        username: "listener".into(),
        key: "session-key".into(),
    })
    .is_ok());
    assert!(validate_lastfm_session(&LastFmSession {
        username: "listener\nname".into(),
        key: "session-key".into(),
    })
    .is_err());
    assert!(validate_lastfm_session(&LastFmSession {
        username: " listener".into(),
        key: "session-key".into(),
    })
    .is_err());
    assert!(validate_lastfm_token(" token").is_err());
    assert!(serde_json::from_value::<LastFmSession>(serde_json::json!({
        "username": "listener",
        "key": "session-key",
        "unexpected": true
    }))
    .is_err());
}

#[test]
fn lastfm_errors_never_echo_remote_messages_or_session_material() {
    let message = lastfm_error_message(&serde_json::json!({
        "error": 9,
        "message": "Invalid session key: private-session-material"
    }));
    assert_eq!(message, "Last.fm rejected the request (error code 9).");
    assert!(!message.contains("private-session-material"));
}

#[test]
fn preserves_supported_lastfm_identity_from_subsonic_tracks() {
    let track = track_from_value(
        &serde_json::json!({
            "id": "song-1",
            "title": "Afterimage",
            "artist": "Night Archive",
            "album": "Soft Focus",
            "albumId": "album-1",
            "duration": 210,
            "track": 2,
            "displayAlbumArtist": "Night Archive & Guests",
            "musicBrainzId": "189002e7-3285-4e2e-92a3-7f6c30d407a2"
        }),
        "album-1",
    )
    .expect("valid Subsonic track");

    assert_eq!(
        track.album_artist.as_deref(),
        Some("Night Archive & Guests")
    );
    assert_eq!(
        track.music_brainz_id.as_deref(),
        Some("189002e7-3285-4e2e-92a3-7f6c30d407a2")
    );
}

#[test]
fn preserves_missing_release_metadata_as_empty_across_native_track_boundaries() {
    let track = bounded_track_from_value(
        &serde_json::json!({
            "id": "song-1",
            "title": "Afterimage",
            "artist": "Night Archive",
            "albumId": "album-1",
            "duration": 210,
            "track": 2
        }),
        "album-1",
    )
    .expect("valid Subsonic track without release metadata");
    assert!(track.album.is_empty());
    assert!(bounded_track_from_value(
        &serde_json::json!({
            "id": "song-1",
            "title": "Afterimage",
            "artist": "Night Archive",
            "album": "Bad\nrelease",
            "albumId": "album-1"
        }),
        "album-1",
    )
    .is_none());

    let cached = PersistedAlbumTracks {
        version: ALBUM_TRACK_CACHE_ENTRY_VERSION,
        saved_at: 1_800_000_000_000,
        album_id: "album-1".into(),
        tracks: vec![track],
    };
    assert!(validate_persisted_album_tracks(&cached, "album-1", 1_800_000_000_000,).is_ok());

    let mut player = sample_player_state();
    player.queue[0].album.clear();
    assert!(validate_player_state(&player).is_ok());

    let mut invalid_cached = cached;
    invalid_cached.tracks[0].album = "Bad\nrelease".into();
    assert!(
        validate_persisted_album_tracks(&invalid_cached, "album-1", 1_800_000_000_000,).is_err()
    );

    player.queue[0].album = "Bad\nrelease".into();
    assert!(validate_player_state(&player).is_err());
}
