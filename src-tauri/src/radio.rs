use crate::bandcamp_http::{fetch_bounded_json, fetch_bounded_json_request, http_client};
use crate::models::{
    RadioChapter, RadioSeries, RadioShow, RadioShowSummary, RadioShowsPage, RadioShowsRequest,
    RawRadioList, RawRadioSeriesShow, RawRadioShow, RawRadioShowsPage, RawRadioSummary,
    RawRadioUrlHints,
};
use crate::url_policy::{allowed_url, UrlKind};
use crate::{
    MAX_RADIO_CHAPTERS, MAX_RADIO_CURSOR_LENGTH, MAX_RADIO_DURATION_SECONDS, MAX_RADIO_SHOWS,
    MAX_RADIO_TEXT_LENGTH, RADIO_LIST_ENDPOINT, RADIO_SERIES_CATALOG, RADIO_SHOWS_ENDPOINT,
    RADIO_SHOW_ENDPOINT, RADIO_SHOW_PAGE_SIZE,
};
use url::Url;

pub(super) fn clean_radio_text(value: &str, fallback: &str) -> String {
    let cleaned = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_RADIO_TEXT_LENGTH)
        .collect::<String>();
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned
    }
}

pub(super) fn radio_artwork_url(image_id: Option<u64>) -> Option<String> {
    image_id
        .filter(|id| *id > 0)
        .map(|id| format!("https://f4.bcbits.com/img/{id:010}_10.jpg"))
}

pub(super) fn radio_track_artwork_url(image_id: Option<u64>) -> Option<String> {
    image_id
        .filter(|id| *id > 0)
        .map(|id| format!("https://f4.bcbits.com/img/a{id}_10.jpg"))
}

pub(super) fn radio_series_by_id(id: u64) -> Option<RadioSeries> {
    RADIO_SERIES_CATALOG
        .iter()
        .find(|(series_id, _, _)| *series_id == id)
        .map(|(series_id, title, slug)| RadioSeries {
            id: *series_id,
            title: (*title).into(),
            slug: (*slug).into(),
        })
}

pub(super) fn radio_series_by_title(title: &str) -> Option<RadioSeries> {
    RADIO_SERIES_CATALOG
        .iter()
        .find(|(_, series_title, _)| series_title.eq_ignore_ascii_case(title.trim()))
        .map(|(id, series_title, slug)| RadioSeries {
            id: *id,
            title: (*series_title).into(),
            slug: (*slug).into(),
        })
}

pub(super) fn validate_radio_cursor(cursor: Option<String>) -> Result<Option<String>, String> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    if cursor.is_empty()
        || cursor.len() > MAX_RADIO_CURSOR_LENGTH
        || !cursor
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'_' | b'-'))
    {
        return Err("The Bandcamp Radio page cursor is invalid.".into());
    }
    Ok(Some(cursor))
}

pub(super) fn radio_artist_url(
    hints: Option<&RawRadioUrlHints>,
    item_url: Option<&str>,
) -> Option<String> {
    let hinted = hints
        .and_then(|value| value.subdomain.as_deref())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 63
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .and_then(|subdomain| {
            allowed_url(
                &format!("https://{}.bandcamp.com/", subdomain.to_ascii_lowercase()),
                UrlKind::BandcampPage,
            )
        });
    hinted.or_else(|| {
        let mut parsed = Url::parse(item_url?).ok()?;
        parsed.set_path("/");
        parsed.set_query(None);
        parsed.set_fragment(None);
        allowed_url(parsed.as_str(), UrlKind::BandcampPage)
    })
}

pub(super) fn radio_summary_from_raw(value: RawRadioSummary) -> Option<RadioShowSummary> {
    if value.id == 0 {
        return None;
    }
    Some(RadioShowSummary {
        id: value.id,
        subtitle: clean_radio_text(&value.subtitle, "Untitled episode"),
        description: clean_radio_text(&value.desc, "A Bandcamp-curated radio show."),
        published_at: clean_radio_text(&value.published_date, "Date unavailable"),
        artwork_url: radio_artwork_url(
            value
                .v2_image_id
                .or(value.screen_image_id)
                .or(value.image_id),
        ),
        series: None,
    })
}

pub(super) fn radio_summary_from_series_raw(
    value: RawRadioSeriesShow,
    requested_series: Option<&RadioSeries>,
) -> Option<RadioShowSummary> {
    if value.item_id == 0 {
        return None;
    }
    let series = value
        .franchise_name
        .as_deref()
        .and_then(radio_series_by_title)
        .or_else(|| requested_series.cloned());
    Some(RadioShowSummary {
        id: value.item_id,
        subtitle: clean_radio_text(&value.title, "Untitled episode"),
        description: clean_radio_text(&value.description, "A Bandcamp-curated radio show."),
        published_at: clean_radio_text(&value.date, "Date unavailable"),
        artwork_url: radio_artwork_url(value.image_id),
        series,
    })
}

