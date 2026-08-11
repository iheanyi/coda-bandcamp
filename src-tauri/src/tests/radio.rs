use super::*;

#[test]
fn parses_and_bounds_public_radio_metadata() {
    let summary = radio_summary_from_raw(RawRadioSummary {
        id: 979,
        subtitle: "  Kinrose  ".into(),
        desc: "A new\nshow".into(),
        published_date: "24 Jul 2026 00:00:00 GMT".into(),
        v2_image_id: Some(46_240_870),
        screen_image_id: None,
        image_id: None,
    })
    .unwrap();
    assert_eq!(summary.subtitle, "Kinrose");
    assert_eq!(summary.description, "A new show");
    assert_eq!(
        summary.artwork_url.as_deref(),
        Some("https://f4.bcbits.com/img/0046240870_10.jpg")
    );
    assert!(summary.series.is_none());

    let show = radio_show_from_raw(
        serde_json::from_value(serde_json::json!({
            "show_id": 979,
            "title": "The Hip Hop Show",
            "subtitle": "Kinrose",
            "desc": "Episode notes",
            "published_date": "24 Jul 2026 00:00:00 GMT",
            "show_v2_image_id": 46240870,
            "audio_duration": 4936.75,
            "audio_stream": {
                "mp3-128": "https://bandcamp.com/stream_redirect?enc=mp3-128"
            },
            "tracks": [{
                "title": "Example",
                "artist": "Artist",
                "album_title": "Album",
                "timecode": 92.4,
                "track_url": "https://artist.bandcamp.com/track/example",
                "album_url": "https://artist.bandcamp.com/album/example",
                "track_art_id": 12345,
                "url_hints": {
                    "subdomain": "artist"
                }
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(show.series, radio_series_by_id(5));
    assert_eq!(show.duration, 4937);
    assert_eq!(show.chapters.len(), 1);
    assert_eq!(show.chapters[0].timecode, 92);
    assert_eq!(
        show.chapters[0].artist_url.as_deref(),
        Some("https://artist.bandcamp.com/")
    );
    assert_eq!(
        show.chapters[0].album_url.as_deref(),
        Some("https://artist.bandcamp.com/album/example")
    );
    assert_eq!(
        show.chapters[0].artwork_url.as_deref(),
        Some("https://f4.bcbits.com/img/a12345_10.jpg")
    );
}

#[test]
fn parses_series_radio_pages_and_validates_opaque_cursors() {
    let series = radio_series_by_id(5).unwrap();
    let summary = radio_summary_from_series_raw(
        serde_json::from_value(serde_json::json!({
            "itemId": 979,
            "title": "Kinrose",
            "description": "Episode notes",
            "date": "24 Jul 2026 00:00:00 GMT",
            "imageId": 46240870,
            "franchiseName": "The Hip Hop Show"
        }))
        .unwrap(),
        None,
    )
    .unwrap();
    assert_eq!(summary.series, Some(series));
    assert_eq!(
        validate_radio_cursor(Some("1770336000:901".into())).unwrap(),
        Some("1770336000:901".into())
    );
    assert!(validate_radio_cursor(Some("../not-a-cursor".into())).is_err());
    assert!(validate_radio_cursor(Some("".into())).is_err());
    assert!(radio_series_by_id(3).is_none());
}

#[test]
fn rejects_untrusted_radio_chapter_links_and_url_hints() {
    let show = radio_show_from_raw(
        serde_json::from_value(serde_json::json!({
            "show_id": 979,
            "title": "The Hip Hop Show",
            "subtitle": "Kinrose",
            "audio_duration": 60,
            "audio_stream": {
                "mp3-128": "https://bandcamp.com/stream_redirect?enc=mp3-128"
            },
            "tracks": [{
                "title": "Example",
                "artist": "Artist",
                "album_title": "Album",
                "timecode": 0,
                "track_url": "https://evil.example/track/example",
                "album_url": "https://evil.example/album/example",
                "url_hints": {
                    "subdomain": "artist.evil.example"
                }
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    let chapter = &show.chapters[0];
    assert!(chapter.item_url.is_none());
    assert!(chapter.artist_url.is_none());
    assert!(chapter.album_url.is_none());
}

#[test]
fn rejects_untrusted_radio_stream_hosts() {
    let raw: RawRadioShow = serde_json::from_value(serde_json::json!({
        "show_id": 1,
        "title": "Bandcamp Radio",
        "subtitle": "Example",
        "audio_duration": 60,
        "audio_stream": { "mp3-128": "https://evil.example/show.mp3" }
    }))
    .unwrap();
    assert!(radio_show_from_raw(raw).is_err());
}
