use crate::bandcamp_http::{fetch_bounded_json, fetch_bounded_json_request, http_client};
use crate::models::{RadioChapter, RadioSeries, RadioShow, RadioShowSummary, RadioShowsPage};
use crate::url_policy::{allowed_url, bcbits_album_art_url, bcbits_show_art_url, UrlKind};
use crate::validation::{valid_library_date, MAX_RADIO_CHAPTERS};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use url::Url;

const RADIO_LIST_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/list";
const RADIO_SHOWS_ENDPOINT: &str = "https://bandcamp.com/api/radio_api/1/get_radio_shows";
const RADIO_SHOW_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/get";
const MAX_RADIO_SHOWS: usize = 1_000;
pub(super) const MAX_RADIO_SHOW_ID: u64 = 1_000_000;
const RADIO_SHOW_PAGE_SIZE: u64 = 24;
const MAX_RADIO_CURSOR_LENGTH: usize = 128;
pub(super) const MAX_RADIO_TEXT_LENGTH: usize = 4_096;
const MAX_RADIO_DURATION_SECONDS: f64 = 24.0 * 60.0 * 60.0;
const RADIO_SERIES_CATALOG: &[(u64, &str, &str)] = &[
    (1, "Bandcamp Electronic", "bandcamp-electronic"),
    (2, "Bandcamp Selects", "bandcamp-selects"),
    (4, "The Game Show", "the-game-show"),
    (5, "The Hip Hop Show", "the-hip-hop-show"),
    (6, "The Indie Show", "the-indie-show"),
    (7, "The Metal Show", "the-metal-show"),
];
// Bandcamp occasionally publishes a stable episode ID without attaching its
// Radio franchise in the archive payload. Keep these corrections narrow and
// identity-based; never infer series membership from mutable display copy.
const RADIO_SHOW_SERIES_OVERRIDES: &[(u64, u64)] = &[(981, 5)];

