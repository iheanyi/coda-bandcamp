use super::*;

fn daily_article_fixture(player_infos: Value) -> String {
    let player_infos = quick_xml::escape::escape(serde_json::to_string(&player_infos).unwrap());
    format!(
        r#"<!doctype html>
        <html><head>
          <script type="application/ld+json">{{
            "@context":"https://schema.org/",
            "@type":"Article",
            "@id":"https://daily.bandcamp.com/features/example-feature",
            "headline":"Example & Friends",
            "description":"A bounded description of the music.",
            "author":{{"@type":"Person","name":"Daily Writer"}},
            "datePublished":"2026-08-11T13:47:23Z",
            "image":"https://f4.bcbits.com/img/0046591813_0"
          }}</script>
        </head><body>
          <div id="p-daily-article" data-player-infos="{player_infos}"></div>
        </body></html>"#
    )
}

fn daily_player_info() -> Value {
    serde_json::json!({
        "player_id": "t716403166",
        "tralbum_key": "a3051071006",
        "featured_track_number": 2,
        "art_id": 1390769241,
        "band_name": "Example Artist",
        "band_url": "https://example-artist.bandcamp.com",
        "band_location": "Chicago, Illinois",
        "tralbum_url": "https://example-artist.bandcamp.com/album/example-album",
        "title": "Example Album",
        "parent_tralbum_type": "a",
        "parent_tralbum_id": 3051071006_u64,
        "tracklist": [{
            "track_id": 1801007541_u64,
            "track_title": "A First Track",
            "artist": "Example Artist",
            "art_id": 1390769241_u64,
            "album_id": 3051071006_u64,
            "streaming": 1,
            "audio_track_duration": 183.5,
            "audio_url": {
                "mp3-128": "https://t4.bcbits.com/stream/signed/mp3-128/1801007541?token=short-lived"
            },
            "track_number": 2
        }]
    })
}

#[test]
fn validates_and_maps_every_daily_section() {
    let expected = [
        ("lists", "/lists"),
        ("features", "/features"),
        ("album-of-the-day", "/album-of-the-day"),
        ("acid-test", "/acid-test"),
        ("bandcamp-navigator", "/bandcamp-navigator"),
        ("big-ups", "/big-ups"),
        ("certified", "/certified"),
        ("gallery", "/gallery"),
        ("hidden-gems", "/hidden-gems"),
        ("high-scores", "/high-scores"),
        ("label-profile", "/label-profile"),
        ("lifetime-achievement", "/lifetime-achievement"),
        ("resonance", "/resonance"),
        ("scene-report", "/scene-report"),
        ("essential-releases", "/essential-releases"),
        ("shortlist", "/shortlist"),
        ("the-merch-table", "/the-merch-table"),
        ("best-of-2026", "/best-of-2026"),
        ("best-of-2025", "/best-of-2025"),
        ("best-of-2024", "/best-of-2024"),
        ("best-of-2023", "/best-of-2023"),
        ("best-of-2022", "/best-of-2022"),
        ("best-of-2021", "/best-of-2021"),
        ("best-of-2020", "/best-of-2020"),
        ("best-of-2019", "/best-of-2019"),
        ("best-of-2018", "/best-of-2018"),
        ("best-of-2017", "/best-of-2017"),
        ("best-of-2016", "/best-of-2016"),
        ("best-ambient", "/best-ambient"),
        ("best-beat-tapes", "/best-beat-tapes"),
        ("best-dance-12s", "/best-dance-12s"),
        ("best-electronic", "/best-electronic"),
        ("best-experimental", "/best-experimental"),
        (
            "best-contemporary-classical",
            "/best-contemporary-classical",
        ),
        ("best-hip-hop", "/best-hip-hop"),
        ("best-jazz", "/best-jazz"),
        ("best-metal", "/best-metal"),
        ("best-punk", "/best-punk"),
        ("best-reissues", "/best-reissues"),
        ("best-soul", "/best-soul"),
        ("best-folk", "/best-folk"),
        ("best-field-recordings", "/best-field-recordings"),
        ("best-club-music", "/best-club-music"),
        ("best-country", "/best-country"),
        ("genre-alternative", "/genres/alternative"),
        ("genre-pop", "/genres/pop"),
        ("genre-world", "/genres/world"),
        ("genre-folk", "/genres/folk"),
        ("genre-hip-hop-rap", "/genres/hip-hop-rap"),
        ("genre-classical", "/genres/classical"),
        ("genre-experimental", "/genres/experimental"),
        ("genre-electronic", "/genres/electronic"),
        ("genre-rock", "/genres/rock"),
        ("genre-r-b-soul", "/genres/r-b-soul"),
        ("genre-comedy", "/genres/comedy"),
        ("genre-country", "/genres/country"),
        ("genre-soundtrack", "/genres/soundtrack"),
        ("genre-metal", "/genres/metal"),
        ("genre-jazz", "/genres/jazz"),
        ("genre-punk", "/genres/punk"),
        ("genre-reggae", "/genres/reggae"),
        ("genre-funk", "/genres/funk"),
        ("genre-ambient", "/genres/ambient"),
        ("genre-acoustic", "/genres/acoustic"),
        ("genre-blues", "/genres/blues"),
        ("genre-latin", "/genres/latin"),
        ("genre-devotional", "/genres/devotional"),
        ("genre-spoken-word", "/genres/spoken-word"),
        ("genre-podcasts", "/genres/podcasts"),
    ];
    assert_eq!(expected.len(), 69);
    assert_eq!(DAILY_SECTION_PATHS, expected);
    for (section, path) in expected {
        assert_eq!(daily_section_path(section).unwrap(), path);
    }
    assert!(daily_section_path("latest").is_err());
    assert_eq!(validate_daily_page(None).unwrap(), 1);
    assert_eq!(
        validate_daily_page(Some(MAX_DAILY_PAGE)).unwrap(),
        MAX_DAILY_PAGE
    );
    assert!(validate_daily_page(Some(0)).is_err());
    assert!(validate_daily_page(Some(MAX_DAILY_PAGE + 1)).is_err());
    assert_eq!(
        validate_daily_slug("music-from-everywhere-2").unwrap(),
        "music-from-everywhere-2"
    );
    for invalid in [
        "",
        "-leading",
        "trailing-",
        "two/slugs",
        "query?item=1",
        "under_score",
        "Uppercase",
    ] {
        assert!(validate_daily_slug(invalid).is_err());
    }
    assert!(validate_daily_slug(&"a".repeat(MAX_DAILY_SLUG_LENGTH + 1)).is_err());
    assert_eq!(
        validate_daily_article_section("underground-medicine").unwrap(),
        "underground-medicine"
    );
    assert!(validate_daily_article_section("genre/ambient").is_err());
    assert!(validate_daily_article_section("Features").is_err());
    assert!(
        validate_daily_article_section(&"a".repeat(MAX_DAILY_ARTICLE_SECTION_LENGTH + 1)).is_err()
    );
}

