use super::*;

#[test]
fn returns_bounded_starred_albums_and_tracks() {
    let favorites = favorites_from_response(&serde_json::json!({
        "subsonic-response": {
            "status": "ok",
            "version": "1.16.1",
            "starred": {
                "album": [{
                    "id": "album-1",
                    "album": "Soft Focus",
                    "artist": "Night Archive",
                    "songCount": 9,
                    "duration": 2460,
                    "starred": "2026-08-12T18:00:00Z"
                }],
                "song": [{
                    "id": "track-1",
                    "title": "Afterimage",
                    "artist": "Night Archive",
                    "album": "Soft Focus",
                    "albumId": "album-1",
                    "duration": 210,
                    "track": 1,
                    "starred": "2026-08-12T18:01:00Z"
                }]
            }
        }
    }))
    .unwrap();

    assert_eq!(favorites.album_ids, ["album-1"]);
    assert_eq!(favorites.song_ids, ["track-1"]);
    assert_eq!(favorites.albums.len(), 1);
    assert_eq!(favorites.albums[0].title, "Soft Focus");
    assert_eq!(
        favorites.albums[0].starred_at.as_deref(),
        Some("2026-08-12T18:00:00Z")
    );
    assert_eq!(favorites.tracks.len(), 1);
    assert_eq!(favorites.tracks[0].title, "Afterimage");
    assert_eq!(favorites.tracks[0].album_id, "album-1");
    assert_eq!(
        favorites.tracks[0].starred_at.as_deref(),
        Some("2026-08-12T18:01:00Z")
    );
}

#[test]
fn accepts_get_starred_with_albums_but_no_enumerated_songs() {
    let favorites = favorites_from_response(&serde_json::json!({
        "subsonic-response": {
            "status": "ok",
            "starred": {
                "album": [{
                    "id": "album-1",
                    "album": "Soft Focus",
                    "artist": "Night Archive",
                    "starred": "2026-08-12T18:00:00Z"
                }]
            }
        }
    }))
    .unwrap();

    assert_eq!(favorites.album_ids, ["album-1"]);
    assert!(favorites.song_ids.is_empty());
    assert!(favorites.tracks.is_empty());
}

#[test]
fn get_album_track_star_is_available_for_reconciliation() {
    let tracks = album_tracks_from_response(
        &serde_json::json!({
            "subsonic-response": {
                "status": "ok",
                "album": {
                    "id": "album-1",
                    "song": [{
                        "id": "track-1",
                        "title": "Afterimage",
                        "artist": "Night Archive",
                        "album": "Soft Focus",
                        "albumId": "album-1",
                        "duration": 210,
                        "track": 1,
                        "starred": "2026-08-12T18:01:00Z"
                    }]
                }
            }
        }),
        "album-1",
    )
    .unwrap();

    assert_eq!(tracks.len(), 1);
    assert_eq!(
        tracks[0].starred_at.as_deref(),
        Some("2026-08-12T18:01:00Z")
    );
}

#[test]
fn reconciliation_only_removes_explicitly_returned_unstarred_tracks() {
    let requested_ids = BTreeSet::from([
        "track-starred".to_string(),
        "track-unstarred".to_string(),
        "track-missing".to_string(),
    ]);
    let mut starred = sample_track("track-starred");
    starred.starred_at = Some("2026-08-12T18:01:00Z".into());
    let unstarred = sample_track("track-unstarred");

    let result = reconcile_album_tracks(&requested_ids, vec![starred, unstarred]);

    assert_eq!(result.tracks.len(), 1);
    assert_eq!(result.tracks[0].id, "track-starred");
    assert_eq!(result.unstarred_ids, ["track-unstarred"]);
    assert_eq!(result.unavailable_track_count, 1);
}

#[test]
fn rejects_unbounded_favorite_album_lists() {
    let album = serde_json::json!({
        "id": "album-1",
        "album": "Soft Focus",
        "artist": "Night Archive"
    });
    let body = serde_json::json!({
        "subsonic-response": {
            "starred": {
                "album": vec![album; MAX_FAVORITE_ALBUMS + 1]
            }
        }
    });

    assert_eq!(
        favorites_from_response(&body).unwrap_err(),
        format!("Bandcamp returned more than {MAX_FAVORITE_ALBUMS} favorite albums.")
    );
}

#[test]
fn accepts_safe_json_and_xml_favorite_mutation_responses() {
    assert!(parse_subsonic_empty_response_bytes(
        br#"{"subsonic-response":{"status":"ok","version":"1.16.1"}}"#
    )
    .is_ok());
    assert!(parse_subsonic_empty_response_bytes(
        br#"<?xml version="1.0" encoding="UTF-8"?>
        <subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"/>"#
    )
    .is_ok());

    assert_eq!(
        parse_subsonic_empty_response_bytes(
            br#"<subsonic-response status="failed" version="1.16.1">
            <error code="0" message="private server detail"/>
            </subsonic-response>"#
        )
        .unwrap_err(),
        "Bandcamp rejected the request (error code 0)."
    );
}

#[test]
fn routes_album_and_song_favorite_mutations_to_protocol_parameters() {
    let album = FavoriteInput {
        id: "album-1".into(),
        kind: FavoriteKind::Album,
        favorite: true,
        album_id: None,
    };
    let song = FavoriteInput {
        id: "track-1".into(),
        kind: FavoriteKind::Song,
        favorite: false,
        album_id: Some("album-1".into()),
    };

    assert_eq!(
        favorite_mutation_request(&album).unwrap(),
        ("star", "albumId", "album-1".to_string())
    );
    assert_eq!(
        favorite_mutation_request(&song).unwrap(),
        ("unstar", "id", "track-1".to_string())
    );
}
