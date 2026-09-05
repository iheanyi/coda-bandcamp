use crate::bandcamp_http::{
    bandcamp_retry_delay, is_retryable_bandcamp_status, read_bounded_response,
    redacted_request_error, BANDCAMP_RETRY_JITTER_MS,
};
use crate::credential_session::CredentialSession;
use crate::models::{
    LastFmAuthorization, LastFmScrobbleInput, LastFmSession, LastFmStatus, LastFmTrackInput,
};
use crate::storage::run_blocking;
use crate::validation::{valid_musicbrainz_id, MAX_MEDIA_SECONDS, MAX_TRACK_NUMBER};
use keyring::Entry;
use rand::Rng;
use reqwest::{redirect::Policy, Client};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

const LASTFM_SERVICE_NAME: &str = "com.coda.lastfm";
const LASTFM_SESSION_KEY: &str = "session";
const LASTFM_API_ENDPOINT: &str = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_AUTH_ENDPOINT: &str = "https://www.last.fm/api/auth/";
// Last.fm's desktop protocol embeds these application credentials in the
// compiled client. Reading them from the build environment keeps the public
// source tree clean without adding a runtime configuration dependency.
const LASTFM_API_KEY: &str = match option_env!("CODA_LASTFM_API_KEY") {
    Some(value) => value,
    None => "",
};
pub(super) const LASTFM_SHARED_SECRET: &str = match option_env!("CODA_LASTFM_SHARED_SECRET") {
    Some(value) => value,
    None => "",
};
const MAX_LASTFM_METADATA_LENGTH: usize = 1_024;
const MAX_LASTFM_RESPONSE_BYTES: usize = 1024 * 1024;
pub(super) const LASTFM_MAX_TRANSIENT_RETRIES: u32 = 2;

/// Whether a Last.fm request may be resent after a transient failure.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum LastFmRetryPolicy {
    /// Authorization and scrobble submissions run once. Retrying a scrobble
    /// whose response was lost could double-submit the listen and break the
    /// at-most-once scrobble contract.
    Never,
    /// `track.updateNowPlaying` sets transient now-playing state, so
    /// resending it after a dropped connection cannot duplicate anything.
    IdempotentWrite,
}

static LASTFM_SESSION: CredentialSession<Option<LastFmSession>> = CredentialSession::new();

static LASTFM_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

pub(super) fn lastfm_session_entry() -> Result<Entry, String> {
    Entry::new(LASTFM_SERVICE_NAME, LASTFM_SESSION_KEY)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

pub(super) fn lastfm_configured() -> bool {
    [LASTFM_API_KEY, LASTFM_SHARED_SECRET].iter().all(|value| {
        value.len() == 32 && value.bytes().all(|character| character.is_ascii_hexdigit())
    })
}

pub(super) fn lastfm_status_value() -> LastFmStatus {
    if !lastfm_configured() {
        return LastFmStatus {
            configured: false,
            connected: false,
            username: None,
        };
    }
    match load_lastfm_session() {
        Ok(Some(session)) => LastFmStatus {
            configured: true,
            connected: true,
            username: Some(session.username),
        },
        _ => LastFmStatus {
            configured: true,
            connected: false,
            username: None,
        },
    }
}

pub(super) fn load_lastfm_session() -> Result<Option<LastFmSession>, String> {
    LASTFM_SESSION.read(read_lastfm_session_from_keyring)
}

fn read_lastfm_session_from_keyring() -> Result<Option<LastFmSession>, String> {
    let serialized = match lastfm_session_entry()?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("Could not read the Last.fm session: {error}")),
    };
    let session: LastFmSession = serde_json::from_str(&serialized)
        .map_err(|_| "The saved Last.fm session is invalid. Reconnect Last.fm.".to_string())?;
    validate_lastfm_session(&session)?;
    Ok(Some(session))
}

pub(super) fn validate_lastfm_session(session: &LastFmSession) -> Result<(), String> {
    if session.username.is_empty()
        || session.key.is_empty()
        || session.username.trim() != session.username
        || session.key.trim() != session.key
        || session.username.len() > MAX_LASTFM_METADATA_LENGTH
        || session.key.len() > MAX_LASTFM_METADATA_LENGTH
        || session.username.chars().any(char::is_control)
        || session.key.chars().any(char::is_control)
    {
        return Err("The saved Last.fm session is invalid. Reconnect Last.fm.".into());
    }
    Ok(())
}

