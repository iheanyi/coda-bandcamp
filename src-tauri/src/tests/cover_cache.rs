use super::*;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::http::Method;
use tokio::sync::Mutex as AsyncMutex;

fn cache_entry(key: &str, revision: &str, bytes: u64, accessed_at: u64) -> CoverCacheEntry {
    CoverCacheEntry {
        key: key.into(),
        revision: revision.into(),
        media_type: "image/png".into(),
        extension: "png".into(),
        byte_length: bytes,
        width: 600,
        height: 600,
        validated_at: 1_800_000_000_000,
        last_access_at: accessed_at,
    }
}

fn hash(character: char) -> String {
    std::iter::repeat_n(character, 64).collect()
}

fn valid_png(byte_length: usize) -> Vec<u8> {
    let mut png = vec![0_u8; byte_length.max(24)];
    png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    png[12..16].copy_from_slice(b"IHDR");
    png[16..20].copy_from_slice(&600_u32.to_be_bytes());
    png[20..24].copy_from_slice(&600_u32.to_be_bytes());
    png
}

fn response_from_server(
    headers: &str,
    body: Vec<u8>,
) -> (reqwest::Response, std::thread::JoinHandle<()>) {
    response_from_server_with_status("200 OK", headers, body)
}

fn response_from_server_with_status(
    status: &str,
    headers: &str,
    body: Vec<u8>,
) -> (reqwest::Response, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let response_head = format!("HTTP/1.1 {status}\r\n{headers}Connection: close\r\n\r\n");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 1_024];
        let _ = stream.read(&mut request);
        stream.write_all(response_head.as_bytes()).unwrap();
        let _ = stream.write_all(&body);
    });
    let response = tauri::async_runtime::block_on(async move {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap()
    });
    (response, server)
}

#[test]
fn cover_keys_are_domain_separated_and_hide_identifiers() {
    let first = cover_cache_key("ca:496796527").unwrap();
    let second = cover_cache_key("ca:496796528").unwrap();
    assert_eq!(first.len(), 64);
    assert_ne!(first, second);
    assert!(!first.contains("496796527"));

    let mut expected = Sha256::new();
    expected.update(b"v1/getCoverArt/600/ca:496796527");
    assert_eq!(first, format!("{:x}", expected.finalize()));
}

#[test]
fn cover_request_is_pinned_to_the_fixed_bandcamp_endpoint_and_size() {
    let credentials = ConnectionInput {
        username: "generated-user".into(),
        password: "generated-password".into(),
    };
    let url = cover_art_url("cover-id", &credentials).unwrap();
    assert_eq!(url.scheme(), "https");
    assert_eq!(url.host_str(), Some("bandcamp.com"));
    assert_eq!(url.path(), "/api/subsonic/rest/getCoverArt.view");
    let query = url.query_pairs().collect::<HashMap<_, _>>();
    assert_eq!(
        query.get("id").map(|value| value.as_ref()),
        Some("cover-id")
    );
    assert_eq!(query.get("size").map(|value| value.as_ref()), Some("600"));
    assert!(!url.as_str().contains("generated-password"));
}

#[test]
fn index_serialization_is_bounded_and_contains_no_credentials_or_urls() {
    let key = cover_cache_key("cover-private").unwrap();
    let mut index = CoverCacheIndex::default();
    index
        .entries
        .insert(key.clone(), cache_entry(&key, &hash('a'), 2_048, 10));
    let serialized = serialize_index(&index).unwrap();
    let text = String::from_utf8(serialized).unwrap();
    assert!(!text.contains("cover-private"));
    assert!(!text.contains("password"));
    assert!(!text.contains("token"));
    assert!(!text.contains("salt"));
    assert!(!text.contains("https://"));
    assert!(!text.contains('?'));
}

#[test]
fn index_rejects_entry_and_payload_overflow() {
    let mut too_many = CoverCacheIndex::default();
    for index in 0..=MAX_COVER_CACHE_ENTRIES {
        let key = format!("{index:064x}");
        too_many
            .entries
            .insert(key.clone(), cache_entry(&key, &hash('b'), 1, 10));
    }
    assert!(validate_index(&too_many).is_err());

    let key = hash('c');
    let mut too_large = CoverCacheIndex::default();
    too_large.entries.insert(
        key.clone(),
        cache_entry(&key, &hash('d'), MAX_COVER_CACHE_BYTES + 1, 10),
    );
    assert!(validate_index(&too_large).is_err());
}

