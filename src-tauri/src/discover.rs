use crate::bandcamp_http::{
    http_client, read_bounded_response, send_bandcamp_request, BandcampRetryPolicy,
};
use crate::models::{
    DiscoverInput, DiscoverPage, DiscoverRelease, DiscoverRequest, DiscoverTrack, RawDiscoverPage,
    RawDiscoverRelease,
};
use crate::storage::run_blocking;
use crate::url_policy::{allowed_url, UrlKind};
use crate::{
    DISCOVER_ENDPOINT, DISCOVER_PAGE_SIZE, MAX_DISCOVER_CURSOR_LENGTH, MAX_DISCOVER_TAG_LENGTH,
    MAX_JSON_RESPONSE_BYTES,
};
use serde_json::Value;

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
    match value {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(super) fn discover_release_from_raw(value: RawDiscoverRelease) -> Option<DiscoverRelease> {
    let id = value_id(&value.item_id)?;
    let item_url = allowed_url(&value.item_url, UrlKind::BandcampPage)?;
    let title = if value.title.trim().is_empty() {
        "Untitled release".into()
    } else {
        value.title.trim().to_string()
    };
    let artist = value
        .album_artist
        .or(value.band_name)
        .filter(|artist| !artist.trim().is_empty())
        .unwrap_or_else(|| "Unknown artist".into());
    let artwork_url = value
        .primary_image
        .and_then(|image| image.image_id)
        .map(|image_id| format!("https://f4.bcbits.com/img/a{image_id}_10.jpg"));
    let featured_track = value.featured_track.and_then(|track| {
        let id = value_id(&track.id)?;
        let stream_url = allowed_url(track.stream_url.as_deref()?, UrlKind::BandcampMedia)?;
        Some(DiscoverTrack {
            id: format!("discover:{id}"),
            title: if track.title.trim().is_empty() {
                "Featured track".into()
            } else {
                track.title.trim().to_string()
            },
            duration: track.duration.unwrap_or_default().max(0.0).round() as u64,
            stream_url,
        })
    });

    Some(DiscoverRelease {
        id: format!("discover:{id}"),
        title,
        artist,
        genre: value.genre.filter(|genre| !genre.trim().is_empty()),
        location: value
            .band_location
            .filter(|location| !location.trim().is_empty()),
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
