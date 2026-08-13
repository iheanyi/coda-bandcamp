use crate::bandcamp_http::{
    http_client, read_bounded_response, send_bandcamp_request, BandcampRetryPolicy,
};
use crate::models::{DailyArticle, DailyArticleSummary, DailyArticlesPage, DailyEmbed, DailyTrack};
use crate::storage::run_blocking;
use crate::url_policy::{allowed_url, UrlKind};
use crate::validation::{
    bounded_trimmed_text, valid_library_date, MAX_MEDIA_SECONDS, MAX_METADATA_TEXT_LENGTH,
    MAX_TRACK_NUMBER,
};
use chrono::NaiveDate;
use quick_xml::escape::unescape;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use url::Url;

const DAILY_ORIGIN: &str = "https://daily.bandcamp.com";
pub(super) const DAILY_SECTION_PATHS: &[(&str, &str)] = &[
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
pub(super) const MAX_DAILY_PAGE: u32 = 10_000;
pub(super) const MAX_DAILY_ARTICLE_SECTION_LENGTH: usize = 96;
pub(super) const MAX_DAILY_SLUG_LENGTH: usize = 160;
pub(super) const MAX_DAILY_HTML_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
pub(super) const MAX_DAILY_ARTICLES_PER_PAGE: usize = 30;
pub(super) const MAX_DAILY_EMBEDS: usize = 64;
pub(super) const MAX_DAILY_TRACKS_PER_EMBED: usize = 256;
pub(super) const MAX_DAILY_TRACKS_TOTAL: usize = 512;
const MAX_DAILY_DESCRIPTION_LENGTH: usize = 4_096;

#[derive(Debug, Deserialize)]
struct RawDailyPlayerInfo {
    #[serde(default)]
    tralbum_key: String,
    #[serde(default)]
    tracklist: Vec<RawDailyTrack>,
    featured_track_number: Option<u64>,
    art_id: Option<u64>,
    #[serde(default)]
    band_name: String,
    band_url: Option<String>,
    #[serde(default)]
    tralbum_url: String,
    #[serde(default)]
    title: String,
    parent_tralbum_type: Option<String>,
    parent_tralbum_id: Option<Value>,
    band_location: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawDailyTrack {
    track_id: Value,
    #[serde(default)]
    track_title: String,
    #[serde(default)]
    artist: String,
    art_id: Option<u64>,
    album_id: Option<Value>,
    streaming: Option<Value>,
    audio_track_duration: Option<f64>,
    #[serde(default)]
    audio_url: BTreeMap<String, String>,
    track_number: Option<u64>,
}

#[derive(Clone, Copy)]
struct HtmlTag<'a> {
    start: usize,
    end: usize,
    name: &'a str,
    opening: &'a str,
    closing: bool,
    self_closing: bool,
}

struct HtmlElement<'a> {
    opening: &'a str,
    inner: &'a str,
}

#[derive(Default)]
struct DailyArticleMetadata {
    title: String,
    description: Option<String>,
    author: Option<String>,
    published_at: Option<String>,
    artwork_url: Option<String>,
}

pub(super) fn daily_section_path(section: &str) -> Result<&'static str, String> {
    DAILY_SECTION_PATHS
        .iter()
        .find(|(candidate, _)| *candidate == section)
        .map(|(_, path)| *path)
        .ok_or_else(|| "The Bandcamp Daily section is invalid.".to_string())
}

pub(super) fn validate_daily_page(page: Option<u32>) -> Result<u32, String> {
    let page = page.unwrap_or(1);
    if page == 0 || page > MAX_DAILY_PAGE {
        return Err("The Bandcamp Daily page is invalid.".into());
    }
    Ok(page)
}