#[test]
fn parses_bounded_daily_listing_summaries_without_player_data() {
    let html = r#"
      <articles-list>
        <div class="list-article  ">
          <a class="thumb" href="/features/example-feature">
            <img src="https://f4.bcbits.com/img/0046591813_150.jpg">
          </a>
          <div class="article-info-text">
            <a class="franchise" href="/features">FEATURES</a>
            <span class="middot">·</span>
            August 11, 2026
          </div>
          <div class="title-wrapper">
            <a class="title" href="/features/example-feature">Example &amp; Friends</a>
          </div>
        </div>
        <div class="list-article">
          <a class="thumb" href="https://evil.example/features/untrusted">
            <img src="https://evil.example/cover.jpg">
          </a>
          <a class="title" href="https://evil.example/features/untrusted">Untrusted</a>
        </div>
      </articles-list>
      <a href="/features?page=2">Older posts</a>
      <div data-player-infos="signed-stream-must-not-be-read"></div>
    "#;

    let page = parse_daily_articles_html("features", 1, html);
    assert_eq!(page.results.len(), 1);
    let article = &page.results[0];
    assert_eq!(article.id, "daily-article:features:example-feature");
    assert_eq!(article.article_section, "features");
    let serialized = serde_json::to_value(article).unwrap();
    assert_eq!(serialized["articleSection"], "features");
    assert!(serialized.get("category").is_none());
    assert_eq!(article.title, "Example & Friends");
    assert_eq!(article.published_at.as_deref(), Some("2026-08-11"));
    assert_eq!(
        article.artwork_url.as_deref(),
        Some("https://f4.bcbits.com/img/0046591813_150.jpg")
    );
    assert_eq!(
        article.article_url,
        "https://daily.bandcamp.com/features/example-feature"
    );
    assert!(page.has_more);
}