#[derive(Debug, Deserialize)]
pub(super) struct RawRadioList {
    #[serde(default)]
    pub(super) results: Vec<RawRadioSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawRadioShowsPage {
    #[serde(default)]
    pub(super) items: Vec<RawRadioSeriesShow>,
    pub(super) next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawRadioSeriesShow {
    pub(super) item_id: u64,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) date: String,
    pub(super) image_id: Option<u64>,
    pub(super) franchise_name: Option<String>,
}

#[derive(Debug, Serialize)]
struct RadioShowsRequest {
    page_size: u64,
    next_cursor: Option<String>,
    radio_franchise_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawRadioSummary {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) subtitle: String,
    #[serde(default)]
    pub(super) desc: String,
    #[serde(default)]
    pub(super) published_date: String,
    pub(super) v2_image_id: Option<u64>,
    pub(super) screen_image_id: Option<u64>,
    pub(super) image_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawRadioShow {
    pub(super) show_id: u64,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) subtitle: String,
    #[serde(default)]
    pub(super) desc: String,
    #[serde(default)]
    pub(super) published_date: String,
    pub(super) show_v2_image_id: Option<u64>,
    pub(super) show_screen_image_id: Option<u64>,
    pub(super) show_image_id: Option<u64>,
    pub(super) audio_duration: Option<f64>,
    #[serde(default)]
    pub(super) audio_stream: BTreeMap<String, String>,
    #[serde(default)]
    pub(super) tracks: Vec<RawRadioChapter>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawRadioChapter {
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) artist: String,
    pub(super) album_title: Option<String>,
    pub(super) timecode: Option<f64>,
    pub(super) track_url: Option<String>,
    pub(super) url: Option<String>,
    pub(super) album_url: Option<String>,
    pub(super) track_art_id: Option<u64>,
    pub(super) url_hints: Option<RawRadioUrlHints>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawRadioUrlHints {
    pub(super) subdomain: Option<String>,
}

pub(super) fn clean_radio_text(value: &str, fallback: &str) -> String {
    if value.len() > MAX_RADIO_TEXT_LENGTH.saturating_mul(4)
        || value
            .chars()
            .any(|character| character.is_control() && !character.is_whitespace())
    {
        return fallback.into();
    }
    let mut cleaned = String::with_capacity(value.len().min(MAX_RADIO_TEXT_LENGTH));
    for word in value.split_whitespace() {
        let separator_bytes = usize::from(!cleaned.is_empty());
        if cleaned
            .len()
            .saturating_add(separator_bytes)
            .saturating_add(word.len())
            > MAX_RADIO_TEXT_LENGTH
        {
            return fallback.into();
        }
        if separator_bytes == 1 {
            cleaned.push(' ');
        }
        cleaned.push_str(word);
    }
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned
    }
}

pub(super) fn clean_radio_date(value: &str) -> String {
    let cleaned = clean_radio_text(value, "");
    if valid_library_date(&cleaned) {
        cleaned
    } else {
        "Date unavailable".into()
    }
}

pub(super) fn radio_artwork_url(image_id: Option<u64>) -> Option<String> {
    image_id.filter(|id| *id > 0).map(bcbits_show_art_url)
}

pub(super) fn radio_track_artwork_url(image_id: Option<u64>) -> Option<String> {
    image_id.filter(|id| *id > 0).map(bcbits_album_art_url)
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

fn radio_series_override_for_show(show_id: u64) -> Option<RadioSeries> {
    RADIO_SHOW_SERIES_OVERRIDES
        .iter()
        .find(|(candidate_show_id, _)| *candidate_show_id == show_id)
        .and_then(|(_, series_id)| radio_series_by_id(*series_id))
}

fn radio_series_has_overrides(series_id: u64) -> bool {
    RADIO_SHOW_SERIES_OVERRIDES
        .iter()
        .any(|(_, override_series_id)| *override_series_id == series_id)
}

pub(super) fn merge_radio_series_supplements(
    requested_series: &RadioSeries,
    current_shows: impl IntoIterator<Item = RadioShowSummary>,
    series_shows: Vec<RadioShowSummary>,
) -> Vec<RadioShowSummary> {
    let mut seen = BTreeSet::new();
    current_shows
        .into_iter()
        .filter(|show| {
            show.series
                .as_ref()
                .is_some_and(|series| series.id == requested_series.id)
        })
        .chain(series_shows)
        .filter(|show| seen.insert(show.id))
        .collect()
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
    if value.id == 0 || value.id > MAX_RADIO_SHOW_ID {
        return None;
    }
    Some(RadioShowSummary {
        id: value.id,
        subtitle: clean_radio_text(&value.subtitle, "Untitled episode"),
        description: clean_radio_text(&value.desc, "A Bandcamp-curated radio show."),
        published_at: clean_radio_date(&value.published_date),
        artwork_url: radio_artwork_url(
            value
                .v2_image_id
                .or(value.screen_image_id)
                .or(value.image_id),
        ),
        series: radio_series_override_for_show(value.id),
    })
}

pub(super) fn radio_summary_from_series_raw(
    value: RawRadioSeriesShow,
    requested_series: Option<&RadioSeries>,
) -> Option<RadioShowSummary> {
    if value.item_id == 0 || value.item_id > MAX_RADIO_SHOW_ID {
        return None;
    }
    let series = value
        .franchise_name
        .as_deref()
        .and_then(radio_series_by_title)
        .or_else(|| radio_series_override_for_show(value.item_id))
        .or_else(|| requested_series.cloned());
    Some(RadioShowSummary {
        id: value.item_id,
        subtitle: clean_radio_text(&value.title, "Untitled episode"),
        description: clean_radio_text(&value.description, "A Bandcamp-curated radio show."),
        published_at: clean_radio_date(&value.date),
        artwork_url: radio_artwork_url(value.image_id),
        series,
    })
}

pub(super) fn radio_show_from_raw(value: RawRadioShow) -> Result<RadioShow, String> {
    if value.show_id == 0 || value.show_id > MAX_RADIO_SHOW_ID {
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
            if !timecode.is_finite()
                || !(0.0..=MAX_RADIO_DURATION_SECONDS).contains(&timecode)
                || timecode > duration
            {
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
        published_at: clean_radio_date(&value.published_date),
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
    let mut results = body
        .items
        .into_iter()
        .take(RADIO_SHOW_PAGE_SIZE as usize)
        .filter_map(|show| radio_summary_from_series_raw(show, requested_series.as_ref()))
        .collect::<Vec<_>>();
    if cursor.is_none() {
        if let Some(series) = requested_series
            .as_ref()
            .filter(|series| radio_series_has_overrides(series.id))
        {
            let fallback_url = Url::parse(RADIO_LIST_ENDPOINT)
                .map_err(|_| "Coda's Bandcamp Radio endpoint is invalid.".to_string())?;
            if let Ok(current) =
                fetch_bounded_json::<RawRadioList>(fallback_url, "Bandcamp Radio").await
            {
                let current_shows = current
                    .results
                    .into_iter()
                    .take(MAX_RADIO_SHOWS)
                    .filter_map(radio_summary_from_raw);
                results = merge_radio_series_supplements(series, current_shows, results);
            }
        }
    }
    let has_more = next_cursor.is_some() && !results.is_empty();
    Ok(RadioShowsPage {
        results,
        cursor: next_cursor,
        has_more,
    })
}

#[tauri::command]
pub(super) async fn radio_show(show_id: u64) -> Result<RadioShow, String> {
    if show_id == 0 || show_id > MAX_RADIO_SHOW_ID {
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