fn valid_daily_path_segment(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

pub(super) fn validate_daily_article_section(article_section: &str) -> Result<&str, String> {
    if !valid_daily_path_segment(article_section, MAX_DAILY_ARTICLE_SECTION_LENGTH) {
        return Err("The Bandcamp Daily article section is invalid.".into());
    }
    Ok(article_section)
}

pub(super) fn validate_daily_slug(slug: &str) -> Result<&str, String> {
    if !valid_daily_path_segment(slug, MAX_DAILY_SLUG_LENGTH) {
        return Err("The Bandcamp Daily article identifier is invalid.".into());
    }
    Ok(slug)
}

fn daily_listing_url(section: &str, page: u32) -> Result<Url, String> {
    let path = daily_section_path(section)?;
    let mut url = Url::parse(&format!("{DAILY_ORIGIN}{path}"))
        .map_err(|_| "Coda's Bandcamp Daily endpoint is invalid.".to_string())?;
    if page > 1 {
        url.query_pairs_mut().append_pair("page", &page.to_string());
    }
    Ok(url)
}

fn daily_article_url(article_section: &str, slug: &str) -> Result<Url, String> {
    Url::parse(&format!("{DAILY_ORIGIN}/{article_section}/{slug}"))
        .map_err(|_| "Coda's Bandcamp Daily endpoint is invalid.".to_string())
}

async fn fetch_daily_html(url: Url, context: &str) -> Result<Vec<u8>, String> {
    let response = send_bandcamp_request(
        http_client()?
            .get(url.clone())
            .header(ACCEPT, "text/html,application/xhtml+xml;q=0.9"),
        context,
        BandcampRetryPolicy::SafeRead,
    )
    .await?;
    if response.url().scheme() != "https"
        || response.url().host_str() != Some("daily.bandcamp.com")
        || response.url().path() != url.path()
        || response.url().query() != url.query()
    {
        return Err(format!("{context} redirected to an unexpected page."));
    }
    if !response.status().is_success() {
        return Err(format!(
            "{context} returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if !response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("text/html"))
    {
        return Err(format!("{context} returned an unexpected content type."));
    }
    read_bounded_response(response, MAX_DAILY_HTML_RESPONSE_BYTES, context).await
}

fn next_html_tag(html: &str, from: usize) -> Option<HtmlTag<'_>> {
    let bytes = html.as_bytes();
    let mut start = from;
    while start < bytes.len() {
        start += bytes.get(start..)?.iter().position(|byte| *byte == b'<')?;
        if matches!(bytes.get(start + 1), Some(b'!') | Some(b'?')) {
            let end = html.get(start + 1..)?.find('>')? + start + 2;
            start = end;
            continue;
        }
        let mut cursor = start + 1;
        let closing = bytes.get(cursor) == Some(&b'/');
        if closing {
            cursor += 1;
        }
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        let name_start = cursor;
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        {
            cursor += 1;
        }
        if cursor == name_start {
            start += 1;
            continue;
        }
        let mut quote = None;
        let mut end = cursor;
        while let Some(byte) = bytes.get(end) {
            if let Some(active_quote) = quote {
                if *byte == active_quote {
                    quote = None;
                }
            } else if matches!(*byte, b'\'' | b'"') {
                quote = Some(*byte);
            } else if *byte == b'>' {
                let opening = html.get(start..=end)?;
                return Some(HtmlTag {
                    start,
                    end: end + 1,
                    name: html.get(name_start..cursor)?,
                    opening,
                    closing,
                    self_closing: opening
                        .get(..opening.len().saturating_sub(1))?
                        .trim_end()
                        .ends_with('/'),
                });
            }
            end += 1;
        }
        return None;
    }
    None
}

fn attribute_value(tag: &str, requested_name: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let mut cursor = 1;
    if bytes.get(cursor) == Some(&b'/') {
        cursor += 1;
    }
    while bytes
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
    {
        cursor += 1;
    }
    loop {
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if !bytes
            .get(cursor)
            .is_some_and(|byte| !matches!(*byte, b'>' | b'/'))
        {
            return None;
        }
        let name_start = cursor;
        while bytes
            .get(cursor)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(*byte, b'=' | b'>' | b'/'))
        {
            cursor += 1;
        }
        let name = tag.get(name_start..cursor)?;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            continue;
        }
        cursor += 1;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        let (value_start, value_end) = match bytes.get(cursor).copied() {
            Some(quote @ (b'\'' | b'"')) => {
                cursor += 1;
                let value_start = cursor;
                while bytes.get(cursor).is_some_and(|byte| *byte != quote) {
                    cursor += 1;
                }
                (value_start, cursor)
            }
            Some(_) => {
                let value_start = cursor;
                while bytes.get(cursor).is_some_and(|byte| {
                    !byte.is_ascii_whitespace() && !matches!(*byte, b'>' | b'/')
                }) {
                    cursor += 1;
                }
                (value_start, cursor)
            }
            None => return None,
        };
        if name.eq_ignore_ascii_case(requested_name) {
            return decode_html_entities(tag.get(value_start..value_end)?);
        }
        if matches!(bytes.get(cursor), Some(b'\'') | Some(b'"')) {
            cursor += 1;
        }
    }
}

fn has_class(tag: &str, requested_class: &str) -> bool {
    attribute_value(tag, "class").is_some_and(|classes| {
        classes
            .split_ascii_whitespace()
            .any(|class| class == requested_class)
    })
}

fn matching_element<'a>(html: &'a str, opening: HtmlTag<'a>) -> Option<HtmlElement<'a>> {
    if opening.closing || opening.self_closing {
        return None;
    }
    let mut depth = 1_usize;
    let mut cursor = opening.end;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if !tag.name.eq_ignore_ascii_case(opening.name) {
            continue;
        }
        if tag.closing {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(HtmlElement {
                    opening: opening.opening,
                    inner: html.get(opening.end..tag.start)?,
                });
            }
        } else if !tag.self_closing {
            depth = depth.saturating_add(1);
        }
    }
    None
}