#[test]
fn parses_daily_article_metadata_and_strict_ephemeral_music_ids() {
    let html = daily_article_fixture(serde_json::json!([daily_player_info()]));
    let article = parse_daily_article_html("features", "example-feature", &html).unwrap();

    assert_eq!(article.id, "daily-article:features:example-feature");
    assert_eq!(article.article_section, "features");
    assert_eq!(article.title, "Example & Friends");
    assert_eq!(
        article.description.as_deref(),
        Some("A bounded description of the music.")
    );
    assert_eq!(article.author.as_deref(), Some("Daily Writer"));
    assert_eq!(
        article.published_at.as_deref(),
        Some("2026-08-11T13:47:23Z")
    );
    assert_eq!(article.embeds.len(), 1);
    let embed = &article.embeds[0];
    assert_eq!(embed.id, "daily:features:a3051071006");
    assert_eq!(embed.location.as_deref(), Some("Chicago, Illinois"));
    assert_eq!(embed.featured_track_number, Some(2));
    assert_eq!(embed.tracks.len(), 1);
    let track = &embed.tracks[0];
    assert_eq!(track.id, "daily:features:a3051071006:1801007541");
    assert_eq!(track.album_id, embed.id);
    assert_eq!(track.duration, 184);
    assert_eq!(track.track, 2);
    assert!(track
        .stream_url
        .starts_with("https://t4.bcbits.com/stream/"));
}

#[test]
fn genre_listings_accept_mixed_actual_article_sections() {
    let html = r#"
      <articles-list>
        <div class="list-article">
          <div>August 11, 2026</div>
          <a class="title" href="/album-of-the-day/ambient-release-review">Album pick</a>
        </div>
        <div class="list-article">
          <div>August 10, 2026</div>
          <a class="title" href="https://daily.bandcamp.com/features/ambient-scene-feature">Scene feature</a>
        </div>
        <div class="list-article">
          <div>August 09, 2026</div>
          <a class="title" href="/left-behind-by-streaming/ambient-left-behind">Left behind</a>
        </div>
      </articles-list>
      <a href="/genres/ambient?page=2">Older</a>
    "#;

    let page = parse_daily_articles_html("genre-ambient", 1, html);
    assert_eq!(
        page.results
            .iter()
            .map(|article| article.article_section.as_str())
            .collect::<Vec<_>>(),
        ["album-of-the-day", "features", "left-behind-by-streaming",]
    );
    assert!(page.has_more);
}

#[test]
fn daily_listing_dates_are_extracted_from_varied_markup_and_sorted_stably() {
    let html = r#"
      <articles-list>
        <div class="list-article"><span>Published August 10, 2026</span><a class="title" href="/features/older">Older</a></div>
        <div class="list-article"><time>August 12, 2026</time><a class="title" href="/features/newer-first">Newer first</a></div>
        <div class="list-article"><p>No date supplied</p><a class="title" href="/features/missing-first">Missing first</a></div>
        <div class="list-article"><aside>August 12, 2026 · FEATURE</aside><a class="title" href="/features/newer-second">Newer second</a></div>
        <div class="list-article"><div>Notember 99, 2026</div><a class="title" href="/features/missing-second">Missing second</a></div>
      </articles-list>
    "#;

    let page = parse_daily_articles_html("features", 1, html);
    assert_eq!(
        page.results
            .iter()
            .map(|article| article.slug.as_str())
            .collect::<Vec<_>>(),
        [
            "newer-first",
            "newer-second",
            "older",
            "missing-first",
            "missing-second",
        ]
    );
    assert_eq!(
        page.results
            .iter()
            .map(|article| article.published_at.as_deref())
            .collect::<Vec<_>>(),
        [
            Some("2026-08-12"),
            Some("2026-08-12"),
            Some("2026-08-10"),
            None,
            None,
        ]
    );
}

#[test]
fn daily_article_paths_fail_closed() {
    for rejected in [
        "relative-section/slug",
        "/features",
        "/features/slug/extra",
        "/Features/slug",
        "/features/Uppercase",
        "/features/slug?query=1",
        "/features/slug#fragment",
        "/features/%2fescape",
        "https://evil.example/features/slug",
        "http://daily.bandcamp.com/features/slug",
        "https://user:pass@daily.bandcamp.com/features/slug",
    ] {
        assert!(
            daily_article_identity(rejected).is_none(),
            "accepted {rejected}"
        );
    }
    assert_eq!(
        daily_article_identity("/underground-medicine/underground-medicine-6"),
        Some((
            "underground-medicine".into(),
            "underground-medicine-6".into(),
            "https://daily.bandcamp.com/underground-medicine/underground-medicine-6".into(),
        ))
    );
}

