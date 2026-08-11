use super::*;

#[test]
fn rejects_control_characters_in_credentials() {
    let input = ConnectionInput {
        username: "hello\nworld".into(),
        password: "secret".into(),
    };
    assert!(validate_credentials(&input).is_err());
    assert!(validate_credentials(&ConnectionInput {
        username: " generated-user ".into(),
        password: "secret".into(),
    })
    .is_err());
    assert!(validate_identifier(" album-1").is_err());

    assert!(
        serde_json::from_value::<ConnectionInput>(serde_json::json!({
            "username": "generated-user",
            "password": "secret",
            "unexpected": true
        }))
        .is_err()
    );
}

#[test]
fn constructs_only_bandcamp_https_urls() {
    let input = ConnectionInput {
        username: "fan".into(),
        password: "secret".into(),
    };
    let url = authenticated_url("ping", &input, &[]).unwrap();
    assert_eq!(url.scheme(), "https");
    assert_eq!(url.host_str(), Some("bandcamp.com"));
    assert_eq!(url.path(), "/api/subsonic/rest/ping.view");
    assert_eq!(
        url.query_pairs()
            .find_map(|(key, value)| (key == "v").then_some(value.into_owned())),
        Some("1.16.1".into())
    );
    assert!(!url.as_str().contains("secret"));
}

#[test]
fn remote_service_errors_expose_only_safe_numeric_codes() {
    assert_eq!(
        subsonic_error_message(&serde_json::json!({
            "error": { "code": 70, "message": "secret\nserver detail" }
        })),
        "Bandcamp rejected the request (error code 70)."
    );
    assert_eq!(
        subsonic_error_message(&serde_json::json!({
            "error": { "message": "generated-auth-token" }
        })),
        "Bandcamp rejected the request."
    );
}

#[test]
fn parses_flexible_numeric_fields() {
    let value = serde_json::json!({"duration": "42"});
    assert_eq!(number_field(&value, "duration"), Some(42));
}

#[test]
fn rejects_invalid_or_unbounded_album_metadata() {
    let parsed = bounded_album_from_value(&serde_json::json!({
        "id": "album-1",
        "name": "Soft Focus",
        "artist": "Night Archive",
        "songCount": 9,
        "duration": 2460,
        "coverArt": "cover-1",
        "created": "30 Jun 2025 12:00:00 GMT",
        "starred": "2025-07-01T12:00:00Z",
        "played": "2025-07-02T12:00:00Z",
        "originalReleaseDate": { "year": 2001 },
        "releaseDate": { "year": 2025, "month": 6, "day": 30 }
    }))
    .unwrap();
    assert_eq!(parsed.added_at.as_deref(), Some("30 Jun 2025 12:00:00 GMT"));
    assert_eq!(parsed.starred_at.as_deref(), Some("2025-07-01T12:00:00Z"));
    assert_eq!(parsed.played_at.as_deref(), Some("2025-07-02T12:00:00Z"));
    assert_eq!(
        parsed.original_release_date,
        Some(ItemDate {
            year: 2001,
            month: None,
            day: None,
        })
    );
    assert_eq!(
        parsed.release_date,
        Some(ItemDate {
            year: 2025,
            month: Some(6),
            day: Some(30),
        })
    );

    let invalid_optional_dates = bounded_album_from_value(&serde_json::json!({
        "id": "album-with-invalid-optional-dates",
        "name": "Still Playable",
        "artist": "Night Archive",
        "originalReleaseDate": {},
        "releaseDate": { "year": 2025, "month": 2, "day": 29 }
    }))
    .unwrap();
    assert!(invalid_optional_dates.original_release_date.is_none());
    assert!(invalid_optional_dates.release_date.is_none());
    let zero_date_components = bounded_album_from_value(&serde_json::json!({
        "id": "album-with-zero-date-components",
        "name": "Still Playable",
        "artist": "Night Archive",
        "originalReleaseDate": { "year": 0 },
        "releaseDate": { "year": 2025, "month": 0, "day": 0 }
    }))
    .unwrap();
    assert!(zero_date_components.original_release_date.is_none());
    assert!(zero_date_components.release_date.is_none());
    let invalid_text_dates = bounded_album_from_value(&serde_json::json!({
        "id": "album-with-invalid-text-dates",
        "name": "Still Playable",
        "artist": "Night Archive",
        "created": "2025-02-29T12:00:00Z",
        "starred": "not-a-date",
        "played": "2025-01-01T00:00:00+15:00"
    }))
    .unwrap();
    assert!(invalid_text_dates.added_at.is_none());
    assert!(invalid_text_dates.starred_at.is_none());
    assert!(invalid_text_dates.played_at.is_none());
    assert!(bounded_album_from_value(&serde_json::json!({
        "id": "bad\nid",
        "name": "Soft Focus",
        "artist": "Night Archive"
    }))
    .is_none());
    assert!(bounded_album_from_value(&serde_json::json!({
        "id": "album-1",
        "name": "Bad\nTitle",
        "artist": "Night Archive"
    }))
    .is_none());
    assert!(bounded_album_from_value(&serde_json::json!({
        "id": "album-1",
        "name": "Soft Focus",
        "artist": "Night Archive",
        "songCount": MAX_PLAYLIST_TRACKS as u64 + 1
    }))
    .is_none());
    assert!(bounded_album_from_value(&serde_json::json!({
        "id": "album-1",
        "name": "Soft Focus",
        "artist": "Night Archive",
        "duration": MAX_SUBSONIC_DURATION_SECONDS + 1
    }))
    .is_none());
    assert!(bounded_album_from_value(&serde_json::json!({
        "id": "album-1",
        "name": "Soft Focus",
        "artist": "Night Archive",
        "coverArt": "bad\ncover"
    }))
    .is_none());
}

#[cfg(target_os = "windows")]
#[test]
fn uses_the_native_windows_credential_backend() {
    let entry = credential_entry().unwrap();
    assert!(entry
        .get_credential()
        .downcast_ref::<keyring::windows::WinCredential>()
        .is_some());
}