pub(super) fn radio_show_from_raw(value: RawRadioShow) -> Result<RadioShow, String> {
    if value.show_id == 0 {
        return Err("Bandcamp Radio returned an invalid show identifier.".into());
    }
    let duration = value.audio_duration.unwrap_or_default();
    if !duration.is_finite() || !(0.0..=MAX_RADIO_DURATION_SECONDS).contains(&duration) {
        return Err("Bandcamp Radio returned an invalid show duration.".into());
    }
    let stream_url = value
        .audio_stream
        .get("mp3-128")
        .and_then(|url| {
            allowed_url(url, UrlKind::BandcampPage)
                .or_else(|| allowed_url(url, UrlKind::BandcampMedia))
        })
        .ok_or_else(|| {
            "This Bandcamp Radio episode does not have a playable stream.".to_string()
        })?;
    let chapters = value
        .tracks
        .into_iter()
        .take(MAX_RADIO_CHAPTERS)
        .filter_map(|chapter| {
            let timecode = chapter.timecode.unwrap_or_default();
            if !timecode.is_finite() || !(0.0..=MAX_RADIO_DURATION_SECONDS).contains(&timecode) {
                return None;
            }
            let track_url = chapter
                .track_url
                .as_deref()
                .and_then(|url| allowed_url(url, UrlKind::BandcampPage));
            let album_url = chapter
                .album_url
                .as_deref()
                .and_then(|url| allowed_url(url, UrlKind::BandcampPage))
                .or_else(|| {
                    chapter
                        .url
                        .as_deref()
                        .and_then(|url| allowed_url(url, UrlKind::BandcampPage))
                });
            let item_url = track_url.clone().or_else(|| album_url.clone());
            let artist_url = radio_artist_url(chapter.url_hints.as_ref(), item_url.as_deref());
            Some(RadioChapter {
                title: clean_radio_text(&chapter.title, "Untitled track"),
                artist: clean_radio_text(&chapter.artist, "Unknown artist"),
                album: chapter
                    .album_title
                    .as_deref()
                    .map(|album| clean_radio_text(album, ""))
                    .filter(|album| !album.is_empty()),
                timecode: timecode.round() as u64,
                item_url,
                artist_url,
                album_url,
                artwork_url: radio_track_artwork_url(chapter.track_art_id),
            })
        })
        .collect();

    let title = clean_radio_text(&value.title, "Bandcamp Radio");
    Ok(RadioShow {
        id: value.show_id,
        series: radio_series_by_title(&title),
        title,
        subtitle: clean_radio_text(&value.subtitle, "Untitled episode"),
        description: clean_radio_text(&value.desc, "A Bandcamp-curated radio show."),
        published_at: clean_radio_text(&value.published_date, "Date unavailable"),
        artwork_url: radio_artwork_url(
            value
                .show_v2_image_id
                .or(value.show_screen_image_id)
                .or(value.show_image_id),
        ),
        duration: duration.round() as u64,
        stream_url,
        chapters,
    })
}

#[tauri::command]
pub(super) async fn radio_shows(
    series_id: Option<u64>,
    cursor: Option<String>,
) -> Result<RadioShowsPage, String> {
    let requested_series = match series_id {
        Some(id) => Some(
            radio_series_by_id(id)
                .ok_or_else(|| "The Bandcamp Radio series is invalid.".to_string())?,
        ),
        None => None,
    };
    let cursor = validate_radio_cursor(cursor)?;
    let url = Url::parse(RADIO_SHOWS_ENDPOINT)
        .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
    let request = RadioShowsRequest {
        page_size: RADIO_SHOW_PAGE_SIZE,
        next_cursor: cursor.clone(),
        radio_franchise_id: requested_series.as_ref().map(|series| series.id),
    };
    let response = fetch_bounded_json_request::<RawRadioShowsPage>(
        http_client()?.post(url).json(&request),
        "Bandcamp Radio",
    )
    .await;

    let body = match response {
        Ok(body) => body,
        Err(_error) if requested_series.is_none() && cursor.is_none() => {
            let fallback_url = Url::parse(RADIO_LIST_ENDPOINT)
                .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
            let fallback: RawRadioList = fetch_bounded_json(fallback_url, "Bandcamp Radio").await?;
            return Ok(RadioShowsPage {
                results: fallback
                    .results
                    .into_iter()
                    .take(MAX_RADIO_SHOWS)
                    .filter_map(radio_summary_from_raw)
                    .collect(),
                cursor: None,
                has_more: false,
            });
        }
        Err(error) => return Err(error),
    };
    let next_cursor = validate_radio_cursor(body.next_cursor).ok().flatten();
    let results = body
        .items
        .into_iter()
        .take(RADIO_SHOW_PAGE_SIZE as usize)
        .filter_map(|show| radio_summary_from_series_raw(show, requested_series.as_ref()))
        .collect::<Vec<_>>();
    let has_more = next_cursor.is_some() && !results.is_empty();
    Ok(RadioShowsPage {
        results,
        cursor: next_cursor,
        has_more,
    })
}

#[tauri::command]
pub(super) async fn radio_show(show_id: u64) -> Result<RadioShow, String> {
    if show_id == 0 || show_id > 1_000_000 {
        return Err("The Bandcamp Radio show identifier is invalid.".into());
    }
    let mut url = Url::parse(RADIO_SHOW_ENDPOINT)
        .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
    url.query_pairs_mut()
        .clear()
        .append_pair("id", &show_id.to_string());
    let body: RawRadioShow = fetch_bounded_json(url, "Bandcamp Radio").await?;
    if body.show_id != show_id {
        return Err("Bandcamp Radio returned the wrong show.".into());
    }
    radio_show_from_raw(body)
}
