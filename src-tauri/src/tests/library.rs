use super::*;
use redb::{ReadableDatabase, ReadableTableMetadata};
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

    let restored = load_library_cache_or_clear_invalid(&path, now + 1_000)
        .unwrap()
        .unwrap();
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
fn keeps_operational_cache_failures_distinct_from_discardable_corruption() {
    let path = temporary_library_cache_path("operational-error");
    fs::create_dir_all(&path).unwrap();

    assert!(load_library_cache_or_clear_invalid(&path, 1_800_000_000_000).is_err());
    assert!(path.is_dir());

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
fn cache_persistence_failures_do_not_discard_a_live_library_sync() {
    assert!(finish_library_cache_write(Ok(true), "cache write").is_ok());
    assert!(finish_library_cache_write(Err("disk full".into()), "cache write").is_ok());
    assert!(finish_library_cache_write(Ok(false), "cache write").is_err());
}

#[test]
fn account_cache_reset_is_required_when_the_previous_owner_is_unknown_or_changes() {
    let first = ConnectionInput {
        username: "first-user".into(),
        password: "first-password".into(),
    };
    let refreshed = ConnectionInput {
        username: "first-user".into(),
        password: "new-password".into(),
    };
    let second = ConnectionInput {
        username: "second-user".into(),
        password: "second-password".into(),
    };

    assert!(connection_owner_changed(None, &first));
    assert!(!connection_owner_changed(Some(&first), &refreshed));
    assert!(connection_owner_changed(Some(&first), &second));
}

#[test]
fn connection_change_blocks_intermediate_album_requests_until_final_generation() {
    assert!(!album_request_connection_is_current(7, 7, true));
    assert!(!album_request_connection_is_current(7, 8, false));
    assert!(album_request_connection_is_current(8, 8, false));
}

#[test]
fn connection_change_guard_excludes_overlapping_credential_mutations() {
    let _generation_test_guard = ALBUM_CACHE_GENERATION_TEST_LOCK.lock().unwrap();
    assert!(!CONNECTION_CHANGE_IN_PROGRESS.load(Ordering::Acquire));
    let original_generation = current_connection_generation();
    let first = ConnectionChangeGuard::begin().unwrap();
    assert!(CONNECTION_CHANGE_IN_PROGRESS.load(Ordering::Acquire));
    assert_eq!(current_connection_generation(), original_generation + 1);
    assert!(ConnectionChangeGuard::begin().is_err());
    drop(first);
    assert!(!CONNECTION_CHANGE_IN_PROGRESS.load(Ordering::Acquire));
    drop(ConnectionChangeGuard::begin().unwrap());
}

#[test]
fn connection_changes_cross_the_cover_publication_barrier_before_generation_advance() {
    let source = include_str!("../library.rs");
    let begin = source.find("impl ConnectionChangeGuard").unwrap();
    let barrier = source[begin..]
        .find("cover_cache_publication_guard()")
        .unwrap();
    let advance = source[begin..]
        .find("advance_album_cache_connection_generation()")
        .unwrap();
    let revoke = source[begin..].find("revoke_cover_art_access(").unwrap();
    assert!(barrier < advance && advance < revoke);
}

#[test]
fn failed_album_cache_clear_stays_durably_invalidated_until_retry_succeeds() {
    let path = temporary_album_metadata_cache_path("failed-clear-invalidation");
    let marker_path = path
        .parent()
        .unwrap()
        .join(ALBUM_METADATA_CACHE_INVALIDATION_FILE);
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

    assert_eq!(
        reset_album_metadata_cache_at(&marker_path, || Err("injected redb failure".into()))
            .unwrap(),
        AlbumMetadataCacheReset::Invalidated
    );
    assert!(album_metadata_cache_invalidated_at(&marker_path).unwrap());
    assert!(album_metadata_cache_access_allowed_at(&marker_path).is_err());
    assert!(
        read_persisted_album_tracks(&database, &cache_key, "album-1", now + 1)
            .unwrap()
            .is_some()
    );

    assert_eq!(
        reset_album_metadata_cache_at(&marker_path, || { clear_persisted_album_tracks(&database) })
            .unwrap(),
        AlbumMetadataCacheReset::Cleared
    );
    assert!(!album_metadata_cache_invalidated_at(&marker_path).unwrap());
    assert!(album_metadata_cache_access_allowed_at(&marker_path).is_ok());
    assert!(
        read_persisted_album_tracks(&database, &cache_key, "album-1", now + 1)
            .unwrap()
            .is_none()
    );

    drop(database);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn album_cache_reset_rejects_when_neither_clear_nor_invalidation_can_succeed() {
    let directory = temporary_album_metadata_cache_path("double-reset-failure")
        .parent()
        .unwrap()
        .to_path_buf();
    fs::create_dir_all(&directory).unwrap();
    let invalid_parent = directory.join("not-a-directory");
    fs::write(&invalid_parent, b"occupied").unwrap();
    let marker_path = invalid_parent.join(ALBUM_METADATA_CACHE_INVALIDATION_FILE);

    let error = reset_album_metadata_cache_at(&marker_path, || Err("injected redb failure".into()))
        .unwrap_err();
    assert!(error.contains("could not be cleared or invalidated"));

    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn disconnect_cleanup_reports_partial_failure_without_implying_credentials_remain() {
    assert_eq!(
        finish_disconnect_cache_cleanup(
            Ok(()),
            Ok(AlbumMetadataCacheReset::Cleared),
            Ok(CoverCacheReset::Cleared),
        ),
        None
    );
    let invalidated_cover_warning = finish_disconnect_cache_cleanup(
        Ok(()),
        Ok(AlbumMetadataCacheReset::Invalidated),
        Ok(CoverCacheReset::Invalidated),
    )
    .unwrap();
    assert!(invalidated_cover_warning.contains("cover artwork"));

    let album_warning = finish_disconnect_cache_cleanup(
        Ok(()),
        Err("cache reset failed".into()),
        Ok(CoverCacheReset::Cleared),
    )
    .unwrap();
    assert!(album_warning.contains("credentials were removed"));
    assert!(!album_warning.contains("Could not remove credentials"));

    let library_warning = finish_disconnect_cache_cleanup(
        Err("library reset failed".into()),
        Ok(AlbumMetadataCacheReset::Cleared),
        Ok(CoverCacheReset::Cleared),
    )
    .unwrap();
    assert!(library_warning.contains("credentials were removed"));
    assert!(!library_warning.contains("Could not remove credentials"));

    let cover_warning = finish_disconnect_cache_cleanup(
        Ok(()),
        Ok(AlbumMetadataCacheReset::Cleared),
        Err("artwork reset failed".into()),
    )
    .unwrap();
    assert!(cover_warning.contains("cover artwork"));
}

#[test]
fn forced_album_refresh_supersedes_older_cache_and_network_requests() {
    let _generation_test_guard = ALBUM_CACHE_GENERATION_TEST_LOCK.lock().unwrap();
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let album_id = format!("album-refresh-{suffix}");
    let connection_generation = current_connection_generation();
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
fn album_refresh_supersession_rolls_back_a_write_staged_before_commit() {
    let _generation_test_guard = ALBUM_CACHE_GENERATION_TEST_LOCK.lock().unwrap();
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let album_id = format!("album-commit-race-{suffix}");
    let refresh_generation = album_refresh_generation(&album_id).unwrap();
    let path = temporary_album_metadata_cache_path("commit-race");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: format!("generated-user-{suffix}"),
        password: "generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, &album_id);
    let mut track = sample_track("track-stale");
    track.album_id = album_id.clone();
    let now = 1_800_000_000_000;

    assert!(!write_persisted_album_tracks_with_before_commit(
        &database,
        &cache_key,
        &album_id,
        std::slice::from_ref(&track),
        now,
        AlbumCacheWriteExpectation::generations(None, Some((&album_id, refresh_generation))),
        || {
            assert_eq!(
                bump_album_refresh_generation(&album_id).unwrap(),
                refresh_generation + 1
            );
        },
    )
    .unwrap());
    assert!(
        read_persisted_album_tracks(&database, &cache_key, &album_id, now + 1)
            .unwrap()
            .is_none()
    );

    album_refresh_generations()
        .lock()
        .unwrap()
        .remove(&album_id);
    drop(database);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn connection_supersession_rolls_back_a_write_staged_before_commit() {
    let _generation_test_guard = ALBUM_CACHE_GENERATION_TEST_LOCK.lock().unwrap();
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let album_id = format!("album-connection-commit-race-{suffix}");
    let connection_generation = current_connection_generation();
    let path = temporary_album_metadata_cache_path("connection-commit-race");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: format!("generated-user-{suffix}"),
        password: "generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, &album_id);
    let mut track = sample_track("track-stale");
    track.album_id = album_id.clone();
    let now = 1_800_000_000_000;

    assert!(!write_persisted_album_tracks_with_before_commit(
        &database,
        &cache_key,
        &album_id,
        std::slice::from_ref(&track),
        now,
        AlbumCacheWriteExpectation::generations(Some(connection_generation), None),
        || drop(ConnectionChangeGuard::begin().unwrap()),
    )
    .unwrap());
    assert!(
        read_persisted_album_tracks(&database, &cache_key, &album_id, now + 1)
            .unwrap()
            .is_none()
    );

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
fn redb_discards_empty_album_metadata_entries() {
    let path = temporary_album_metadata_cache_path("empty-tracks");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: "generated-user".into(),
        password: "generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, "album-1");
    let now = 1_800_000_000_000;
    let empty_entry = serde_json::to_vec(&PersistedAlbumTracks {
        version: ALBUM_TRACK_CACHE_ENTRY_VERSION,
        saved_at: now,
        album_id: "album-1".into(),
        tracks: Vec::new(),
    })
    .unwrap();

    let transaction = database.begin_write().unwrap();
    {
        let mut table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        table
            .insert(cache_key.as_str(), empty_entry.as_slice())
            .unwrap();
    }
    transaction.commit().unwrap();

    assert!(
        read_persisted_album_tracks(&database, &cache_key, "album-1", now + 1)
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
fn a_stale_album_cache_prune_cannot_delete_a_concurrent_refresh() {
    let path = temporary_album_metadata_cache_path("stale-prune-race");
    let database = open_album_metadata_database(&path).unwrap();
    let credentials = ConnectionInput {
        username: "generated-user".into(),
        password: "generated-password".into(),
    };
    let album_id = "album-1";
    let cache_key = persisted_album_track_cache_key(&credentials, album_id);
    let now = 1_800_000_000_000;

    let transaction = database.begin_write().unwrap();
    {
        let mut table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        table
            .insert(cache_key.as_str(), b"{not-json".as_slice())
            .unwrap();
    }
    transaction.commit().unwrap();

    let mut refreshed_track = sample_track("track-refreshed");
    refreshed_track.album_id = album_id.into();
    assert!(read_persisted_album_tracks_with_before_prune(
        &database,
        &cache_key,
        album_id,
        now,
        || {
            assert!(write_persisted_album_tracks(
                &database,
                &cache_key,
                album_id,
                std::slice::from_ref(&refreshed_track),
                now,
                None,
                None,
            )
            .unwrap());
        },
    )
    .unwrap()
    .is_none());

    let restored = read_persisted_album_tracks(&database, &cache_key, album_id, now + 1)
        .unwrap()
        .expect("the concurrent refresh must survive a stale prune");
    assert_eq!(restored[0].id, refreshed_track.id);

    drop(database);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn corrupted_album_cache_files_are_recreated_fail_closed() {
    let path = temporary_album_metadata_cache_path("corruption-recovery");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"definitely-not-a-redb-database").unwrap();

    let database = open_album_metadata_database(&path).unwrap();
    let transaction = database.begin_read().unwrap();
    let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
    assert_eq!(table.len().unwrap(), 0);
    drop(table);
    drop(transaction);
    drop(database);

    fs::remove_dir_all(path.parent().unwrap()).unwrap();

    let truncated_path = temporary_album_metadata_cache_path("truncation-recovery");
    let database = open_album_metadata_database(&truncated_path).unwrap();
    let credentials = ConnectionInput {
        username: "generated-user".into(),
        password: "generated-password".into(),
    };
    let cache_key = persisted_album_track_cache_key(&credentials, "album-1");
    assert!(write_persisted_album_tracks(
        &database,
        &cache_key,
        "album-1",
        &[sample_track("track-1")],
        1_800_000_000_000,
        None,
        None,
    )
    .unwrap());
    drop(database);
    let database = open_album_metadata_database(&truncated_path).unwrap();
    assert!(
        read_persisted_album_tracks(&database, &cache_key, "album-1", 1_800_000_000_001,)
            .unwrap()
            .is_some()
    );
    drop(database);
    let file = fs::OpenOptions::new()
        .write(true)
        .open(&truncated_path)
        .unwrap();
    file.set_len(file.metadata().unwrap().len() / 2).unwrap();
    drop(file);

    let database = open_album_metadata_database(&truncated_path).unwrap();
    let transaction = database.begin_read().unwrap();
    let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
    assert_eq!(table.len().unwrap(), 0);
    drop(table);
    drop(transaction);
    drop(database);
    fs::remove_dir_all(truncated_path.parent().unwrap()).unwrap();
}

#[test]
fn album_cache_recovery_does_not_delete_operational_failures() {
    let path = temporary_album_metadata_cache_path("operational-open-error");
    fs::create_dir_all(&path).unwrap();

    assert!(open_album_metadata_database(&path).is_err());
    assert!(path.is_dir());

    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn impossible_redb_header_layouts_are_recreated_without_entering_redb() {
    let source_path = temporary_album_metadata_cache_path("header-source");
    drop(open_album_metadata_database(&source_path).unwrap());
    let source = fs::read(&source_path).unwrap();
    let corruptions: [(&str, &[(usize, u32)]); 6] = [
        ("zero-page-size", &[(12, 0)]),
        ("zero-region-capacity", &[(20, 0)]),
        ("no-regions", &[(24, 0), (28, 0)]),
        ("oversized-trailing-region", &[(20, 1), (28, 1)]),
        (
            "forged-length-consistent-layout",
            &[(16, 0), (20, 1), (24, 257), (28, 0)],
        ),
        (
            "overflowing-region-count",
            &[(16, u32::MAX), (24, u32::MAX)],
        ),
    ];

    for (label, fields) in corruptions {
        let path = temporary_album_metadata_cache_path(label);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut corrupted = source.clone();
        for (offset, value) in fields {
            corrupted[*offset..*offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        fs::write(&path, corrupted).unwrap();

        let database = open_album_metadata_database(&path).unwrap();
        let transaction = database.begin_read().unwrap();
        let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        assert_eq!(table.len().unwrap(), 0, "{label}");
        drop(table);
        drop(transaction);
        drop(database);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    fs::remove_dir_all(source_path.parent().unwrap()).unwrap();
}

#[test]
fn redb_files_with_trailing_partial_pages_are_recreated_before_open() {
    for trailing_bytes in [1_usize, 2_047] {
        let path =
            temporary_album_metadata_cache_path(&format!("trailing-partial-page-{trailing_bytes}"));
        drop(open_album_metadata_database(&path).unwrap());
        let baseline_len = fs::metadata(&path).unwrap().len();

        let mut bytes = fs::read(&path).unwrap();
        bytes.extend(std::iter::repeat_n(0xa5, trailing_bytes));
        fs::write(&path, bytes).unwrap();

        let database = open_album_metadata_database(&path).unwrap();
        let transaction = database.begin_read().unwrap();
        let table = transaction.open_table(ALBUM_TRACKS_TABLE).unwrap();
        assert_eq!(table.len().unwrap(), 0);
        drop(table);
        drop(transaction);
        drop(database);
        assert_eq!(fs::metadata(&path).unwrap().len(), baseline_len);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
