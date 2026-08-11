use super::*;
use redb::ReadableDatabase;
use std::sync::atomic::Ordering;

#[test]
fn atomically_round_trips_bounded_library_cache_without_media_urls() {
    let path = temporary_library_cache_path("roundtrip");
    let now = 1_800_000_000_000;
    write_library_cache(&path, &[sample_album("album-1")], now, now).unwrap();

    let serialized = fs::read_to_string(&path).unwrap();
    assert!(!serialized.contains("artworkUrl"));
    assert!(!serialized.contains("streamUrl"));
    assert!(!serialized.contains("\"tracks\""));

    let restored = read_library_cache(&path, now + 1_000).unwrap().unwrap();
    assert_eq!(restored.version, LIBRARY_CACHE_VERSION);
    assert_eq!(restored.last_full_sync_at, now);
    assert_eq!(restored.albums.len(), 1);
    assert_eq!(restored.albums[0], sample_album("album-1"));

    let directory = path.parent().unwrap().to_path_buf();
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn rejects_expired_future_malformed_and_overfull_library_caches() {
    let now = 1_800_000_000_000;
    let valid = LibraryCacheSnapshot {
        version: LIBRARY_CACHE_VERSION,
        saved_at: now,
        last_full_sync_at: now,
        albums: vec![sample_album("album-1")],
    };
    assert!(validate_library_cache(&valid, now).is_ok());
    assert!(validate_library_cache(
        &LibraryCacheSnapshot {
            saved_at: now + 1,
            ..valid.clone()
        },
        now
    )
    .is_err());
    assert!(validate_library_cache(
        &LibraryCacheSnapshot {
            last_full_sync_at: now + 1,
            ..valid.clone()
        },
        now
    )
    .is_err());
    assert!(validate_library_cache(
        &LibraryCacheSnapshot {
            saved_at: now - LIBRARY_CACHE_TTL_MS - 1,
            ..valid.clone()
        },
        now
    )
    .is_err());
    assert!(validate_library_cache(
        &LibraryCacheSnapshot {
            albums: vec![sample_album("album"); MAX_LIBRARY_ALBUMS + 1],
            ..valid
        },
        now
    )
    .is_err());

    let path = temporary_library_cache_path("malformed");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"{not-json").unwrap();
    assert!(load_library_cache_or_clear_invalid(&path, now)
        .unwrap()
        .is_none());
    assert!(!path.exists());
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn newest_probe_skips_only_unchanged_recent_full_caches() {
    let now = 1_800_000_000_000;
    let mut older = sample_album("album-older");
    older.added_at = Some("30 Jun 2026 12:00:00 GMT".into());
    let mut newest = sample_album("album-newest");
    newest.added_at = Some("02 Jul 2026 12:00:00 GMT".into());
    let snapshot = LibraryCacheSnapshot {
        version: LIBRARY_CACHE_VERSION,
        saved_at: now - 60_000,
        last_full_sync_at: now - 60_000,
        albums: vec![newest.clone(), older],
    };

    assert_eq!(
        newest_cached_album(&snapshot.albums).map(|album| album.id.as_str()),
        Some("album-newest")
    );
    assert!(newest_probe_matches_cache(&snapshot, Some(&newest)));
    assert!(!newest_probe_matches_cache(
        &snapshot,
        Some(&sample_album("album-unseen"))
    ));
    assert!(!cache_requires_full_reconciliation(&snapshot, now));
    assert!(cache_requires_full_reconciliation(
        &LibraryCacheSnapshot {
            last_full_sync_at: now - LIBRARY_FULL_RECONCILE_INTERVAL_MS,
            ..snapshot
        },
        now
    ));
}

#[test]
fn forced_album_refresh_supersedes_older_cache_and_network_requests() {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let album_id = format!("album-refresh-{suffix}");
    let connection_generation = CONNECTION_GENERATION.load(Ordering::Acquire);
    let original_generation = album_refresh_generation(&album_id).unwrap();

    assert!(
        ensure_album_request_current(connection_generation, &album_id, original_generation,)
            .is_ok()
    );

    let refreshed_generation = bump_album_refresh_generation(&album_id).unwrap();
    assert!(
        ensure_album_request_current(connection_generation, &album_id, original_generation,)
            .is_err()
    );
    assert!(
        ensure_album_request_current(connection_generation, &album_id, refreshed_generation,)
            .is_ok()
    );

    let path = temporary_album_metadata_cache_path("refresh-generation");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: format!("generated-user-{suffix}"),
        password: "generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, &album_id);
    let mut track = sample_track("track-refreshed");
    track.album_id = album_id.clone();
    let now = 1_800_000_000_000;

    assert!(!write_persisted_album_tracks(
        &database,
        &cache_key,
        &album_id,
        std::slice::from_ref(&track),
        now,
        None,
        Some((&album_id, original_generation)),
    )
    .unwrap());
    assert!(write_persisted_album_tracks(
        &database,
        &cache_key,
        &album_id,
        std::slice::from_ref(&track),
        now,
        None,
        Some((&album_id, refreshed_generation)),
    )
    .unwrap());
    let restored = read_persisted_album_tracks(&database, &cache_key, &album_id, now + 1)
        .unwrap()
        .unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, track.id);

    album_refresh_generations()
        .lock()
        .unwrap()
        .remove(&album_id);
    drop(database);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn redb_round_trips_bounded_album_metadata_without_credentials_or_media_urls() {
    let path = temporary_album_metadata_cache_path("roundtrip");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: "generated-user".into(),
        password: "generated-password".into(),
    };
    let another_account = ConnectionInput {
        username: "another-generated-user".into(),
        password: "another-generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, "album-1");
    let another_cache_key = persisted_album_track_cache_key(&another_account, "album-1");
    let now = 1_800_000_000_000;

    assert_ne!(cache_key, another_cache_key);
    assert!(write_persisted_album_tracks(
        &database,
        &cache_key,
        "album-1",
        &[sample_track("track-1")],
        now,
        None,
        None,
    )
    .unwrap());
    let restored = read_persisted_album_tracks(&database, &cache_key, "album-1", now + 1).unwrap();
    assert_eq!(restored.unwrap()[0].id, "track-1");
    assert!(
        read_persisted_album_tracks(&database, &another_cache_key, "album-1", now + 1,)
            .unwrap()
            .is_none()
    );

    let transaction = database.begin_read().unwrap();
    let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
    let serialized = table.get(cache_key.as_str()).unwrap().unwrap();
    let serialized = String::from_utf8(serialized.value().to_vec()).unwrap();
    assert!(!cache_key.contains("generated-user"));
    assert!(!cache_key.contains("generated-password"));
    assert!(!serialized.contains("generated-user"));
    assert!(!serialized.contains("generated-password"));
    assert!(!serialized.contains("streamUrl"));
    assert!(!serialized.contains("artworkUrl"));
    drop(table);
    drop(transaction);
    drop(database);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn redb_discards_expired_and_incompatible_album_metadata() {
    let path = temporary_album_metadata_cache_path("expiry");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: "generated-user".into(),
        password: "generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, "album-1");
    let now = 1_800_000_000_000;

    assert!(write_persisted_album_tracks(
        &database,
        &cache_key,
        "album-1",
        &[sample_track("track-1")],
        now,
        None,
        None,
    )
    .unwrap());
    assert!(read_persisted_album_tracks(
        &database,
        &cache_key,
        "album-1",
        now + PERSISTED_ALBUM_TRACK_CACHE_TTL_MS + 1,
    )
    .unwrap()
    .is_none());

    let incompatible = serde_json::to_vec(&PersistedAlbumTracks {
        version: ALBUM_TRACK_CACHE_ENTRY_VERSION + 1,
        saved_at: now,
        album_id: "album-1".into(),
        tracks: vec![sample_track("track-1")],
    })
    .unwrap();
    let transaction = database.begin_write().unwrap();
    {
        let mut table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        table
            .insert(cache_key.as_str(), incompatible.as_slice())
            .unwrap();
    }
    transaction.commit().unwrap();
    assert!(
        read_persisted_album_tracks(&database, &cache_key, "album-1", now)
            .unwrap()
            .is_none()
    );

    let transaction = database.begin_read().unwrap();
    let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
    assert!(table.get(cache_key.as_str()).unwrap().is_none());
    drop(table);
    drop(transaction);
    drop(database);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn album_track_responses_require_bounded_valid_metadata() {
    let valid = serde_json::json!({
        "subsonic-response": {
            "album": {
                "id": "album-1",
                "song": [{
                    "id": "track-1",
                    "title": "Afterimage",
                    "artist": "Night Archive",
                    "album": "Soft Focus",
                    "albumId": "album-1",
                    "duration": 210,
                    "track": 1
                }]
            }
        }
    });
    assert_eq!(
        album_tracks_from_response(&valid, "album-1").unwrap().len(),
        1
    );

    let wrong_shape = serde_json::json!({
        "subsonic-response": { "album": { "song": {} } }
    });
    assert!(album_tracks_from_response(&wrong_shape, "album-1").is_err());

    let wrong_album = serde_json::json!({
        "subsonic-response": {
            "album": {
                "id": "album-1",
                "song": [{
                    "id": "track-1",
                    "title": "Afterimage",
                    "artist": "Night Archive",
                    "album": "Soft Focus",
                    "albumId": "another-album"
                }]
            }
        }
    });
    assert!(album_tracks_from_response(&wrong_album, "album-1").is_err());
}

#[test]
fn bandcamp_read_retries_are_bounded_and_retry_after_aware() {
    let now = UNIX_EPOCH + Duration::from_secs(1_000);
    let mut headers = HeaderMap::new();
    headers.insert(RETRY_AFTER, reqwest::header::HeaderValue::from_static("5"));
    assert_eq!(
        bandcamp_retry_delay(Some(&headers), 0, now, 100),
        Duration::from_millis(5_100)
    );

    let retry_at = httpdate::fmt_http_date(now + Duration::from_secs(7));
    headers.insert(
        RETRY_AFTER,
        reqwest::header::HeaderValue::from_str(&retry_at).unwrap(),
    );
    assert_eq!(
        bandcamp_retry_delay(Some(&headers), 0, now, 0),
        Duration::from_secs(7)
    );

    headers.insert(
        RETRY_AFTER,
        reqwest::header::HeaderValue::from_static("120"),
    );
    assert_eq!(
        bandcamp_retry_delay(Some(&headers), 0, now, 100),
        BANDCAMP_MAX_RETRY_DELAY
    );
    assert_eq!(
        bandcamp_retry_delay(None, 0, now, 0),
        Duration::from_millis(BANDCAMP_RETRY_BASE_MS)
    );
    assert_eq!(
        bandcamp_retry_delay(None, 1, now, 0),
        Duration::from_millis(BANDCAMP_RETRY_BASE_MS * 2)
    );
}

#[test]
fn bandcamp_read_retries_only_transient_statuses() {
    for status in [
        StatusCode::REQUEST_TIMEOUT,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::BAD_GATEWAY,
        StatusCode::SERVICE_UNAVAILABLE,
        StatusCode::GATEWAY_TIMEOUT,
    ] {
        assert!(is_retryable_bandcamp_status(status));
    }
    for status in [
        StatusCode::BAD_REQUEST,
        StatusCode::UNAUTHORIZED,
        StatusCode::NOT_FOUND,
        StatusCode::INTERNAL_SERVER_ERROR,
    ] {
        assert!(!is_retryable_bandcamp_status(status));
    }
}

#[test]
fn library_page_aggregation_preserves_order_deduplicates_and_caps_results() {
    let mut albums = vec![sample_album("album-0")];
    let mut ids = BTreeSet::from(["album-0".to_string()]);
    let appended = append_library_page(
        &mut albums,
        &mut ids,
        vec![
            sample_album("album-1"),
            sample_album("album-0"),
            sample_album("album-2"),
        ],
    );

    assert_eq!(
        albums
            .iter()
            .map(|album| album.id.as_str())
            .collect::<Vec<_>>(),
        ["album-0", "album-1", "album-2"]
    );
    assert_eq!(
        appended
            .iter()
            .map(|album| album.id.as_str())
            .collect::<Vec<_>>(),
        ["album-1", "album-2"]
    );

    let mut full = (0..MAX_LIBRARY_ALBUMS - 1)
        .map(|index| sample_album(&format!("album-{index}")))
        .collect::<Vec<_>>();
    let mut full_ids = full
        .iter()
        .map(|album| album.id.clone())
        .collect::<BTreeSet<_>>();
    append_library_page(
        &mut full,
        &mut full_ids,
        vec![sample_album("last-album"), sample_album("overflow-album")],
    );
    assert_eq!(full.len(), MAX_LIBRARY_ALBUMS);
    assert_eq!(
        full.last().map(|album| album.id.as_str()),
        Some("last-album")
    );
}

#[test]
fn library_progress_uses_the_renderer_camel_case_contract() {
    let value = serde_json::to_value(LibrarySyncEvent::Page {
        page_index: 2,
        loaded: 1_500,
        albums: vec![sample_album("album-1")],
    })
    .unwrap();

    assert_eq!(value.get("kind").and_then(Value::as_str), Some("page"));
    assert_eq!(value.get("pageIndex").and_then(Value::as_u64), Some(2));
    assert_eq!(value.get("loaded").and_then(Value::as_u64), Some(1_500));
    assert!(value.get("page_index").is_none());
}

#[test]
fn library_pages_require_the_bounded_subsonic_shape() {
    let empty = serde_json::json!({
        "subsonic-response": { "albumList2": {} }
    });
    assert_eq!(albums_from_library_page(&empty).unwrap(), (0, Vec::new()));

    let missing = serde_json::json!({
        "subsonic-response": {}
    });
    assert!(albums_from_library_page(&missing).is_err());

    let wrong_type = serde_json::json!({
        "subsonic-response": { "albumList2": { "album": {} } }
    });
    assert!(albums_from_library_page(&wrong_type).is_err());

    let oversized = serde_json::json!({
        "subsonic-response": {
            "albumList2": {
                "album": (0..501)
                    .map(|index| serde_json::json!({
                        "id": format!("album-{index}"),
                        "name": "Soft Focus",
                        "artist": "Night Archive"
                    }))
                    .collect::<Vec<_>>()
            }
        }
    });
    assert!(albums_from_library_page(&oversized).is_err());
}
