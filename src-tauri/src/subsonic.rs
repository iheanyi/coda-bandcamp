use crate::app_identity::{APP_ID, SUBSONIC_CLIENT_NAME};
use crate::bandcamp_http::{
    http_client, read_bounded_response, send_bandcamp_request, BandcampRetryPolicy,
    MAX_JSON_RESPONSE_BYTES,
};
use crate::models::{
    Album, ConnectionInput, ItemDate, PlaylistDetail, PlaylistSummary, PlaylistUpdateInput, Track,
};
use crate::storage::run_blocking;
use crate::validation::{
    valid_bounded_text, valid_library_date, valid_musicbrainz_id, MAX_MEDIA_SECONDS,
    MAX_METADATA_TEXT_LENGTH, MAX_TRACK_NUMBER,
};
use keyring::Entry;
use quick_xml::{events::Event, Reader, XmlVersion};
use rand::{distributions::Alphanumeric, Rng};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use url::Url;

const CREDENTIAL_KEY: &str = "subsonic";
const SERVER_BASE: &str = "https://bandcamp.com/api/subsonic";
const API_VERSION: &str = "1.16.1";
const MAX_CREDENTIAL_LENGTH: usize = 512;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_PLAYLISTS: usize = 5_000;
pub(super) const MAX_PLAYLIST_TRACKS: usize = 25_000;
pub(super) const MAX_PLAYLIST_MUTATION_ITEMS: usize = 5_000;
const MAX_PLAYLIST_NAME_LENGTH: usize = 256;
const MAX_PLAYLIST_COMMENT_LENGTH: usize = 4_096;
pub(super) const MAX_SUBSONIC_DURATION_SECONDS: u64 = 10 * 365 * 24 * 60 * 60;

static CONNECTION_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(super) fn current_connection_generation() -> u64 {
    CONNECTION_GENERATION.load(Ordering::Acquire)
}

pub(super) fn advance_connection_generation() -> u64 {
    CONNECTION_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

pub(super) fn credential_entry() -> Result<Entry, String> {
    Entry::new(APP_ID, CREDENTIAL_KEY)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

pub(super) fn validate_credentials(input: &ConnectionInput) -> Result<(), String> {
    let username = input.username.trim();
    if username.is_empty() || input.password.is_empty() {
        return Err("Both the generated username and password are required.".into());
    }
    if username != input.username {
        return Err("The generated username cannot begin or end with whitespace.".into());
    }
    if username.len() > MAX_CREDENTIAL_LENGTH || input.password.len() > MAX_CREDENTIAL_LENGTH {
        return Err("The supplied credentials are unexpectedly long.".into());
    }
    if username.chars().any(char::is_control) || input.password.chars().any(char::is_control) {
        return Err("Credentials cannot contain control characters.".into());
    }
    Ok(())
}

pub(super) fn validate_identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_IDENTIFIER_LENGTH
        || value.chars().any(|character| character.is_control())
    {
        return Err("Bandcamp returned an invalid media identifier.".into());
    }
    Ok(())
}

pub(super) fn validate_subsonic_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_IDENTIFIER_LENGTH
        || value.chars().any(char::is_control)
    {
        return Err(format!("The {label} identifier is invalid."));
    }
    Ok(())
}

pub(super) fn validate_playlist_name(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.trim() != value
        || value.len() > MAX_PLAYLIST_NAME_LENGTH
        || value.chars().any(char::is_control)
    {
        return Err("Playlist names must be 1–256 characters without control characters.".into());
    }
    Ok(())
}

pub(super) fn validate_playlist_comment(value: &str) -> Result<(), String> {
    if value.len() > MAX_PLAYLIST_COMMENT_LENGTH || value.chars().any(char::is_control) {
        return Err(
            "Playlist comments must be no longer than 4,096 characters and cannot contain control characters."
                .into(),
        );
    }
    Ok(())
}

pub(super) fn validate_song_ids(values: &[String]) -> Result<(), String> {
    if values.len() > MAX_PLAYLIST_MUTATION_ITEMS {
        return Err(format!(
            "A single playlist change can include at most {MAX_PLAYLIST_MUTATION_ITEMS} tracks."
        ));
    }
    for value in values {
        validate_subsonic_id(value, "song")?;
    }
    Ok(())
}