fn elements_with_class<'a>(
    html: &'a str,
    tag_name: &str,
    class_name: &str,
    maximum: usize,
) -> Vec<HtmlElement<'a>> {
    let mut results = Vec::new();
    let mut cursor = 0;
    while results.len() < maximum {
        let Some(tag) = next_html_tag(html, cursor) else {
            break;
        };
        cursor = tag.end;
        if tag.closing
            || !tag.name.eq_ignore_ascii_case(tag_name)
            || !has_class(tag.opening, class_name)
        {
            continue;
        }
        if let Some(element) = matching_element(html, tag) {
            results.push(element);
        }
    }
    results
}

fn first_element_with_class<'a>(
    html: &'a str,
    tag_name: &str,
    class_name: &str,
) -> Option<HtmlElement<'a>> {
    elements_with_class(html, tag_name, class_name, 1)
        .into_iter()
        .next()
}

fn first_element<'a>(html: &'a str, tag_name: &str) -> Option<HtmlElement<'a>> {
    let mut cursor = 0;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if !tag.closing && tag.name.eq_ignore_ascii_case(tag_name) {
            return matching_element(html, tag);
        }
    }
    None
}

fn first_opening_tag_with_id<'a>(html: &'a str, id: &str) -> Option<&'a str> {
    let mut cursor = 0;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if !tag.closing && attribute_value(tag.opening, "id").as_deref() == Some(id) {
            return Some(tag.opening);
        }
    }
    None
}

fn decode_html_entities(value: &str) -> Option<String> {
    let xml_compatible = value
        .replace("&nbsp;", "&#160;")
        .replace("&middot;", "&#183;");
    unescape(&xml_compatible)
        .ok()
        .map(|value| value.into_owned())
}

fn clean_daily_text(value: &str, maximum: usize) -> Option<String> {
    if value.len() > maximum.saturating_mul(4) {
        return None;
    }
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    bounded_trimmed_text(&cleaned, maximum).map(str::to_string)
}

fn text_from_html(value: &str, maximum: usize) -> Option<String> {
    let mut text = String::with_capacity(value.len().min(maximum.saturating_mul(2)));
    let mut cursor = 0;
    while cursor < value.len() {
        let Some(relative_start) = value.get(cursor..)?.find('<') else {
            text.push_str(value.get(cursor..)?);
            break;
        };
        let start = cursor + relative_start;
        text.push_str(value.get(cursor..start)?);
        let Some(tag) = next_html_tag(value, start) else {
            break;
        };
        text.push(' ');
        cursor = tag.end;
    }
    clean_daily_text(&decode_html_entities(&text)?, maximum)
}

fn raw_url_path(value: &str) -> Option<&str> {
    if let Some(path) = value.strip_prefix('/') {
        return (!path.starts_with('/') && !path.contains(['?', '#'])).then_some(path);
    }
    let authority_and_path = value.strip_prefix("https://")?;
    let (_, path) = authority_and_path.split_once('/')?;
    (!path.contains(['?', '#'])).then_some(path)
}