#[test]
fn drops_untrusted_and_invalid_daily_music_fields() {
    let mut invalid_stream = daily_player_info();
    invalid_stream["tracklist"][0]["audio_url"]["mp3-128"] =
        Value::String("https://evil.example/private.mp3".into());
    let html = daily_article_fixture(serde_json::json!([invalid_stream]));
    assert!(
        parse_daily_article_html("features", "example-feature", &html)
            .unwrap()
            .embeds
            .is_empty()
    );

    let mut wrong_album = daily_player_info();
    wrong_album["tracklist"][0]["album_id"] = Value::from(999_u64);
    let html = daily_article_fixture(serde_json::json!([wrong_album]));
    assert!(
        parse_daily_article_html("features", "example-feature", &html)
            .unwrap()
            .embeds
            .is_empty()
    );

    let mut untrusted_item = daily_player_info();
    untrusted_item["tralbum_url"] = Value::String("https://evil.example/album/example".into());
    let html = daily_article_fixture(serde_json::json!([untrusted_item]));
    assert!(
        parse_daily_article_html("features", "example-feature", &html)
            .unwrap()
            .embeds
            .is_empty()
    );
}

#[test]
fn bounds_and_deduplicates_daily_embeds_and_tracks() {
    let duplicate = daily_player_info();
    let mut duplicate_with_another_track = daily_player_info();
    let mut another_track = duplicate_with_another_track["tracklist"][0].clone();
    another_track["track_id"] = Value::from(200_u64);
    another_track["track_title"] = Value::String("A Later Track".into());
    another_track["track_number"] = Value::from(3_u64);
    duplicate_with_another_track["tracklist"] = serde_json::json!([another_track]);
    let mut second = daily_player_info();
    second["parent_tralbum_id"] = Value::from(99_u64);
    second["tralbum_key"] = Value::String("a99".into());
    second["tracklist"][0]["album_id"] = Value::from(99_u64);
    second["tracklist"][0]["track_id"] = Value::from(100_u64);
    let html = daily_article_fixture(serde_json::json!([
        duplicate,
        duplicate_with_another_track,
        second
    ]));

    let article = parse_daily_article_html("features", "example-feature", &html).unwrap();
    assert_eq!(article.embeds.len(), 2);
    assert_eq!(article.embeds[0].id, "daily:features:a3051071006");
    assert_eq!(
        article.embeds[0]
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        [
            "daily:features:a3051071006:1801007541",
            "daily:features:a3051071006:200",
        ]
    );
    assert_eq!(article.embeds[1].id, "daily:features:a99");
}

#[test]
fn daily_articles_without_players_remain_valid_and_malformed_payloads_fail() {
    let no_players = daily_article_fixture(serde_json::json!([]));
    assert!(
        parse_daily_article_html("features", "example-feature", &no_players)
            .unwrap()
            .embeds
            .is_empty()
    );

    let without_attribute = no_players.replace(" data-player-infos=\"[]\"", "");
    assert!(
        parse_daily_article_html("features", "example-feature", &without_attribute)
            .unwrap()
            .embeds
            .is_empty()
    );

    let without_player_root = without_attribute.replace("<div id=\"p-daily-article\"></div>", "");
    assert!(
        parse_daily_article_html("features", "example-feature", &without_player_root)
            .unwrap()
            .embeds
            .is_empty()
    );

    let malformed =
        no_players.replace("data-player-infos=\"[]\"", "data-player-infos=\"not-json\"");
    assert_eq!(
        parse_daily_article_html("features", "example-feature", &malformed).unwrap_err(),
        "Bandcamp Daily returned unexpected music data."
    );
}

#[test]
fn standalone_daily_tracks_default_to_track_one() {
    let mut standalone = daily_player_info();
    standalone["tralbum_key"] = Value::String("t1801007541".into());
    standalone["parent_tralbum_type"] = Value::String("t".into());
    standalone["parent_tralbum_id"] = Value::from(1801007541_u64);
    standalone["tralbum_url"] =
        Value::String("https://example-artist.bandcamp.com/track/a-first-track".into());
    standalone["tracklist"][0]
        .as_object_mut()
        .unwrap()
        .remove("track_number");

    let html = daily_article_fixture(serde_json::json!([standalone]));
    let article = parse_daily_article_html("features", "example-feature", &html).unwrap();
    assert_eq!(article.embeds[0].id, "daily:features:t1801007541");
    assert_eq!(article.embeds[0].tracks[0].track, 1);
    assert_eq!(
        article.embeds[0].tracks[0].id,
        "daily:features:t1801007541:1801007541"
    );
}

#[test]
fn rejects_mismatched_or_untrusted_daily_article_metadata() {
    let html = daily_article_fixture(serde_json::json!([daily_player_info()])).replace(
        "https://daily.bandcamp.com/features/example-feature",
        "https://daily.bandcamp.com/features/different-feature",
    );
    assert!(parse_daily_article_html("features", "example-feature", &html).is_err());

    let html = daily_article_fixture(serde_json::json!([daily_player_info()])).replace(
        "https://daily.bandcamp.com/features/example-feature",
        "https://evil.example/features/example-feature",
    );
    assert!(parse_daily_article_html("features", "example-feature", &html).is_err());
}
