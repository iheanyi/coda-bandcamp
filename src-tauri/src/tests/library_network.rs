use super::*;

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
fn request_errors_do_not_expose_request_urls_or_query_secrets() {
    let secret = "generated-auth-token";
    let error = tauri::async_runtime::block_on(async {
        crate::network::client_builder()
            .connect_timeout(Duration::from_millis(100))
            .timeout(Duration::from_millis(250))
            .build()
            .unwrap()
            .get(format!("https://127.0.0.1:1/?t={secret}&s=salt"))
            .send()
            .await
            .unwrap_err()
    });
    assert!(error.url().is_some());

    let message = redacted_request_error("Bandcamp", error);
    assert!(!message.contains(secret));
    assert!(!message.contains("127.0.0.1"));
    assert!(!message.contains("s=salt"));
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
