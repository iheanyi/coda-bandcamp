use crate::bandcamp_http::{
    http_client, read_bounded_response, send_bandcamp_request, BandcampRetryPolicy,
    MAX_JSON_RESPONSE_BYTES,
};
use crate::models::{DiscoverInput, DiscoverPage, DiscoverRelease, DiscoverTrack};
use crate::storage::run_blocking;
use crate::url_policy::{allowed_url, bcbits_album_art_url, UrlKind};
use crate::validation::{
    bounded_trimmed_text, valid_bounded_text, MAX_MEDIA_SECONDS, MAX_METADATA_TEXT_LENGTH,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DISCOVER_ENDPOINT: &str = "https://bandcamp.com/api/discover/1/discover_web";
const DISCOVER_PAGE_SIZE: usize = 40;
const MAX_DISCOVER_TAG_LENGTH: usize = 64;
const MAX_DISCOVER_CURSOR_LENGTH: usize = 2_048;
pub(super) const MAX_DISCOVER_OPAQUE_ID_LENGTH: usize = 512;
const DISCOVER_ID_PREFIX: &str = "discover:";

#[derive(Debug, Deserialize)]
pub(super) struct RawDiscoverPage {
    #[serde(default)]
    pub(super) results: Vec<RawDiscoverRelease>,
    #[serde(default)]
    result_count: u64,
    cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawDiscoverRelease {
    item_id: Value,
    #[serde(default)]
    title: String,
    #[serde(default)]
    item_url: String,
    album_artist: Option<String>,
    band_name: Option<String>,
    band_location: Option<String>,
    genre: Option<String>,
    primary_image: Option<RawDiscoverImage>,
    featured_track: Option<RawDiscoverTrack>,
}

#[derive(Debug, Deserialize)]
struct RawDiscoverImage {
    image_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawDiscoverTrack {
    id: Value,
    #[serde(default)]
    title: String,
    stream_url: Option<String>,
    duration: Option<f64>,
}

#[derive(Serialize)]
struct DiscoverRequest<'a> {
    category_id: u8,
    tag_norm_names: Vec<&'a str>,
    geoname_id: u8,
    slice: &'a str,
    time_facet_id: Option<u8>,
    cursor: &'a str,
    size: usize,
    include_result_types: [&'a str; 2],
    followed_bands: bool,
}

pub(super) fn validate_discover_input(input: &DiscoverInput) -> Result<(), String> {
    let tag = input.tag.trim();
    if tag.len() > MAX_DISCOVER_TAG_LENGTH || tag.chars().any(char::is_control) {
        return Err("The Discover tag is invalid.".into());
    }
    if !matches!(input.sort.as_str(), "top" | "new") {
        return Err("The Discover sort mode is invalid.".into());
    }
    if input.cursor.is_empty()
        || input.cursor.len() > MAX_DISCOVER_CURSOR_LENGTH
        || input.cursor.chars().any(char::is_control)
    {
        return Err("The Discover cursor is invalid.".into());
    }
    Ok(())
}

pub(super) fn value_id(value: &Value) -> Option<String> {
    let value = match value {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }?;
    let maximum_value_length = MAX_DISCOVER_OPAQUE_ID_LENGTH - DISCOVER_ID_PREFIX.len();
    (value.trim() == value && valid_bounded_text(&value, maximum_value_length, true))
        .then_some(value)
}

fn discover_text(value: &str, fallback: &str) -> String {
    bounded_trimmed_text(value, MAX_METADATA_TEXT_LENGTH)
        .unwrap_or(fallback)
        .to_string()
}

fn optional_discover_text(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .and_then(|value| bounded_trimmed_text(value, MAX_METADATA_TEXT_LENGTH))
        .map(str::to_string)
}

fn discover_duration(value: Option<f64>) -> Option<u64> {
    let value = value.unwrap_or_default();
    (value.is_finite() && (0.0..=MAX_MEDIA_SECONDS).contains(&value)).then(|| value.round() as u64)
}

fn opaque_discover_id(value: &Value) -> Option<String> {
    value_id(value).map(|value| format!("{DISCOVER_ID_PREFIX}{value}"))
}

pub(super) fn discover_release_from_raw(value: RawDiscoverRelease) -> Option<DiscoverRelease> {
    let id = opaque_discover_id(&value.item_id)?;
    let item_url = allowed_url(&value.item_url, UrlKind::BandcampPage)?;
    let title = discover_text(&value.title, "Untitled release");
    let artist = value
        .album_artist
        .as_deref()
        .and_then(|artist| bounded_trimmed_text(artist, MAX_METADATA_TEXT_LENGTH))
        .or_else(|| {
            value
                .band_name
                .as_deref()
                .and_then(|artist| bounded_trimmed_text(artist, MAX_METADATA_TEXT_LENGTH))
        })
        .map(str::to_string)
        .unwrap_or_else(|| "Unknown artist".into());
    let artwork_url = value
        .primary_image
        .and_then(|image| image.image_id)
        .map(bcbits_album_art_url);
    let featured_track = value.featured_track.and_then(|track| {
        let id = opaque_discover_id(&track.id)?;
        let stream_url = allowed_url(track.stream_url.as_deref()?, UrlKind::BandcampMedia)?;
        let duration = discover_duration(track.duration)?;
        Some(DiscoverTrack {
            id,
            title: discover_text(&track.title, "Featured track"),
            duration,
            stream_url,
        })
    });

    Some(DiscoverRelease {
        id,
        title,
        artist,
        genre: optional_discover_text(value.genre),
        location: optional_discover_text(value.band_location),
        item_url,
        artwork_url,
        featured_track,
    })
}

#[tauri::command]
pub(super) async fn discover(input: DiscoverInput) -> Result<DiscoverPage, String> {
    validate_discover_input(&input)?;
    let normalized_tag = input.tag.trim().to_ascii_lowercase();
    let tags = if normalized_tag.is_empty() {
        Vec::new()
    } else {
        vec![normalized_tag.as_str()]
    };
    let request = DiscoverRequest {
        category_id: 0,
        tag_norm_names: tags,
        geoname_id: 0,
        slice: &input.sort,
        time_facet_id: None,
        cursor: &input.cursor,
        size: DISCOVER_PAGE_SIZE,
        include_result_types: ["a", "s"],
        followed_bands: false,
    };
    let response = send_bandcamp_request(
        http_client()?
            .post(DISCOVER_ENDPOINT)
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request),
        "Bandcamp Discover",
        BandcampRetryPolicy::Never,
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp Discover returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
    {
        return Err("Bandcamp Discover returned an unexpected content type.".into());
    }
    let bytes =
        read_bounded_response(response, MAX_JSON_RESPONSE_BYTES, "Bandcamp Discover").await?;
    run_blocking(
        "Could not finish parsing the Bandcamp Discover response",
        move || {
            let body: RawDiscoverPage = serde_json::from_slice(&bytes)
                .map_err(|_| "Bandcamp Discover returned an unexpected response.".to_string())?;
            let cursor = body.cursor.filter(|cursor| {
                !cursor.is_empty()
                    && cursor.len() <= MAX_DISCOVER_CURSOR_LENGTH
                    && !cursor.chars().any(char::is_control)
            });
            let results = body
                .results
                .into_iter()
                .take(DISCOVER_PAGE_SIZE)
                .filter_map(discover_release_from_raw)
                .collect::<Vec<_>>();
            let has_more = cursor.is_some() && !results.is_empty();
            Ok(DiscoverPage {
                results,
                result_count: body.result_count,
                cursor,
                has_more,
            })
        },
    )
    .await
}
