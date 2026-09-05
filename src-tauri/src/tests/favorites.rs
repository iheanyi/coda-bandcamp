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

#[test]
fn favorite_album_refresh_preserves_partial_results_without_unrequested_tracks() {
    let albums = BTreeMap::from([
        (
            "album-1".into(),
            BTreeSet::from(["starred".into(), "unstarred".into(), "missing".into()]),
        ),
        ("album-2".into(), BTreeSet::from(["unavailable".into()])),
    ]);
    let result = tauri::async_runtime::block_on(reconcile_favorite_albums(
        albums,
        |album_id| async move {
            if album_id == "album-2" {
                return Err("Unavailable".into());
            }
            let mut starred = sample_track("starred");
            starred.starred_at = Some("2026-08-12T18:01:00Z".into());
            Ok(vec![
                starred,
                sample_track("unstarred"),
                sample_track("not-requested"),
            ])
        },
        || true,
    ))
    .unwrap();
    assert_eq!(
        result
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        ["starred"]
    );
    assert_eq!(result.unstarred_ids, ["unstarred"]);
    assert_eq!(result.unavailable_track_count, 2);
}

#[test]
fn favorite_album_refresh_stops_queued_work_when_connection_changes() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    let current = AtomicBool::new(true);
    let started = AtomicUsize::new(0);
    let albums = (0..100)
        .map(|index| (format!("album-{index}"), BTreeSet::new()))
        .collect();
    let result = tauri::async_runtime::block_on(reconcile_favorite_albums(
        albums,
        |_| {
            started.fetch_add(1, Ordering::SeqCst);
            current.store(false, Ordering::SeqCst);
            std::future::ready(Ok(Vec::new()))
        },
        || current.load(Ordering::SeqCst),
    ));
    assert!(result.unwrap_err().contains("connection changed"));
    assert_eq!(started.load(Ordering::SeqCst), 1);
}

#[test]
fn favorite_album_refresh_keeps_six_requests_in_flight_and_drops_them_on_disconnect() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::task::Poll;
    let current = AtomicBool::new(true);
    let started = AtomicUsize::new(0);
    let active = AtomicUsize::new(0);
    struct ActiveRequest<'a>(&'a AtomicUsize);
    impl Drop for ActiveRequest<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let albums = (0..100)
        .map(|index| (format!("album-{index}"), BTreeSet::new()))
        .collect();
    let result = tauri::async_runtime::block_on(reconcile_favorite_albums(
        albums,
        |_| {
            started.fetch_add(1, Ordering::SeqCst);
            active.fetch_add(1, Ordering::SeqCst);
            let request = ActiveRequest(&active);
            let current = &current;
            let active = &active;
            async move {
                let _request = request;
                std::future::poll_fn(|_| {
                    if active.load(Ordering::SeqCst) == 6 {
                        current.store(false, Ordering::SeqCst);
                        Poll::Ready(Ok(Vec::new()))
                    } else {
                        Poll::Pending
                    }
                })
                .await
            }
        },
        || current.load(Ordering::SeqCst),
    ));
    assert!(result.unwrap_err().contains("connection changed"));
    assert_eq!(started.load(Ordering::SeqCst), 6);
    assert_eq!(active.load(Ordering::SeqCst), 0);
}