pub(super) fn daily_article_identity(value: &str) -> Option<(String, String, String)> {
    let raw_path = raw_url_path(value)?;
    let mut raw_segments = raw_path.split('/');
    let raw_article_section = raw_segments.next()?;
    let raw_slug = raw_segments.next()?;
    if raw_segments.next().is_some()
        || validate_daily_article_section(raw_article_section).is_err()
        || validate_daily_slug(raw_slug).is_err()
    {
        return None;
    }
    let base = Url::parse(&format!("{DAILY_ORIGIN}/")).ok()?;
    let url = base.join(value).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("daily.bandcamp.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    if url.path() != format!("/{raw_article_section}/{raw_slug}") {
        return None;
    }
    Some((
        raw_article_section.to_string(),
        raw_slug.to_string(),
        url.to_string(),
    ))
}

fn daily_artwork_url(value: &str) -> Option<String> {
    allowed_url(value, UrlKind::BandcampMedia)
}

fn daily_artwork_url_from_id(value: Option<u64>) -> Option<String> {
    value
        .filter(|id| *id > 0)
        .map(|id| format!("https://f4.bcbits.com/img/a{id}_10.jpg"))
}

fn listing_date_from_html(value: &str) -> Option<String> {
    const MONTHS: &[&str] = &[
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Sept",
        "Oct",
        "Nov",
        "Dec",
    ];
    let text = text_from_html(value, MAX_METADATA_TEXT_LENGTH.saturating_mul(4))?;
    let words = text.split_whitespace().collect::<Vec<_>>();
    words.windows(3).find_map(|window| {
        let month = window[0].trim_matches(|character: char| !character.is_ascii_alphabetic());
        if !MONTHS.contains(&month) {
            return None;
        }
        let day = window[1].trim_matches(|character: char| !character.is_ascii_digit());
        let year = window[2].trim_matches(|character: char| !character.is_ascii_digit());
        if day.is_empty() || year.len() != 4 {
            return None;
        }
        let candidate = format!("{month} {day}, {year}");
        ["%B %d, %Y", "%b %d, %Y"]
            .iter()
            .find_map(|format| NaiveDate::parse_from_str(&candidate, format).ok())
            .map(|date| date.format("%Y-%m-%d").to_string())
    })
}

fn daily_summary_from_element(element: HtmlElement<'_>) -> Option<DailyArticleSummary> {
    let title_element = first_element_with_class(element.inner, "a", "title")?;
    let (article_section, slug, article_url) =
        daily_article_identity(attribute_value(title_element.opening, "href")?.as_str())?;
    let title = text_from_html(title_element.inner, MAX_METADATA_TEXT_LENGTH)?;
    let published_at = listing_date_from_html(element.inner);
    let artwork_url = first_element_with_class(element.inner, "a", "thumb").and_then(|thumb| {
        let mut cursor = 0;
        while let Some(tag) = next_html_tag(thumb.inner, cursor) {
            cursor = tag.end;
            if !tag.closing && tag.name.eq_ignore_ascii_case("img") {
                return attribute_value(tag.opening, "src")
                    .as_deref()
                    .and_then(daily_artwork_url);
            }
        }
        None
    });
    Some(DailyArticleSummary {
        id: format!("daily-article:{article_section}:{slug}"),
        article_section,
        slug,
        title,
        published_at,
        artwork_url,
        article_url,
    })
}

fn has_next_daily_page(html: &str, section: &str, page: u32) -> bool {
    let Some(next_page) = page.checked_add(1) else {
        return false;
    };
    let Ok(expected_path) = daily_section_path(section) else {
        return false;
    };
    let mut cursor = 0;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if tag.closing || !tag.name.eq_ignore_ascii_case("a") {
            continue;
        }
        let Some(href) = attribute_value(tag.opening, "href") else {
            continue;
        };
        let path_and_query = href
            .strip_prefix('/')
            .filter(|value| !value.starts_with('/'))
            .or_else(|| href.strip_prefix("https://daily.bandcamp.com/"));
        let Some((raw_path, raw_query)) = path_and_query.and_then(|value| value.split_once('?'))
        else {
            continue;
        };
        if raw_path != expected_path.trim_start_matches('/')
            || raw_query != format!("page={next_page}")
        {
            continue;
        }
        let Ok(base) = Url::parse(&format!("{DAILY_ORIGIN}{expected_path}")) else {
            return false;
        };
        let Ok(url) = base.join(&href) else {
            continue;
        };
        if url.scheme() == "https"
            && url.host_str() == Some("daily.bandcamp.com")
            && url.path() == expected_path
            && url.fragment().is_none()
            && url.query_pairs().collect::<Vec<_>>()
                == [("page".into(), next_page.to_string().into())]
        {
            return true;
        }
    }
    false
}