pub(super) fn store_lastfm_session(session: &LastFmSession) -> Result<(), String> {
    validate_lastfm_session(session)?;
    let serialized = serde_json::to_string(session)
        .map_err(|error| format!("Could not prepare the Last.fm session: {error}"))?;
    LASTFM_SESSION.mutate(|| {
        lastfm_session_entry()?
            .set_password(&serialized)
            .map_err(|error| format!("Could not save the Last.fm session: {error}"))
    })
}

pub(super) fn require_lastfm_configuration() -> Result<(), String> {
    if lastfm_configured() {
        Ok(())
    } else {
        Err("Last.fm is not configured in this Coda build.".into())
    }
}

pub(super) fn require_lastfm_session() -> Result<LastFmSession, String> {
    require_lastfm_configuration()?;
    load_lastfm_session()?.ok_or_else(|| "Connect Last.fm in Coda settings first.".into())
}

pub(super) async fn require_lastfm_session_async() -> Result<LastFmSession, String> {
    run_blocking(
        "Could not finish reading the Last.fm session",
        require_lastfm_session,
    )
    .await
}

pub(super) fn validate_lastfm_token(token: &str) -> Result<(), String> {
    if token.is_empty()
        || token.trim() != token
        || token.len() > MAX_LASTFM_METADATA_LENGTH
        || token.chars().any(char::is_control)
    {
        return Err("Last.fm returned an invalid authorization token.".into());
    }
    Ok(())
}

pub(super) fn validate_lastfm_track(input: &LastFmTrackInput) -> Result<(), String> {
    for (label, value) in [
        ("artist", input.artist.trim()),
        ("track", input.title.trim()),
        ("album", input.album.trim()),
    ] {
        if value.len() > MAX_LASTFM_METADATA_LENGTH || value.chars().any(char::is_control) {
            return Err(format!("The Last.fm {label} metadata is invalid."));
        }
    }
    if input.artist.trim().is_empty() || input.title.trim().is_empty() {
        return Err("Last.fm requires both an artist and track title.".into());
    }
    if let Some(album_artist) = input.album_artist.as_deref() {
        if album_artist.len() > MAX_LASTFM_METADATA_LENGTH
            || album_artist.chars().any(char::is_control)
        {
            return Err("The Last.fm album artist metadata is invalid.".into());
        }
    }
    if input
        .music_brainz_id
        .as_deref()
        .is_some_and(|value| !valid_musicbrainz_id(value))
    {
        return Err("The Last.fm MusicBrainz identifier is invalid.".into());
    }
    if input.duration > MAX_MEDIA_SECONDS as u64 {
        return Err("The Last.fm track duration is invalid.".into());
    }
    if input.track_number > MAX_TRACK_NUMBER {
        return Err("The Last.fm track number is invalid.".into());
    }
    Ok(())
}

pub(super) fn lastfm_signature(parameters: &BTreeMap<String, String>) -> String {
    let mut signature = String::new();
    for (key, value) in parameters {
        if key != "format" && key != "callback" {
            signature.push_str(key);
            signature.push_str(value);
        }
    }
    signature.push_str(LASTFM_SHARED_SECRET);
    format!("{:x}", md5::compute(signature))
}

pub(super) fn lastfm_http_client() -> Result<&'static Client, String> {
    LASTFM_HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(20))
                .user_agent("Coda/0.1 (+https://github.com/iheanyi/coda-bandcamp)")
                .redirect(Policy::none())
                .build()
                .map_err(|error| {
                    format!("Could not initialize the Last.fm network client: {error}")
                })
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub(super) fn transient_lastfm_transport_error(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_timeout()
}

pub(super) fn retryable_lastfm_failure(
    policy: LastFmRetryPolicy,
    retry_number: u32,
    transient_failure: bool,
) -> bool {
    policy == LastFmRetryPolicy::IdempotentWrite
        && transient_failure
        && retry_number < LASTFM_MAX_TRANSIENT_RETRIES
}

// Outcome logs carry only the fixed API method name, a bounded error
// category, and timing. Parameter values, credentials, and remote response
// text never reach the log.
fn log_lastfm_success(method: &str, attempts: u32, started: Instant) {
    tracing::info!(
        target: "coda::lastfm",
        operation = method,
        status = "ok",
        attempts,
        elapsed_ms = started.elapsed().as_millis(),
    );
}

fn log_lastfm_failure(method: &str, error_category: &str, attempts: u32, started: Instant) {
    tracing::warn!(
        target: "coda::lastfm",
        operation = method,
        status = "failed",
        error_category,
        attempts,
        elapsed_ms = started.elapsed().as_millis(),
    );
}

