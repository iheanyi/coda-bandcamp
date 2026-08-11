use super::*;

#[test]
fn parses_bounded_playlist_summaries_and_details() {
    let body = serde_json::json!({
        "subsonic-response": {
            "playlists": {
                "playlist": [{
                    "id": "playlist-1",
                    "name": "Night drives",
                    "comment": "Long roads, low light",
                    "owner": "fan",
                    "public": "false",
                    "songCount": "1",
                    "duration": 245,
                    "created": "2026-07-25T02:00:00Z",
                    "changed": "2026-07-25T02:10:00Z",
                    "coverArt": "cover-1"
                }]
            }
        }
    });
    let playlists = playlists_from_response(&body).unwrap();
    assert_eq!(playlists.len(), 1);
    assert_eq!(playlists[0].name, "Night drives");
    assert_eq!(playlists[0].public, Some(false));

    let detail = playlist_detail_from_value(&serde_json::json!({
        "id": "playlist-1",
        "name": "Night drives",
        "songCount": 1,
        "duration": 245,
        "entry": [{
            "id": "song-1",
            "title": "Afterimage",
            "artist": "Night Archive",
            "album": "Soft Focus",
            "albumId": "album-1",
            "duration": "245",
            "track": 2,
            "discNumber": 1,
            "coverArt": "cover-1"
        }]
    }))
    .unwrap();
    assert_eq!(detail.tracks.len(), 1);
    assert_eq!(detail.tracks[0].album_id, "album-1");
    assert_eq!(detail.tracks[0].duration, 245);
}

#[test]
fn reports_an_empty_successful_playlist_update_as_committed_without_detail() {
    let body = serde_json::json!({
        "subsonic-response": {
            "status": "ok",
            "version": "1.16.1"
        }
    });

    assert!(playlist_update_from_response(&body, "playlist-1")
        .unwrap()
        .is_none());
}

#[test]
fn rejects_playlist_detail_for_a_different_committed_update() {
    let body = serde_json::json!({
        "subsonic-response": {
            "status": "ok",
            "version": "1.16.1",
            "playlist": {
                "id": "playlist-2",
                "name": "Different playlist",
                "songCount": 0,
                "duration": 0
            }
        }
    });

    assert_eq!(
        playlist_update_from_response(&body, "playlist-1").unwrap_err(),
        "Bandcamp returned a different playlist than Coda updated."
    );
}

#[test]
fn loads_playlist_tracks_using_the_parent_or_song_id_when_album_id_is_absent() {
    let detail = playlist_detail_from_value(&serde_json::json!({
        "id": "playlist-1",
        "name": "Night drives",
        "songCount": 2,
        "duration": 490,
        "entry": [
            {
                "id": "song-1",
                "parent": "album-1",
                "title": "Afterimage",
                "artist": "Night Archive",
                "album": "Soft Focus",
                "duration": 245,
                "track": 2
            },
            {
                "id": "standalone-song-1",
                "title": "Signal",
                "artist": "Night Archive",
                "duration": 245,
                "coverArt": "standalone-cover-1"
            }
        ]
    }))
    .unwrap();

    assert_eq!(detail.tracks[0].album_id, "album-1");
    assert_eq!(detail.tracks[1].album_id, "standalone-song-1");
}

#[test]
fn rejects_malformed_playlist_album_associations() {
    for entry in [
        serde_json::json!({
            "id": "song-1",
            "albumId": 7,
            "title": "Afterimage"
        }),
        serde_json::json!({
            "id": "song-1",
            "parent": false,
            "title": "Afterimage"
        }),
    ] {
        let playlist = serde_json::json!({
            "id": "playlist-1",
            "name": "Night drives",
            "songCount": 1,
            "duration": 245,
            "entry": [entry]
        });
        assert!(playlist_detail_from_value(&playlist).is_err());
    }
}

#[test]
fn accepts_an_empty_playlist_list_but_rejects_a_non_array_list() {
    let empty = serde_json::json!({
        "subsonic-response": {
            "playlists": {}
        }
    });
    assert!(playlists_from_response(&empty).unwrap().is_empty());

    let non_array = serde_json::json!({
        "subsonic-response": {
            "playlists": {
                "playlist": {
                    "id": "playlist-1",
                    "name": "Night drives",
                    "songCount": 1,
                    "duration": 245
                }
            }
        }
    });
    assert!(playlists_from_response(&non_array).is_err());
}

#[test]
fn accepts_an_empty_playlist_but_rejects_non_array_entries() {
    let empty = playlist_detail_from_value(&serde_json::json!({
        "id": "playlist-1",
        "name": "Night drives",
        "songCount": 0,
        "duration": 0
    }))
    .unwrap();
    assert!(empty.tracks.is_empty());

    let non_array = serde_json::json!({
        "id": "playlist-1",
        "name": "Night drives",
        "songCount": 1,
        "duration": 245,
        "entry": {
            "id": "song-1",
            "parent": "album-1",
            "title": "Afterimage",
            "artist": "Night Archive",
            "album": "Soft Focus",
            "duration": 245
        }
    });
    assert!(playlist_detail_from_value(&non_array).is_err());
}

#[test]
fn rejects_invalid_or_unbounded_playlist_changes() {
    assert!(validate_playlist_name("  ").is_err());
    assert!(validate_playlist_name("Bad\nname").is_err());
    assert!(validate_song_ids(&vec!["song".into(); MAX_PLAYLIST_MUTATION_ITEMS + 1]).is_err());

    let duplicate_indexes = PlaylistUpdateInput {
        playlist_id: "playlist-1".into(),
        name: None,
        comment: None,
        public: None,
        song_ids_to_add: Vec::new(),
        song_indexes_to_remove: vec![2, 2],
    };
    assert!(validate_playlist_update(&duplicate_indexes).is_err());

    let empty_update = PlaylistUpdateInput {
        song_indexes_to_remove: Vec::new(),
        ..duplicate_indexes
    };
    assert!(validate_playlist_update(&empty_update).is_err());
}

#[test]
fn reports_unavailable_beta_endpoints_without_leaking_server_details() {
    assert_eq!(
        beta_feature_error("Favorites", "Bandcamp returned HTTP 404.".into()),
        "Favorites is not available from Bandcamp's Subsonic beta for this account yet."
    );
    assert_eq!(
        beta_feature_error("Playlist loading", "Timed out".into()),
        "Playlist loading failed: Timed out"
    );
}