#[test]
fn deterministic_lru_uses_key_order_for_equal_access_times_and_skips_leases() {
    let first = hash('1');
    let second = hash('2');
    let third = hash('3');
    let mut index = CoverCacheIndex::default();
    index.entries.insert(
        first.clone(),
        cache_entry(&first, &hash('a'), MAX_COVER_CACHE_BYTES / 2, 5),
    );
    index.entries.insert(
        second.clone(),
        cache_entry(&second, &hash('b'), MAX_COVER_CACHE_BYTES / 2, 5),
    );
    index
        .entries
        .insert(third.clone(), cache_entry(&third, &hash('c'), 1, 8));
    let runtime = CoverCacheRuntime {
        generation: 0,
        authorized_ids: HashSet::new(),
        index,
        leases: HashMap::from([(first.clone(), 1)]),
        dirty_touches: 0,
        hit_count: 0,
        miss_count: 0,
        stale_count: 0,
        cleanup_pending: false,
    };

    assert_eq!(
        select_evictions(&runtime, &hash('9'), 2).unwrap(),
        vec![second]
    );
}

#[test]
fn authorization_is_scoped_to_the_exact_connection_generation_and_cleanup_state() {
    let mut runtime = CoverCacheRuntime {
        generation: 7,
        authorized_ids: HashSet::from(["cover-1".into()]),
        index: CoverCacheIndex::default(),
        leases: HashMap::new(),
        dirty_touches: 0,
        hit_count: 0,
        miss_count: 0,
        stale_count: 0,
        cleanup_pending: false,
    };
    assert!(runtime_authorizes(&runtime, "cover-1", 7, 7));
    assert!(!runtime_authorizes(&runtime, "cover-2", 7, 7));
    assert!(!runtime_authorizes(&runtime, "cover-1", 7, 8));
    runtime.cleanup_pending = true;
    assert!(!runtime_authorizes(&runtime, "cover-1", 7, 7));
}

#[test]
fn authorization_rejects_connection_changes_and_credential_replacement() {
    let runtime = CoverCacheRuntime {
        generation: 7,
        authorized_ids: HashSet::new(),
        index: CoverCacheIndex::default(),
        leases: HashMap::new(),
        dirty_touches: 0,
        hit_count: 0,
        miss_count: 0,
        stale_count: 0,
        cleanup_pending: false,
    };
    let expected = ConnectionInput {
        username: "first-account".into(),
        password: "first-password".into(),
    };
    let replacement = ConnectionInput {
        username: "replacement-account".into(),
        password: "replacement-password".into(),
    };

    assert!(authorization_is_current(
        &runtime,
        7,
        7,
        false,
        &expected,
        Some(&expected),
    ));
    assert!(!authorization_is_current(
        &runtime,
        7,
        7,
        true,
        &expected,
        Some(&expected),
    ));
    assert!(!authorization_is_current(
        &runtime,
        7,
        8,
        false,
        &expected,
        Some(&expected),
    ));
    assert!(!authorization_is_current(
        &runtime,
        7,
        7,
        false,
        &expected,
        Some(&replacement),
    ));
}

#[test]
fn publication_rejects_disconnect_and_account_replacement_races() {
    let runtime = CoverCacheRuntime {
        generation: 11,
        authorized_ids: HashSet::from(["cover-1".into()]),
        index: CoverCacheIndex::default(),
        leases: HashMap::new(),
        dirty_touches: 0,
        hit_count: 0,
        miss_count: 0,
        stale_count: 0,
        cleanup_pending: false,
    };
    let first = ConnectionInput {
        username: "first-account".into(),
        password: "first-password".into(),
    };
    let replacement = ConnectionInput {
        username: "replacement-account".into(),
        password: "replacement-password".into(),
    };
    assert!(publication_is_current(
        &runtime,
        "cover-1",
        11,
        &first,
        Some(&first),
    ));
    assert!(!publication_is_current(
        &runtime, "cover-1", 12, &first, None,
    ));
    assert!(!publication_is_current(
        &runtime,
        "cover-1",
        11,
        &first,
        Some(&replacement),
    ));
}

