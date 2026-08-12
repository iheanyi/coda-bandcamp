use super::*;

#[test]
fn validates_discover_inputs() {
    assert!(validate_discover_input(&DiscoverInput {
        tag: "ambient".into(),
        sort: "top".into(),
        cursor: "*".into(),
    })
    .is_ok());
    assert!(validate_discover_input(&DiscoverInput {
        tag: "ambient".into(),
        sort: "oldest".into(),
        cursor: "*".into(),
    })
    .is_err());
}

#[test]
fn discover_urls_are_host_restricted() {
    assert!(allowed_url(
        "https://artist.bandcamp.com/album/example",
        UrlKind::BandcampPage
    )
    .is_some());
    assert!(allowed_url(
        "https://t4.bcbits.com/stream/example",
        UrlKind::BandcampMedia
    )
    .is_some());
    assert!(allowed_url("https://evil.example/album/example", UrlKind::BandcampPage).is_none());
    assert!(allowed_url(
        "http://artist.bandcamp.com/album/example",
        UrlKind::BandcampPage
    )
    .is_none());
    assert!(allowed_url(
        "https://user:password@artist.bandcamp.com/album/example",
        UrlKind::BandcampPage
    )
    .is_none());
    assert!(allowed_url(
        "https://artist.bandcamp.com:444/album/example",
        UrlKind::BandcampPage
    )
    .is_none());
    assert!(allowed_url(
        "https://artist.bandcamp.com:443/album/example",
        UrlKind::BandcampPage
    )
    .is_some());
}

#[test]
fn sanitizes_public_discover_metadata_and_drops_invalid_featured_tracks() {
    let raw: RawDiscoverRelease = serde_json::from_value(serde_json::json!({
        "item_id": 42,
        "title": "Bad\u{0000} title",
        "item_url": "https://artist.bandcamp.com/album/night-drive",
        "band_name": "Artist\u{0000}",
        "band_location": "x".repeat(MAX_METADATA_TEXT_LENGTH + 1),
        "genre": " Ambient ",
        "featured_track": {
            "id": 7,
            "title": "Headlights",
            "stream_url": "https://t4.bcbits.com/stream/example",
            "duration": MAX_MEDIA_SECONDS + 1.0
        }
    }))
    .unwrap();

    let release = discover_release_from_raw(raw).unwrap();
    assert_eq!(release.title, "Untitled release");
    assert_eq!(release.artist, "Unknown artist");
    assert_eq!(release.genre.as_deref(), Some("Ambient"));
    assert!(release.location.is_none());
    assert!(release.featured_track.is_none());
}

#[test]
fn parses_the_public_discover_shape() {
    let raw: RawDiscoverPage = serde_json::from_value(serde_json::json!({
        "results": [{
            "item_id": 42,
            "title": "Night Drive",
            "item_url": "https://artist.bandcamp.com/album/night-drive?from=discover_page",
            "band_name": "Artist",
            "band_location": "Chicago, Illinois",
            "primary_image": { "image_id": 99 },
            "featured_track": {
                "id": 7,
                "title": "Headlights",
                "stream_url": "https://t4.bcbits.com/stream/example",
                "duration": 183.5
            }
        }],
        "result_count": 1,
        "cursor": "next"
    }))
    .unwrap();
    let release = discover_release_from_raw(raw.results.into_iter().next().unwrap()).unwrap();
    assert_eq!(release.id, "discover:42");
    assert_eq!(release.artist, "Artist");
    assert_eq!(release.featured_track.unwrap().duration, 184);
    assert_eq!(
        release.artwork_url.as_deref(),
        Some("https://f4.bcbits.com/img/a99_10.jpg")
    );
}

fn raw_discover_release_with_id(item_id: Value) -> RawDiscoverRelease {
    serde_json::from_value(serde_json::json!({
        "item_id": item_id,
        "title": "Night Drive",
        "item_url": "https://artist.bandcamp.com/album/night-drive",
        "band_name": "Artist"
    }))
    .unwrap()
}

#[test]
fn discover_release_ids_match_the_router_opaque_id_contract() {
    const PREFIX: &str = "discover:";

    let boundary_raw = format!("{}a", "é".repeat(251));
    assert_eq!(
        boundary_raw.len(),
        MAX_DISCOVER_OPAQUE_ID_LENGTH - PREFIX.len()
    );
    let boundary =
        discover_release_from_raw(raw_discover_release_with_id(Value::String(boundary_raw)))
            .unwrap();
    assert_eq!(boundary.id.len(), MAX_DISCOVER_OPAQUE_ID_LENGTH);

    for invalid in [
        Value::Null,
        Value::Bool(true),
        Value::String(String::new()),
        Value::String(" release-1".into()),
        Value::String("release-1 ".into()),
        Value::String("release\u{0000}1".into()),
        Value::String("x".repeat(MAX_DISCOVER_OPAQUE_ID_LENGTH - PREFIX.len() + 1)),
        Value::String("é".repeat(252)),
    ] {
        assert!(discover_release_from_raw(raw_discover_release_with_id(invalid)).is_none());
    }
}
