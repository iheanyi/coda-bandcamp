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