pub(super) fn validate_playlist_update(input: &PlaylistUpdateInput) -> Result<(), String> {
    validate_subsonic_id(&input.playlist_id, "playlist")?;
    if let Some(name) = &input.name {
        validate_playlist_name(name)?;
    }
    if let Some(comment) = &input.comment {
        validate_playlist_comment(comment)?;
    }
    validate_song_ids(&input.song_ids_to_add)?;
    if input.song_indexes_to_remove.len() > MAX_PLAYLIST_MUTATION_ITEMS
        || input
            .song_indexes_to_remove
            .iter()
            .any(|index| *index >= MAX_PLAYLIST_TRACKS as u64)
        || input
            .song_indexes_to_remove
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != input.song_indexes_to_remove.len()
    {
        return Err("The playlist track indexes are invalid.".into());
    }
    if input.name.is_none()
        && input.comment.is_none()
        && input.public.is_none()
        && input.song_ids_to_add.is_empty()
        && input.song_indexes_to_remove.is_empty()
    {
        return Err("The playlist update does not contain any changes.".into());
    }
    Ok(())
}

pub(super) fn load_credentials() -> Result<ConnectionInput, String> {
    let serialized = credential_entry()?
        .get_password()
        .map_err(|_| "Bandcamp is not connected yet.".to_string())?;
    let credentials: ConnectionInput = serde_json::from_str(&serialized)
        .map_err(|_| "The stored Bandcamp credentials could not be read.".to_string())?;
    validate_credentials(&credentials)
        .map_err(|_| "The stored Bandcamp credentials could not be read.".to_string())?;
    Ok(credentials)
}

pub(super) fn store_credentials(input: &ConnectionInput) -> Result<(), String> {
    validate_credentials(input)?;
    let serialized = serde_json::to_string(input)
        .map_err(|error| format!("Could not prepare credentials for secure storage: {error}"))?;
    credential_entry()?
        .set_password(&serialized)
        .map_err(|error| {
            format!("Could not save credentials in the system credential store: {error}")
        })
}

pub(super) async fn load_credentials_async() -> Result<ConnectionInput, String> {
    run_blocking(
        "Could not finish reading Bandcamp credentials",
        load_credentials,
    )
    .await
}

pub(super) async fn store_credentials_async(input: ConnectionInput) -> Result<(), String> {
    run_blocking("Could not finish saving Bandcamp credentials", move || {
        store_credentials(&input)
    })
    .await
}

pub(super) fn authenticated_url(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(&str, String)],
) -> Result<Url, String> {
    let salt: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    let token = format!(
        "{:x}",
        md5::compute(format!("{}{}", credentials.password, salt))
    );
    let mut url = Url::parse(&format!("{SERVER_BASE}/rest/{endpoint}.view"))
        .map_err(|_| "The built-in Bandcamp server URL is invalid.".to_string())?;

    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("u", credentials.username.trim())
            .append_pair("t", &token)
            .append_pair("s", &salt)
            .append_pair("v", API_VERSION)
            .append_pair("c", SUBSONIC_CLIENT_NAME)
            .append_pair("f", "json");
        for (key, value) in extra {
            query.append_pair(key, value);
        }
    }
    Ok(url)
}

pub(super) async fn request_json(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(&str, String)],
) -> Result<Value, String> {
    let url = authenticated_url(endpoint, credentials, extra)?;
    let response = send_bandcamp_request(
        http_client()?.get(url),
        "Bandcamp",
        BandcampRetryPolicy::SafeRead,
    )
    .await?;
    parse_subsonic_response(response).await
}

pub(super) async fn request_mutation_json(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(String, String)],
) -> Result<Value, String> {
    let url = authenticated_url(endpoint, credentials, &[])?;
    let response = send_bandcamp_request(
        http_client()?.post(url).form(extra),
        "Bandcamp",
        BandcampRetryPolicy::Never,
    )
    .await?;
    parse_subsonic_response(response).await
}