#[test]
fn freshness_and_content_revisions_change_only_with_validated_bytes() {
    let mut entry = cache_entry(&hash('4'), &hash('5'), 2_048, 10);
    entry.validated_at = 1_000;
    assert!(!entry_is_stale(&entry, 1_000 + COVER_ART_FRESH_MS - 1));
    assert!(entry_is_stale(&entry, 1_000 + COVER_ART_FRESH_MS));
    assert_eq!(content_revision(b"same"), content_revision(b"same"));
    assert_ne!(content_revision(b"same"), content_revision(b"changed"));
}

#[test]
fn completed_key_work_is_removed_but_live_waiters_keep_the_deduplication_lock() {
    let key = hash('6');
    let lock = Arc::new(AsyncMutex::new(()));
    let locks = Mutex::new(HashMap::from([(key.clone(), lock.clone())]));
    let waiter = lock.clone();
    release_key_lock(&locks, &key, &lock).unwrap();
    assert!(locks.lock().unwrap().contains_key(&key));
    drop(waiter);
    release_key_lock(&locks, &key, &lock).unwrap();
    assert!(!locks.lock().unwrap().contains_key(&key));
}

#[test]
fn authorized_warm_disk_hits_do_not_invoke_the_authenticated_fetch_path() {
    let root = temporary_player_state_path("cover-cache-warm-hit")
        .parent()
        .unwrap()
        .to_path_buf();
    let cache_directory = root.join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&cache_directory).unwrap();
    let cover_art_id = "warm-cover";
    let key = cover_cache_key(cover_art_id).unwrap();
    let bytes = valid_png(24);
    let entry = cache_entry(&key, &hash('a'), bytes.len() as u64, 10);
    fs::write(cache_directory.join(entry_file_name(&entry)), &bytes).unwrap();

    let generation = current_connection_generation();
    let mut index = CoverCacheIndex::default();
    index.entries.insert(key, entry);
    let state = cover_cache_state_for_test(
        cache_directory,
        root.join(COVER_CACHE_INVALIDATION_FILE),
        generation,
        HashSet::from([cover_art_id.into()]),
        index,
    );
    let fetch_calls = Arc::new(AtomicUsize::new(0));
    let observed_fetch_calls = fetch_calls.clone();

    let (resolved, stale) = tauri::async_runtime::block_on(resolve_cover_art_from_state(
        state,
        cover_art_id,
        generation,
        move || async move {
            observed_fetch_calls.fetch_add(1, Ordering::SeqCst);
            Err("The authenticated fetch path must not run for a warm hit.".into())
        },
    ))
    .unwrap();

    assert_eq!(resolved.bytes, bytes);
    assert!(!stale);
    assert_eq!(fetch_calls.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn authorized_cache_misses_invoke_the_authenticated_fetch_path_once() {
    let root = temporary_player_state_path("cover-cache-miss")
        .parent()
        .unwrap()
        .to_path_buf();
    let cache_directory = root.join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&cache_directory).unwrap();
    let cover_art_id = "missing-cover";
    let generation = current_connection_generation();
    let state = cover_cache_state_for_test(
        cache_directory,
        root.join(COVER_CACHE_INVALIDATION_FILE),
        generation,
        HashSet::from([cover_art_id.into()]),
        CoverCacheIndex::default(),
    );
    let fetch_calls = Arc::new(AtomicUsize::new(0));
    let observed_fetch_calls = fetch_calls.clone();
    let expected_bytes = valid_png(24);
    let fetched_bytes = expected_bytes.clone();

    let (resolved, stale) = tauri::async_runtime::block_on(resolve_cover_art_from_state(
        state,
        cover_art_id,
        generation,
        move || async move {
            observed_fetch_calls.fetch_add(1, Ordering::SeqCst);
            Ok(ResolvedCoverArt {
                bytes: fetched_bytes,
                media_type: "image/png".into(),
                revision: hash('b'),
            })
        },
    ))
    .unwrap();

    assert_eq!(resolved.bytes, expected_bytes);
    assert!(!stale);
    assert_eq!(fetch_calls.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unauthorized_cover_ids_never_reach_disk_or_authenticated_fetching() {
    let root = temporary_player_state_path("cover-cache-unauthorized")
        .parent()
        .unwrap()
        .to_path_buf();
    let cache_directory = root.join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&cache_directory).unwrap();
    let generation = current_connection_generation();
    let state = cover_cache_state_for_test(
        cache_directory,
        root.join(COVER_CACHE_INVALIDATION_FILE),
        generation,
        HashSet::new(),
        CoverCacheIndex::default(),
    );
    let fetch_calls = Arc::new(AtomicUsize::new(0));
    let observed_fetch_calls = fetch_calls.clone();

    let error = tauri::async_runtime::block_on(resolve_cover_art_from_state(
        state,
        "unauthorized-cover",
        generation,
        move || async move {
            observed_fetch_calls.fetch_add(1, Ordering::SeqCst);
            Err("The authenticated fetch path must remain unreachable.".into())
        },
    ))
    .unwrap_err();

    assert!(error.contains("not authorized"));
    assert_eq!(fetch_calls.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn protocol_accepts_only_fixed_get_and_head_routes() {
    let get = parse_cover_protocol_request(
        &Method::GET,
        "/v1/600/ca%3A496796527?v=revision_1&s=0123456789abcdef0123456789abcdef",
    )
    .unwrap();
    assert_eq!(get.cover_art_id, "ca:496796527");
    assert_eq!(get.revision, "revision_1");
    assert_eq!(get.session_scope, "0123456789abcdef0123456789abcdef");
    assert!(!get.head);

    let head = parse_cover_protocol_request(
        &Method::HEAD,
        "/v1/600/cover?v=0&s=fedcba9876543210fedcba9876543210",
    )
    .unwrap();
    assert!(head.head);
    assert_eq!(
        parse_cover_protocol_request(
            &Method::POST,
            "/v1/600/cover?v=0&s=0123456789abcdef0123456789abcdef",
        ),
        Err(StatusCode::METHOD_NOT_ALLOWED)
    );
    for invalid in [
        "/v2/600/cover?v=0&s=0123456789abcdef0123456789abcdef",
        "/v1/300/cover?v=0&s=0123456789abcdef0123456789abcdef",
        "/v1/600/../secret?v=0&s=0123456789abcdef0123456789abcdef",
        "/v1/600/cover",
        "/v1/600/cover?v=0",
        "/v1/600/cover?s=0123456789abcdef0123456789abcdef",
        "/v1/600/cover?v=0&v=1",
        "/v1/600/cover?v=0&s=0123456789abcdef0123456789abcdef&s=duplicate",
        "/v1/600/cover?v=../bad&s=0123456789abcdef0123456789abcdef",
        "/v1/600/cover?v=0&s=../bad",
        "/v1/600/%0A?v=0&s=0123456789abcdef0123456789abcdef",
    ] {
        assert!(parse_cover_protocol_request(&Method::GET, invalid).is_err());
    }
}

#[test]
fn successful_protocol_responses_are_immutable_within_the_session_scope() {
    let response = cover_protocol_success_response(
        ResolvedCoverArt {
            bytes: vec![1, 2, 3],
            media_type: "image/png".into(),
            revision: hash('a'),
        },
        false,
    );
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("cache-control").unwrap(),
        "private, max-age=31536000, immutable"
    );
    assert_eq!(response.body(), &[1, 2, 3]);

    let head = cover_protocol_success_response(
        ResolvedCoverArt {
            bytes: vec![1, 2, 3],
            media_type: "image/png".into(),
            revision: hash('a'),
        },
        true,
    );
    assert!(head.body().is_empty());
    assert_eq!(head.headers().get("content-length").unwrap(), "3");
}

#[test]
fn image_validation_requires_matching_supported_container_and_safe_dimensions() {
    let mut png = vec![0_u8; 24];
    png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    png[12..16].copy_from_slice(b"IHDR");
    png[16..20].copy_from_slice(&600_u32.to_be_bytes());
    png[20..24].copy_from_slice(&600_u32.to_be_bytes());
    assert_eq!(
        validate_image(&png, CoverMediaType::Png).unwrap(),
        (600, 600)
    );
    assert!(validate_image(&png, CoverMediaType::Jpeg).is_err());

    png[16..20].copy_from_slice(&4_097_u32.to_be_bytes());
    assert!(validate_image(&png, CoverMediaType::Png).is_err());
    assert!(validate_image(b"<html>", CoverMediaType::Webp).is_err());
    assert_eq!(
        media_type_from_header("image/jpeg"),
        Some(CoverMediaType::Jpeg)
    );
    assert_eq!(media_type_from_header("image/jpg"), None);
}

#[test]
fn cover_response_validation_accepts_missing_length_and_the_exact_five_mib_boundary() {
    let (missing_length, server) =
        response_from_server("Content-Type: image/png\r\n", valid_png(24));
    let result = tauri::async_runtime::block_on(validate_cover_response(missing_length)).unwrap();
    server.join().unwrap();
    assert_eq!(result.2, 600);
    assert_eq!(result.3, 600);

    let exact = valid_png(MAX_COVER_ART_BYTES);
    let exact_length = exact.len();
    let (response, server) = response_from_server(
        &format!("Content-Type: image/png\r\nContent-Length: {exact_length}\r\n"),
        exact,
    );
    let result = tauri::async_runtime::block_on(validate_cover_response(response)).unwrap();
    server.join().unwrap();
    assert_eq!(result.0.len(), MAX_COVER_ART_BYTES);
}

#[test]
fn cover_response_validation_rejects_length_mismatch_and_chunk_overflow() {
    let (truncated, server) = response_from_server(
        "Content-Type: image/png\r\nContent-Length: 25\r\n",
        valid_png(24),
    );
    assert!(tauri::async_runtime::block_on(validate_cover_response(truncated)).is_err());
    server.join().unwrap();

    let overflow = valid_png(MAX_COVER_ART_BYTES + 1);
    let chunked = "Content-Type: image/png\r\nTransfer-Encoding: chunked\r\n";
    let mut chunked_body = format!("{:x}\r\n", overflow.len()).into_bytes();
    chunked_body.extend_from_slice(&overflow);
    chunked_body.extend_from_slice(b"\r\n0\r\n\r\n");
    let (response, server) = response_from_server(chunked, chunked_body);
    assert!(tauri::async_runtime::block_on(validate_cover_response(response)).is_err());
    server.join().unwrap();
}

#[test]
fn cover_response_validation_rejects_redirects_without_exposing_locations() {
    let (response, server) = response_from_server_with_status(
        "302 Found",
        "Location: https://example.test/private?token=secret\r\nContent-Length: 0\r\n",
        Vec::new(),
    );
    let error = tauri::async_runtime::block_on(validate_cover_response(response)).unwrap_err();
    server.join().unwrap();
    assert_eq!(error, "Bandcamp cover artwork redirected unexpectedly.");
    assert!(!error.contains("example.test"));
    assert!(!error.contains("secret"));
}

#[test]
fn cover_fetch_follows_a_bounded_https_bandcamp_redirect_chain() {
    for (target, hop) in [
        ("https://f4.bcbits.com/img/a123_10.jpg?token=ephemeral", 1),
        ("https://bandcamp.com/api/subsonic/another-hop", 2),
        ("https://bcbits.com/img/a123_10.jpg", 10),
    ] {
        assert!(cover_redirect_target_is_allowed(
            &url::Url::parse(target).unwrap(),
            hop,
        ));
    }

    for rejected in [
        "http://f4.bcbits.com/img/a123_10.jpg",
        "https://user@f4.bcbits.com/img/a123_10.jpg",
        "https://f4.bcbits.com:444/img/a123_10.jpg",
        "https://bcbits.com.example.test/img/a123_10.jpg",
        "https://example.test/img/a123_10.jpg",
    ] {
        assert!(!cover_redirect_target_is_allowed(
            &url::Url::parse(rejected).unwrap(),
            1,
        ));
    }
    assert!(!cover_redirect_target_is_allowed(
        &url::Url::parse("https://f4.bcbits.com/img/a123_10.jpg").unwrap(),
        11,
    ));
    for credential_bearing in [
        "https://bandcamp.com/next?u=user",
        "https://bandcamp.com/next?t=token",
        "https://bandcamp.com/next?s=salt",
        "https://f4.bcbits.com/img/a123_10.jpg?t=subsonic-token",
    ] {
        assert!(!cover_redirect_target_is_allowed(
            &url::Url::parse(credential_bearing).unwrap(),
            1,
        ));
    }
    assert!(cover_redirect_target_is_allowed(
        &url::Url::parse("https://f4.bcbits.com/img/a123_10.jpg?s=cdn-signature&token=ephemeral")
            .unwrap(),
        1,
    ));
}

#[test]
fn foreground_cover_fetches_start_immediately_while_background_work_stays_coordinated() {
    assert!(!cover_request_uses_shared_coordinator(
        BandcampRequestPriority::Foreground
    ));
    assert!(cover_request_uses_shared_coordinator(
        BandcampRequestPriority::Background
    ));
}

#[test]
fn webp_and_jpeg_dimension_parsers_cover_supported_headers() {
    let mut webp = vec![0_u8; 30];
    webp[..4].copy_from_slice(b"RIFF");
    webp[8..12].copy_from_slice(b"WEBP");
    webp[12..16].copy_from_slice(b"VP8X");
    webp[24..27].copy_from_slice(&[0x57, 0x02, 0]);
    webp[27..30].copy_from_slice(&[0x57, 0x02, 0]);
    assert_eq!(webp_dimensions(&webp), Some((600, 600)));

    let jpeg = [
        0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x02, 0x58, 0x03, 0x01, 0x11, 0x00,
    ];
    assert_eq!(jpeg_dimensions(&jpeg), Some((600, 600)));
}

#[test]
fn cache_recovery_discards_corrupt_index_orphans_and_temporary_files() {
    let directory = temporary_player_state_path("cover-cache-recovery")
        .parent()
        .unwrap()
        .join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&directory).unwrap();
    let index_path = directory.join(COVER_CACHE_INDEX_FILE);
    fs::write(&index_path, b"not-json").unwrap();
    fs::write(directory.join("orphan.jpg"), b"orphan").unwrap();
    fs::write(directory.join("abandoned.tmp"), b"temporary").unwrap();

    let recovered = load_and_repair_index(&directory, &index_path).unwrap();
    assert!(recovered.entries.is_empty());
    assert!(!directory.join("orphan.jpg").exists());
    assert!(!directory.join("abandoned.tmp").exists());
    fs::remove_dir_all(directory.parent().unwrap()).unwrap();
}

#[test]
fn cache_initialization_fails_closed_and_recovers_after_repair_io_failure() {
    let root = temporary_player_state_path("cover-cache-fail-closed-init")
        .parent()
        .unwrap()
        .to_path_buf();
    fs::create_dir_all(&root).unwrap();
    let blocked_parent = root.join("blocked-parent");
    fs::write(&blocked_parent, b"not-a-directory").unwrap();
    let cache_directory = blocked_parent.join(COVER_CACHE_DIRECTORY);
    let index_path = cache_directory.join(COVER_CACHE_INDEX_FILE);
    let invalidation_path = root.join(COVER_CACHE_INVALIDATION_FILE);

    let (index, cleanup_pending) =
        initialize_cache_index(&cache_directory, &index_path, &invalidation_path);
    assert!(index.entries.is_empty());
    assert!(cleanup_pending);
    assert!(invalidation_path.exists());

    fs::remove_file(&blocked_parent).unwrap();
    let (index, cleanup_pending) =
        initialize_cache_index(&cache_directory, &index_path, &invalidation_path);
    assert!(index.entries.is_empty());
    assert!(!cleanup_pending);
    assert!(cache_directory.is_dir());
    assert!(!invalidation_path.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cache_index_replacement_and_recovery_handle_missing_files_and_oversized_indexes() {
    let root = temporary_player_state_path("cover-cache-index-recovery")
        .parent()
        .unwrap()
        .to_path_buf();
    let directory = root.join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&directory).unwrap();
    let index_path = directory.join(COVER_CACHE_INDEX_FILE);
    let key = hash('7');
    let entry = cache_entry(&key, &hash('8'), 24, 10);
    let mut index = CoverCacheIndex::default();
    index.entries.insert(key, entry);
    write_index(&index_path, &index).unwrap();

    let recovered = load_and_repair_index(&directory, &index_path).unwrap();
    assert!(recovered.entries.is_empty());
    assert_eq!(
        read_index(&index_path).unwrap(),
        Some(CoverCacheIndex::default())
    );

    fs::write(&index_path, vec![b' '; MAX_COVER_CACHE_INDEX_BYTES + 1]).unwrap();
    let recovered = load_and_repair_index(&directory, &index_path).unwrap();
    assert!(recovered.entries.is_empty());
    assert!(!index_path.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn index_rejects_mismatched_keys_and_atomic_replacement_keeps_the_latest_revision() {
    let first_key = hash('9');
    let second_key = hash('a');
    let mut mismatched = CoverCacheIndex::default();
    mismatched.entries.insert(
        first_key.clone(),
        cache_entry(&second_key, &hash('b'), 24, 10),
    );
    assert!(validate_index(&mismatched).is_err());

    let root = temporary_player_state_path("cover-cache-atomic-index")
        .parent()
        .unwrap()
        .to_path_buf();
    fs::create_dir_all(&root).unwrap();
    let path = root.join(COVER_CACHE_INDEX_FILE);
    let mut first = CoverCacheIndex::default();
    first.entries.insert(
        first_key.clone(),
        cache_entry(&first_key, &hash('c'), 24, 10),
    );
    write_index(&path, &first).unwrap();
    let mut second = first.clone();
    second.entries.get_mut(&first_key).unwrap().revision = hash('d');
    write_index(&path, &second).unwrap();
    assert_eq!(read_index(&path).unwrap(), Some(second));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn cache_recovery_does_not_follow_symlinked_payloads() {
    use std::os::unix::fs::symlink;

    let root = temporary_player_state_path("cover-cache-symlink")
        .parent()
        .unwrap()
        .to_path_buf();
    let directory = root.join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&directory).unwrap();
    let outside = root.join("outside.png");
    fs::write(&outside, b"outside").unwrap();
    let key = hash('e');
    let entry = cache_entry(&key, &hash('f'), 7, 10);
    symlink(&outside, directory.join(entry_file_name(&entry))).unwrap();
    let mut index = CoverCacheIndex::default();
    index.entries.insert(key, entry);
    write_index(&directory.join(COVER_CACHE_INDEX_FILE), &index).unwrap();

    let recovered =
        load_and_repair_index(&directory, &directory.join(COVER_CACHE_INDEX_FILE)).unwrap();
    assert!(recovered.entries.is_empty());
    assert_eq!(fs::read(&outside).unwrap(), b"outside");
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn cache_recovery_does_not_follow_a_symlinked_index() {
    use std::os::unix::fs::symlink;

    let root = temporary_player_state_path("cover-cache-index-symlink")
        .parent()
        .unwrap()
        .to_path_buf();
    let directory = root.join(COVER_CACHE_DIRECTORY);
    fs::create_dir_all(&directory).unwrap();
    let outside = root.join("outside-index.json");
    fs::write(
        &outside,
        serialize_index(&CoverCacheIndex::default()).unwrap(),
    )
    .unwrap();
    symlink(&outside, directory.join(COVER_CACHE_INDEX_FILE)).unwrap();

    let recovered =
        load_and_repair_index(&directory, &directory.join(COVER_CACHE_INDEX_FILE)).unwrap();
    assert!(recovered.entries.is_empty());
    assert_eq!(
        fs::read(&outside).unwrap(),
        serialize_index(&CoverCacheIndex::default()).unwrap(),
    );
    fs::remove_dir_all(root).unwrap();
}