pub(super) async fn lastfm_request(
    mut parameters: BTreeMap<String, String>,
    retry_policy: LastFmRetryPolicy,
) -> Result<Value, String> {
    require_lastfm_configuration()?;
    let method = parameters
        .get("method")
        .cloned()
        .unwrap_or_else(|| "unknown".into());
    let started = Instant::now();
    parameters.insert("api_key".into(), LASTFM_API_KEY.into());
    let signature = lastfm_signature(&parameters);
    parameters.insert("api_sig".into(), signature);
    parameters.insert("format".into(), "json".into());

    let client = lastfm_http_client()?;
    let mut retry_number = 0;
    let response = loop {
        match client
            .post(LASTFM_API_ENDPOINT)
            .form(&parameters)
            .send()
            .await
        {
            Ok(response)
                if retryable_lastfm_failure(
                    retry_policy,
                    retry_number,
                    is_retryable_bandcamp_status(response.status()),
                ) =>
            {
                let jitter_ms = rand::thread_rng().gen_range(0..=BANDCAMP_RETRY_JITTER_MS);
                let delay = bandcamp_retry_delay(
                    Some(response.headers()),
                    retry_number,
                    SystemTime::now(),
                    jitter_ms,
                );
                retry_number += 1;
                tokio::time::sleep(delay).await;
            }
            Ok(response) => break response,
            Err(error)
                if retryable_lastfm_failure(
                    retry_policy,
                    retry_number,
                    transient_lastfm_transport_error(&error),
                ) =>
            {
                let jitter_ms = rand::thread_rng().gen_range(0..=BANDCAMP_RETRY_JITTER_MS);
                let delay = bandcamp_retry_delay(None, retry_number, SystemTime::now(), jitter_ms);
                retry_number += 1;
                tokio::time::sleep(delay).await;
            }
            Err(error) => {
                log_lastfm_failure(&method, "network", retry_number + 1, started);
                return Err(redacted_request_error("Last.fm", error));
            }
        }
    };
    let attempts = retry_number + 1;

    let status = response.status();
    if !status.is_success() {
        log_lastfm_failure(
            &method,
            &format!("http_{}", status.as_u16()),
            attempts,
            started,
        );
        return Err(format!("Last.fm returned HTTP {}.", status.as_u16()));
    }
    let bytes = match read_bounded_response(response, MAX_LASTFM_RESPONSE_BYTES, "Last.fm").await {
        Ok(bytes) => bytes,
        Err(error) => {
            log_lastfm_failure(&method, "unreadable_response", attempts, started);
            return Err(error);
        }
    };
    let body = match run_blocking("Could not finish parsing the Last.fm response", move || {
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| "Last.fm returned an unreadable response.".to_string())
    })
    .await
    {
        Ok(body) => body,
        Err(error) => {
            log_lastfm_failure(&method, "unreadable_response", attempts, started);
            return Err(error);
        }
    };
    if body.get("error").is_some() {
        log_lastfm_failure(
            &method,
            &lastfm_api_error_category(&body),
            attempts,
            started,
        );
        return Err(lastfm_error_message(&body));
    }
    log_lastfm_success(&method, attempts, started);
    Ok(body)
}

fn lastfm_error_code(body: &Value) -> Option<u64> {
    body.get("error").and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
    })
}

pub(super) fn lastfm_api_error_category(body: &Value) -> String {
    match lastfm_error_code(body) {
        Some(code) => format!("api_error_{code}"),
        None => "api_error_unknown".into(),
    }
}

pub(super) fn lastfm_error_message(body: &Value) -> String {
    match lastfm_error_code(body) {
        Some(code) => format!("Last.fm rejected the request (error code {code})."),
        None => "Last.fm rejected the request.".into(),
    }
}

pub(super) fn lastfm_track_parameters(input: &LastFmTrackInput) -> BTreeMap<String, String> {
    let mut parameters = BTreeMap::from([
        ("artist".into(), input.artist.trim().into()),
        ("track".into(), input.title.trim().into()),
    ]);
    if !input.album.trim().is_empty() {
        parameters.insert("album".into(), input.album.trim().into());
    }
    if let Some(album_artist) = input
        .album_artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parameters.insert("albumArtist".into(), album_artist.into());
    }
    if let Some(music_brainz_id) = input.music_brainz_id.as_deref() {
        parameters.insert("mbid".into(), music_brainz_id.into());
    }
    if input.duration > 0 {
        parameters.insert("duration".into(), input.duration.to_string());
    }
    if input.track_number > 0 {
        parameters.insert("trackNumber".into(), input.track_number.to_string());
    }
    parameters
}