pub(super) async fn request_empty_mutation(
    endpoint: &str,
    credentials: &ConnectionInput,
    extra: &[(String, String)],
) -> Result<(), String> {
    let url = authenticated_url(endpoint, credentials, &[])?;
    let response = send_bandcamp_request(
        http_client()?.post(url).form(extra),
        "Bandcamp",
        BandcampRetryPolicy::Never,
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let bytes = read_bounded_response(response, MAX_JSON_RESPONSE_BYTES, "Bandcamp").await?;
    run_blocking(
        "Could not finish parsing the Bandcamp response",
        move || parse_subsonic_empty_response_bytes(&bytes),
    )
    .await
}

pub(super) async fn parse_subsonic_response(response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "Bandcamp returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let bytes = read_bounded_response(response, MAX_JSON_RESPONSE_BYTES, "Bandcamp").await?;
    run_blocking(
        "Could not finish parsing the Bandcamp response",
        move || {
            let body: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Bandcamp returned an unreadable response.".to_string())?;
            let envelope = body
                .get("subsonic-response")
                .ok_or_else(|| "Bandcamp returned an unexpected response.".to_string())?;
            if envelope.get("status").and_then(Value::as_str) != Some("ok") {
                return Err(subsonic_error_message(envelope));
            }
            Ok(body)
        },
    )
    .await
}

pub(super) fn subsonic_error_message(envelope: &Value) -> String {
    let code = envelope.pointer("/error/code").and_then(number_value);
    subsonic_error_code_message(code)
}

fn subsonic_error_code_message(code: Option<u64>) -> String {
    match code {
        Some(40 | 50) => {
            "Bandcamp rejected the generated credentials. Generate a new pair in Fan Settings and try again."
                .into()
        }
        Some(code) => format!("Bandcamp rejected the request (error code {code})."),
        None => "Bandcamp rejected the request.".into(),
    }
}

pub(super) fn parse_subsonic_empty_response_bytes(bytes: &[u8]) -> Result<(), String> {
    if let Ok(body) = serde_json::from_slice::<Value>(bytes) {
        let envelope = body
            .get("subsonic-response")
            .ok_or_else(|| "Bandcamp returned an unexpected response.".to_string())?;
        return match envelope.get("status").and_then(Value::as_str) {
            Some("ok") => Ok(()),
            Some("failed") => Err(subsonic_error_message(envelope)),
            _ => Err("Bandcamp returned an unexpected response.".into()),
        };
    }

    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut response_status = None;
    let mut error_code = None;
    loop {
        let event = reader
            .read_event()
            .map_err(|_| "Bandcamp returned an unreadable response.".to_string())?;
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.local_name();
                if name.as_ref() == b"subsonic-response" {
                    for attribute in element.attributes().with_checks(true) {
                        let attribute = attribute
                            .map_err(|_| "Bandcamp returned an unreadable response.".to_string())?;
                        if attribute.key.as_ref() == b"status" {
                            response_status = Some(
                                attribute
                                    .normalized_value(XmlVersion::Implicit1_0)
                                    .map_err(|_| {
                                        "Bandcamp returned an unreadable response.".to_string()
                                    })?
                                    .into_owned(),
                            );
                        }
                    }
                } else if name.as_ref() == b"error" {
                    for attribute in element.attributes().with_checks(true) {
                        let attribute = attribute
                            .map_err(|_| "Bandcamp returned an unreadable response.".to_string())?;
                        if attribute.key.as_ref() == b"code" {
                            error_code = attribute
                                .normalized_value(XmlVersion::Implicit1_0)
                                .ok()
                                .and_then(|value| value.parse::<u64>().ok());
                        }
                    }
                }
            }
            Event::DocType(_) => return Err("Bandcamp returned an unreadable response.".into()),
            Event::Eof => break,
            _ => {}
        }
    }

    match response_status.as_deref() {
        Some("ok") => Ok(()),
        Some("failed") => Err(subsonic_error_code_message(error_code)),
        _ => Err("Bandcamp returned an unexpected response.".into()),
    }
}

pub(super) fn beta_feature_error(feature: &str, error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if [
        "not found",
        "not implemented",
        "unsupported",
        "unknown command",
        "unknown method",
        "http 404",
        "http 405",
        "http 500",
        "error code 30",
        "error code 70",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        format!("{feature} is not available from Bandcamp's Subsonic beta for this account yet.")
    } else {
        format!("{feature} failed: {error}")
    }
}