pub(super) fn parse_daily_articles_html(section: &str, page: u32, html: &str) -> DailyArticlesPage {
    let mut seen = BTreeSet::new();
    let listing_html = first_element(html, "articles-list")
        .map(|element| element.inner)
        .unwrap_or(html);
    let mut results = elements_with_class(
        listing_html,
        "div",
        "list-article",
        MAX_DAILY_ARTICLES_PER_PAGE.saturating_mul(3),
    )
    .into_iter()
    .filter_map(daily_summary_from_element)
    .filter(|summary| seen.insert(summary.id.clone()))
    .collect::<Vec<_>>();
    results.sort_by(
        |left, right| match (&left.published_at, &right.published_at) {
            (Some(left), Some(right)) => right.cmp(left),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        },
    );
    results.truncate(MAX_DAILY_ARTICLES_PER_PAGE);
    DailyArticlesPage {
        results,
        page,
        has_more: has_next_daily_page(html, section, page),
    }
}

fn json_ld_text(value: Option<&Value>, maximum: usize) -> Option<String> {
    clean_daily_text(value?.as_str()?, maximum)
}

fn json_ld_author(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => clean_daily_text(value, MAX_METADATA_TEXT_LENGTH),
        Value::Object(value) => json_ld_text(value.get("name"), MAX_METADATA_TEXT_LENGTH),
        Value::Array(values) => values.iter().find_map(|value| json_ld_author(Some(value))),
        _ => None,
    }
}

fn json_ld_artwork(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => daily_artwork_url(value),
        Value::Array(values) => values.iter().find_map(|value| json_ld_artwork(Some(value))),
        Value::Object(value) => value
            .get("url")
            .and_then(Value::as_str)
            .and_then(daily_artwork_url),
        _ => None,
    }
}

fn parse_daily_article_metadata(
    html: &str,
    article_section: &str,
    expected_article_url: &str,
) -> Option<DailyArticleMetadata> {
    let mut cursor = 0;
    while let Some(tag) = next_html_tag(html, cursor) {
        cursor = tag.end;
        if tag.closing
            || !tag.name.eq_ignore_ascii_case("script")
            || attribute_value(tag.opening, "type").as_deref() != Some("application/ld+json")
        {
            continue;
        }
        let Some(element) = matching_element(html, tag) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(element.inner) else {
            continue;
        };
        if value.get("@type").and_then(Value::as_str) != Some("Article") {
            continue;
        }
        let Some(id) = value.get("@id").and_then(Value::as_str) else {
            continue;
        };
        let Some((metadata_section, _, article_url)) = daily_article_identity(id) else {
            continue;
        };
        if metadata_section != article_section || article_url != expected_article_url {
            continue;
        }
        let title = json_ld_text(value.get("headline"), MAX_METADATA_TEXT_LENGTH)?;
        let published_at = value
            .get("datePublished")
            .and_then(Value::as_str)
            .filter(|value| valid_library_date(value))
            .map(str::to_string);
        return Some(DailyArticleMetadata {
            title,
            description: json_ld_text(value.get("description"), MAX_DAILY_DESCRIPTION_LENGTH),
            author: json_ld_author(value.get("author")),
            published_at,
            artwork_url: json_ld_artwork(value.get("image")),
        });
    }
    None
}

fn value_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse::<u64>().ok())
        .filter(|value| *value > 0)
}

fn truthy_value(value: Option<&Value>) -> bool {
    value.is_some_and(|value| {
        value.as_bool() == Some(true)
            || value.as_u64().is_some_and(|value| value == 1)
            || value
                .as_str()
                .is_some_and(|value| value == "1" || value == "true")
    })
}

fn parent_identity(value: &RawDailyPlayerInfo) -> Option<(char, u64)> {
    let explicit_type = value
        .parent_tralbum_type
        .as_deref()
        .and_then(|value| match value {
            "a" => Some('a'),
            "t" => Some('t'),
            _ => None,
        });
    let explicit_id = value.parent_tralbum_id.as_ref().and_then(value_u64);
    if let (Some(parent_type), Some(parent_id)) = (explicit_type, explicit_id) {
        return Some((parent_type, parent_id));
    }
    let mut characters = value.tralbum_key.chars();
    let parent_type = match characters.next()? {
        'a' => 'a',
        't' => 't',
        _ => return None,
    };
    let parent_id = characters
        .as_str()
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)?;
    Some((parent_type, parent_id))
}