pub(super) fn lastfm_scrobble_parameters(input: &LastFmTrackInput) -> BTreeMap<String, String> {
    let mut parameters = lastfm_track_parameters(input);
    if let Some(chosen_by_user) = input.chosen_by_user {
        parameters.insert(
            "chosenByUser".into(),
            if chosen_by_user { "1" } else { "0" }.into(),
        );
    }
    parameters
}

#[tauri::command]
pub(super) async fn lastfm_status() -> Result<LastFmStatus, String> {
    run_blocking("Could not finish checking the Last.fm connection", || {
        Ok(lastfm_status_value())
    })
    .await
}

#[tauri::command]
pub(super) async fn lastfm_begin_auth() -> Result<LastFmAuthorization, String> {
    require_lastfm_configuration()?;
    let body = lastfm_request(
        BTreeMap::from([("method".into(), "auth.getToken".into())]),
        LastFmRetryPolicy::Never,
    )
    .await?;
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "Last.fm did not return an authorization token.".to_string())?
        .to_string();
    validate_lastfm_token(&token)?;
    let mut authorization_url = Url::parse(LASTFM_AUTH_ENDPOINT)
        .map_err(|_| "The built-in Last.fm authorization URL is invalid.".to_string())?;
    authorization_url
        .query_pairs_mut()
        .append_pair("api_key", LASTFM_API_KEY)
        .append_pair("token", &token);
    Ok(LastFmAuthorization {
        authorization_url: authorization_url.to_string(),
        token,
    })
}

#[tauri::command]
pub(super) async fn lastfm_complete_auth(token: String) -> Result<LastFmStatus, String> {
    require_lastfm_configuration()?;
    validate_lastfm_token(&token)?;
    let body = lastfm_request(
        BTreeMap::from([
            ("method".into(), "auth.getSession".into()),
            ("token".into(), token),
        ]),
        LastFmRetryPolicy::Never,
    )
    .await?;
    let session = body
        .get("session")
        .ok_or_else(|| "Last.fm did not return a session.".to_string())?;
    let saved = LastFmSession {
        username: session
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Last.fm did not return an account name.".to_string())?
            .to_string(),
        key: session
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "Last.fm did not return a session key.".to_string())?
            .to_string(),
    };
    let status = LastFmStatus {
        configured: true,
        connected: true,
        username: Some(saved.username.clone()),
    };
    run_blocking("Could not finish saving the Last.fm session", move || {
        store_lastfm_session(&saved)
    })
    .await?;
    Ok(status)
}

#[tauri::command]
pub(super) async fn lastfm_disconnect() -> Result<LastFmStatus, String> {
    run_blocking("Could not finish disconnecting Last.fm", || {
        LASTFM_SESSION.mutate(|| match lastfm_session_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Could not remove the Last.fm session: {error}")),
        })?;
        Ok(LastFmStatus {
            configured: lastfm_configured(),
            connected: false,
            username: None,
        })
    })
    .await
}

#[tauri::command]
pub(super) async fn lastfm_update_now_playing(input: LastFmTrackInput) -> Result<(), String> {
    validate_lastfm_track(&input)?;
    let session = require_lastfm_session_async().await?;
    let mut parameters = lastfm_track_parameters(&input);
    parameters.insert("method".into(), "track.updateNowPlaying".into());
    parameters.insert("sk".into(), session.key);
    lastfm_request(parameters, LastFmRetryPolicy::IdempotentWrite).await?;
    Ok(())
}

#[tauri::command]
pub(super) async fn lastfm_scrobble(input: LastFmScrobbleInput) -> Result<(), String> {
    validate_lastfm_track(&input.track)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is invalid.".to_string())?
        .as_secs();
    if input.timestamp == 0 || input.timestamp > now.saturating_add(60) {
        return Err("The Last.fm scrobble timestamp is invalid.".into());
    }
    let session = require_lastfm_session_async().await?;
    let mut parameters = lastfm_scrobble_parameters(&input.track);
    parameters.insert("method".into(), "track.scrobble".into());
    parameters.insert("sk".into(), session.key);
    parameters.insert("timestamp".into(), input.timestamp.to_string());
    lastfm_request(parameters, LastFmRetryPolicy::Never).await?;
    Ok(())
}