pub(super) fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_string)
}

pub(super) fn number_value(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

pub(super) fn number_field(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(number_value)
}

pub(super) fn boolean_field(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(|item| {
        item.as_bool().or_else(|| match item.as_str()? {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        })
    })
}

pub(super) fn optional_item_date_number(value: &Value, key: &str) -> Option<Option<u64>> {
    match value.get(key) {
        None | Some(Value::Null) => Some(None),
        Some(item) => number_value(item).map(Some),
    }
}

pub(super) fn days_in_month(year: u64, month: u64) -> u64 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 31,
    }
}

pub(super) fn valid_item_date(date: &ItemDate) -> bool {
    if !(1..=9_999).contains(&date.year)
        || date.month.is_some_and(|month| !(1..=12).contains(&month))
        || date.day.is_some_and(|day| !(1..=31).contains(&day))
        || (date.day.is_some() && date.month.is_none())
    {
        return false;
    }
    match (date.month, date.day) {
        (Some(month), Some(day)) => day <= days_in_month(date.year, month),
        _ => true,
    }
}

pub(super) fn item_date_field(value: &Value, key: &str) -> Option<ItemDate> {
    let item = value.get(key)?;
    item.as_object()?;
    let date = ItemDate {
        year: optional_item_date_number(item, "year")??,
        month: optional_item_date_number(item, "month")?,
        day: optional_item_date_number(item, "day")?,
    };
    valid_item_date(&date).then_some(date)
}

fn library_date_field(value: &Value, keys: &[&str]) -> Option<String> {
    string_field(value, keys).filter(|date| valid_library_date(date))
}

pub(super) fn album_from_value(value: &Value) -> Option<Album> {
    let id = string_field(value, &["id"])?;
    let title = string_field(value, &["name", "album", "title"])
        .unwrap_or_else(|| "Untitled release".into());
    Some(Album {
        id,
        title,
        artist: string_field(value, &["artist"]).unwrap_or_else(|| "Unknown artist".into()),
        song_count: number_field(value, "songCount").unwrap_or(0),
        duration: number_field(value, "duration").unwrap_or(0),
        cover_art: string_field(value, &["coverArt"]),
        year: number_field(value, "year"),
        genre: string_field(value, &["genre"]),
        added_at: library_date_field(value, &["created"]),
        starred_at: library_date_field(value, &["starred"]),
        played_at: library_date_field(value, &["played"]),
        original_release_date: item_date_field(value, "originalReleaseDate"),
        release_date: item_date_field(value, "releaseDate"),
    })
}

pub(super) fn validate_album(album: &Album) -> Result<(), String> {
    validate_subsonic_id(&album.id, "album")?;
    if !valid_bounded_text(&album.title, MAX_METADATA_TEXT_LENGTH, true)
        || !valid_bounded_text(&album.artist, MAX_METADATA_TEXT_LENGTH, true)
        || album.song_count > MAX_PLAYLIST_TRACKS as u64
        || album.duration > MAX_SUBSONIC_DURATION_SECONDS
        || album.year.is_some_and(|year| !(1..=9_999).contains(&year))
        || album
            .cover_art
            .as_deref()
            .is_some_and(|cover| validate_subsonic_id(cover, "cover artwork").is_err())
        || album
            .genre
            .as_deref()
            .is_some_and(|genre| !valid_bounded_text(genre, MAX_METADATA_TEXT_LENGTH, false))
        || album
            .added_at
            .as_deref()
            .is_some_and(|date| !valid_library_date(date))
        || album
            .starred_at
            .as_deref()
            .is_some_and(|date| !valid_library_date(date))
        || album
            .played_at
            .as_deref()
            .is_some_and(|date| !valid_library_date(date))
        || album
            .original_release_date
            .as_ref()
            .is_some_and(|date| !valid_item_date(date))
        || album
            .release_date
            .as_ref()
            .is_some_and(|date| !valid_item_date(date))
    {
        return Err("Bandcamp returned invalid album metadata.".into());
    }
    Ok(())
}