fn valid_tralbum_url(value: &str, parent_type: char) -> Option<String> {
    let value = allowed_url(value, UrlKind::BandcampPage)?;
    let parsed = Url::parse(&value).ok()?;
    let expected_prefix = if parent_type == 'a' {
        "/album/"
    } else {
        "/track/"
    };
    parsed.path().starts_with(expected_prefix).then_some(value)
}

fn daily_track_from_raw(
    value: RawDailyTrack,
    article_section: &str,
    parent_type: char,
    parent_id: u64,
    embed_id: &str,
    album: &str,
    fallback_artist: &str,
) -> Option<DailyTrack> {
    let track_id = value_u64(&value.track_id)?;
    if !truthy_value(value.streaming.as_ref()) {
        return None;
    }
    if parent_type == 'a'
        && value
            .album_id
            .as_ref()
            .and_then(value_u64)
            .is_some_and(|album_id| album_id != parent_id)
    {
        return None;
    }
    let duration = value.audio_track_duration?;
    if !duration.is_finite() || !(0.0..=MAX_MEDIA_SECONDS).contains(&duration) {
        return None;
    }
    let track = value
        .track_number
        .or((parent_type == 't').then_some(1))
        .filter(|number| *number > 0 && *number <= MAX_TRACK_NUMBER)?;
    let stream_url = value
        .audio_url
        .get("mp3-128")
        .and_then(|url| allowed_url(url, UrlKind::BandcampMedia))?;
    Some(DailyTrack {
        id: format!("daily:{article_section}:{parent_type}{parent_id}:{track_id}"),
        title: clean_daily_text(&value.track_title, MAX_METADATA_TEXT_LENGTH)
            .unwrap_or_else(|| "Untitled track".into()),
        artist: clean_daily_text(&value.artist, MAX_METADATA_TEXT_LENGTH)
            .unwrap_or_else(|| fallback_artist.into()),
        album: album.into(),
        album_id: embed_id.into(),
        duration: duration.round() as u64,
        track,
        artwork_url: daily_artwork_url_from_id(value.art_id),
        stream_url,
    })
}

fn daily_embed_from_raw(
    value: RawDailyPlayerInfo,
    article_section: &str,
    remaining_tracks: usize,
) -> Option<DailyEmbed> {
    let (parent_type, parent_id) = parent_identity(&value)?;
    let id = format!("daily:{article_section}:{parent_type}{parent_id}");
    let title = clean_daily_text(&value.title, MAX_METADATA_TEXT_LENGTH)
        .unwrap_or_else(|| "Untitled release".into());
    let artist = clean_daily_text(&value.band_name, MAX_METADATA_TEXT_LENGTH)
        .unwrap_or_else(|| "Unknown artist".into());
    let item_url = valid_tralbum_url(&value.tralbum_url, parent_type)?;
    let artist_url = value
        .band_url
        .as_deref()
        .and_then(|url| allowed_url(url, UrlKind::BandcampPage));
    let location = value
        .band_location
        .as_deref()
        .and_then(|value| clean_daily_text(value, MAX_METADATA_TEXT_LENGTH));
    let maximum_tracks = MAX_DAILY_TRACKS_PER_EMBED.min(remaining_tracks);
    let mut seen_tracks = BTreeSet::new();
    let tracks = value
        .tracklist
        .into_iter()
        .take(MAX_DAILY_TRACKS_PER_EMBED)
        .filter_map(|track| {
            daily_track_from_raw(
                track,
                article_section,
                parent_type,
                parent_id,
                &id,
                &title,
                &artist,
            )
        })
        .filter(|track| seen_tracks.insert(track.id.clone()))
        .take(maximum_tracks)
        .collect::<Vec<_>>();
    if tracks.is_empty() {
        return None;
    }
    let featured_track_number = value.featured_track_number.filter(|number| {
        *number > 0
            && *number <= MAX_TRACK_NUMBER
            && tracks.iter().any(|track| track.track == *number)
    });
    Some(DailyEmbed {
        id,
        title,
        artist,
        location,
        item_url,
        artist_url,
        artwork_url: daily_artwork_url_from_id(value.art_id),
        featured_track_number,
        tracks,
    })
}