pub(super) fn bounded_album_from_value(value: &Value) -> Option<Album> {
    let album = album_from_value(value)?;
    validate_album(&album).ok()?;
    Some(album)
}

pub(super) fn track_from_value(value: &Value, fallback_album_id: &str) -> Option<Track> {
    let id = string_field(value, &["id"])?;
    Some(Track {
        id,
        title: string_field(value, &["title"]).unwrap_or_else(|| "Untitled track".into()),
        artist: string_field(value, &["artist"]).unwrap_or_else(|| "Unknown artist".into()),
        album: string_field(value, &["album"]).unwrap_or_default(),
        album_id: string_field(value, &["albumId"]).unwrap_or_else(|| fallback_album_id.into()),
        duration: number_field(value, "duration").unwrap_or(0),
        track: number_field(value, "track").unwrap_or(0),
        disc: number_field(value, "discNumber"),
        album_artist: string_field(value, &["displayAlbumArtist", "albumArtist"])
            .filter(|artist| valid_bounded_text(artist, MAX_METADATA_TEXT_LENGTH, false))
            .filter(|artist| !artist.trim().is_empty()),
        music_brainz_id: string_field(value, &["musicBrainzId"])
            .filter(|identifier| valid_musicbrainz_id(identifier)),
        cover_art: string_field(value, &["coverArt"]),
        starred_at: bounded_optional_field(value, &["starred"], MAX_METADATA_TEXT_LENGTH)
            .filter(|date| valid_library_date(date)),
    })
}

pub(super) fn bounded_optional_field(
    value: &Value,
    keys: &[&str],
    maximum: usize,
) -> Option<String> {
    string_field(value, keys)
        .filter(|item| valid_bounded_text(item, maximum, false))
        .filter(|item| !item.trim().is_empty())
}

pub(super) fn playlist_summary_from_value(value: &Value) -> Option<PlaylistSummary> {
    let id = string_field(value, &["id"])?;
    validate_subsonic_id(&id, "playlist").ok()?;
    let name = string_field(value, &["name"])?;
    if !valid_bounded_text(&name, MAX_PLAYLIST_NAME_LENGTH, true) {
        return None;
    }
    let song_count = number_field(value, "songCount").unwrap_or(0);
    let duration = number_field(value, "duration").unwrap_or(0);
    if song_count > MAX_PLAYLIST_TRACKS as u64 || duration > MAX_SUBSONIC_DURATION_SECONDS {
        return None;
    }
    Some(PlaylistSummary {
        id,
        name: name.trim().to_string(),
        comment: bounded_optional_field(value, &["comment"], MAX_PLAYLIST_COMMENT_LENGTH),
        owner: bounded_optional_field(value, &["owner"], MAX_METADATA_TEXT_LENGTH),
        public: boolean_field(value, "public"),
        song_count,
        duration,
        created_at: bounded_optional_field(value, &["created"], MAX_METADATA_TEXT_LENGTH)
            .filter(|date| valid_library_date(date)),
        changed_at: bounded_optional_field(value, &["changed"], MAX_METADATA_TEXT_LENGTH)
            .filter(|date| valid_library_date(date)),
        cover_art: bounded_optional_field(value, &["coverArt"], MAX_IDENTIFIER_LENGTH),
    })
}

pub(super) fn bounded_track_from_value(value: &Value, fallback_album_id: &str) -> Option<Track> {
    let track = track_from_value(value, fallback_album_id)?;
    validate_subsonic_id(&track.id, "song").ok()?;
    validate_subsonic_id(&track.album_id, "album").ok()?;
    if !valid_bounded_text(&track.title, MAX_METADATA_TEXT_LENGTH, true)
        || !valid_bounded_text(&track.artist, MAX_METADATA_TEXT_LENGTH, true)
        || !valid_bounded_text(&track.album, MAX_METADATA_TEXT_LENGTH, false)
        || track.duration as f64 > MAX_MEDIA_SECONDS
        || track.track > MAX_TRACK_NUMBER
        || track.disc.is_some_and(|disc| disc > MAX_TRACK_NUMBER)
        || track
            .album_artist
            .as_deref()
            .is_some_and(|artist| !valid_bounded_text(artist, MAX_METADATA_TEXT_LENGTH, false))
        || track
            .music_brainz_id
            .as_deref()
            .is_some_and(|identifier| !valid_musicbrainz_id(identifier))
        || track
            .cover_art
            .as_deref()
            .is_some_and(|cover| validate_subsonic_id(cover, "cover artwork").is_err())
        || track
            .starred_at
            .as_deref()
            .is_some_and(|date| !valid_library_date(date))
    {
        return None;
    }
    Some(track)
}

pub(super) fn playlist_track_album_id(value: &Value) -> Option<String> {
    match value.get("albumId") {
        Some(Value::String(album_id)) => return Some(album_id.clone()),
        None | Some(Value::Null) => {}
        Some(_) => return None,
    }
    match value.get("parent") {
        Some(Value::String(parent)) => Some(parent.clone()),
        // Bandcamp addresses standalone playlist songs as one-track albums by song ID.
        None | Some(Value::Null) => string_field(value, &["id"]),
        Some(_) => None,
    }
}

pub(super) fn playlist_detail_from_value(value: &Value) -> Result<PlaylistDetail, String> {
    let summary = playlist_summary_from_value(value)
        .ok_or_else(|| "Bandcamp returned invalid playlist metadata.".to_string())?;
    let entries = match value.get("entry") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(entries)) => entries.as_slice(),
        Some(_) => {
            return Err("Bandcamp returned invalid playlist track data.".to_string());
        }
    };
    if entries.len() > MAX_PLAYLIST_TRACKS {
        return Err(format!(
            "Bandcamp returned a playlist with more than {MAX_PLAYLIST_TRACKS} tracks."
        ));
    }
    let tracks = entries
        .iter()
        .map(|entry| {
            let fallback_album_id = playlist_track_album_id(entry).unwrap_or_default();
            bounded_track_from_value(entry, &fallback_album_id).ok_or_else(|| {
                "Bandcamp returned invalid track metadata in a playlist.".to_string()
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PlaylistDetail {
        id: summary.id,
        name: summary.name,
        comment: summary.comment,
        owner: summary.owner,
        public: summary.public,
        song_count: summary.song_count,
        duration: summary.duration,
        created_at: summary.created_at,
        changed_at: summary.changed_at,
        cover_art: summary.cover_art,
        tracks,
    })
}

pub(super) fn playlists_from_response(body: &Value) -> Result<Vec<PlaylistSummary>, String> {
    let playlists = body
        .pointer("/subsonic-response/playlists")
        .and_then(Value::as_object)
        .ok_or_else(|| "Bandcamp did not return a valid playlist list.".to_string())?;
    let values = match playlists.get("playlist") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(values)) => values.as_slice(),
        Some(_) => {
            return Err("Bandcamp returned an invalid playlist list.".to_string());
        }
    };
    if values.len() > MAX_PLAYLISTS {
        return Err(format!(
            "Bandcamp returned more than {MAX_PLAYLISTS} playlists."
        ));
    }
    values
        .iter()
        .map(|value| {
            playlist_summary_from_value(value)
                .ok_or_else(|| "Bandcamp returned invalid playlist metadata.".to_string())
        })
        .collect()
}

pub(super) fn playlist_from_response(body: &Value) -> Result<PlaylistDetail, String> {
    let value = body
        .pointer("/subsonic-response/playlist")
        .ok_or_else(|| "Bandcamp did not return the requested playlist.".to_string())?;
    playlist_detail_from_value(value)
}

pub(super) fn playlist_from_optional_response(
    body: &Value,
) -> Result<Option<PlaylistDetail>, String> {
    body.pointer("/subsonic-response/playlist")
        .map(playlist_detail_from_value)
        .transpose()
}

pub(super) fn playlist_update_from_response(
    body: &Value,
    playlist_id: &str,
) -> Result<Option<PlaylistDetail>, String> {
    let playlist = playlist_from_optional_response(body)?;
    if playlist
        .as_ref()
        .is_some_and(|playlist| playlist.id != playlist_id)
    {
        return Err("Bandcamp returned a different playlist than Coda updated.".into());
    }
    Ok(playlist)
}