fn parse_daily_embeds(html: &str, article_section: &str) -> Result<Vec<DailyEmbed>, String> {
    let Some(root) = first_opening_tag_with_id(html, "p-daily-article") else {
        return Ok(Vec::new());
    };
    let Some(encoded) = attribute_value(root, "data-player-infos") else {
        return Ok(Vec::new());
    };
    let raw = serde_json::from_str::<Vec<RawDailyPlayerInfo>>(&encoded)
        .map_err(|_| "Bandcamp Daily returned unexpected music data.".to_string())?;
    let mut embed_indexes = BTreeMap::<String, usize>::new();
    let mut total_tracks = 0_usize;
    let mut embeds: Vec<DailyEmbed> = Vec::new();
    for raw_embed in raw.into_iter().take(MAX_DAILY_EMBEDS) {
        let remaining_tracks = MAX_DAILY_TRACKS_TOTAL.saturating_sub(total_tracks);
        let Some(mut embed) = daily_embed_from_raw(raw_embed, article_section, remaining_tracks)
        else {
            continue;
        };
        if let Some(index) = embed_indexes.get(&embed.id).copied() {
            let current = &mut embeds[index];
            let mut track_ids = current
                .tracks
                .iter()
                .map(|track| track.id.clone())
                .collect::<BTreeSet<_>>();
            for track in embed.tracks.drain(..) {
                if total_tracks >= MAX_DAILY_TRACKS_TOTAL
                    || current.tracks.len() >= MAX_DAILY_TRACKS_PER_EMBED
                {
                    break;
                }
                if track_ids.insert(track.id.clone()) {
                    current.tracks.push(track);
                    total_tracks += 1;
                }
            }
            if current.location.is_none() {
                current.location = embed.location;
            }
            if current.artist_url.is_none() {
                current.artist_url = embed.artist_url;
            }
            if current.artwork_url.is_none() {
                current.artwork_url = embed.artwork_url;
            }
            if current.featured_track_number.is_none() {
                current.featured_track_number = embed.featured_track_number;
            }
            continue;
        }
        total_tracks = total_tracks.saturating_add(embed.tracks.len());
        embed_indexes.insert(embed.id.clone(), embeds.len());
        embeds.push(embed);
    }
    Ok(embeds)
}

pub(super) fn parse_daily_article_html(
    article_section: &str,
    slug: &str,
    html: &str,
) -> Result<DailyArticle, String> {
    let article_url = daily_article_url(article_section, slug)?.to_string();
    let metadata = parse_daily_article_metadata(html, article_section, &article_url)
        .ok_or_else(|| "Bandcamp Daily returned unexpected article metadata.".to_string())?;
    let embeds = parse_daily_embeds(html, article_section)?;
    Ok(DailyArticle {
        id: format!("daily-article:{article_section}:{slug}"),
        article_section: article_section.into(),
        slug: slug.into(),
        title: metadata.title,
        description: metadata.description,
        author: metadata.author,
        published_at: metadata.published_at,
        artwork_url: metadata.artwork_url,
        article_url,
        embeds,
    })
}

#[tauri::command]
pub(super) async fn daily_articles(
    section: String,
    page: Option<u32>,
) -> Result<DailyArticlesPage, String> {
    daily_section_path(&section)?;
    let page = validate_daily_page(page)?;
    let url = daily_listing_url(&section, page)?;
    let bytes = fetch_daily_html(url, "Bandcamp Daily").await?;
    run_blocking("Could not finish parsing Bandcamp Daily", move || {
        let html = std::str::from_utf8(&bytes)
            .map_err(|_| "Bandcamp Daily returned unreadable text.".to_string())?;
        Ok(parse_daily_articles_html(&section, page, html))
    })
    .await
}

#[tauri::command]
pub(super) async fn daily_article(
    article_section: String,
    slug: String,
) -> Result<DailyArticle, String> {
    let article_section = validate_daily_article_section(&article_section)?.to_string();
    let slug = validate_daily_slug(&slug)?.to_string();
    let url = daily_article_url(&article_section, &slug)?;
    let bytes = fetch_daily_html(url, "Bandcamp Daily").await?;
    run_blocking(
        "Could not finish parsing a Bandcamp Daily article",
        move || {
            let html = std::str::from_utf8(&bytes)
                .map_err(|_| "Bandcamp Daily returned unreadable text.".to_string())?;
            parse_daily_article_html(&article_section, &slug, html)
        },
    )
    .await
}
