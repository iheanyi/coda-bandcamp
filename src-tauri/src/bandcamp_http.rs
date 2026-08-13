use crate::storage::run_blocking;
use governor::{DefaultDirectRateLimiter, Jitter, Quota, RateLimiter};
use rand::Rng;
use reqwest::{
    header::{HeaderMap, RETRY_AFTER},
    redirect::Policy,
    Client, RequestBuilder, Response, StatusCode,
};
use serde::de::DeserializeOwned;
use std::num::NonZeroU32;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    OnceLock,
};
use std::time::{Duration, SystemTime};
use tokio::sync::Mutex as AsyncMutex;
use url::Url;

use crate::url_policy::{allowed_url, UrlKind};

pub(super) const MAX_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const BANDCAMP_REQUESTS_PER_SECOND: u32 = 2;
const BANDCAMP_MAX_READ_RETRIES: u32 = 2;
pub(super) const BANDCAMP_RETRY_BASE_MS: u64 = 400;
const BANDCAMP_RETRY_JITTER_MS: u64 = 180;
pub(super) const BANDCAMP_MAX_RETRY_DELAY: Duration = Duration::from_secs(30);
const BANDCAMP_RATE_LIMIT_JITTER: Duration = Duration::from_millis(80);

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static BANDCAMP_RATE_LIMITER: OnceLock<DefaultDirectRateLimiter> = OnceLock::new();
static BANDCAMP_REQUEST_START_LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
static BANDCAMP_FOREGROUND_WAITERS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BandcampRetryPolicy {
    Never,
    SafeRead,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BandcampRequestPriority {
    Foreground,
    Background,
}

struct ForegroundWaiter;

impl ForegroundWaiter {
    fn register() -> Self {
        BANDCAMP_FOREGROUND_WAITERS.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

impl Drop for ForegroundWaiter {
    fn drop(&mut self) {
        BANDCAMP_FOREGROUND_WAITERS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) fn bandcamp_rate_limiter() -> &'static DefaultDirectRateLimiter {
    BANDCAMP_RATE_LIMITER.get_or_init(|| {
        let requests_per_second = NonZeroU32::new(BANDCAMP_REQUESTS_PER_SECOND)
            .expect("the Bandcamp request rate must be non-zero");
        let burst = NonZeroU32::new(1).expect("the Bandcamp request burst must be non-zero");
        RateLimiter::direct(Quota::per_second(requests_per_second).allow_burst(burst))
    })
}

fn bandcamp_request_start_lock() -> &'static AsyncMutex<()> {
    BANDCAMP_REQUEST_START_LOCK.get_or_init(|| AsyncMutex::new(()))
}

pub(super) async fn wait_for_bandcamp_request_slot(priority: BandcampRequestPriority) {
    match priority {
        BandcampRequestPriority::Foreground => {
            // Register before waiting for the start lock so a background
            // revalidation that reaches the lock first still yields.
            let _waiter = ForegroundWaiter::register();
            let _start_guard = bandcamp_request_start_lock().lock().await;
            bandcamp_rate_limiter()
                .until_ready_with_jitter(Jitter::up_to(BANDCAMP_RATE_LIMIT_JITTER))
                .await;
        }
        BandcampRequestPriority::Background => loop {
            let start_guard = bandcamp_request_start_lock().lock().await;
            if BANDCAMP_FOREGROUND_WAITERS.load(Ordering::Acquire) != 0 {
                drop(start_guard);
                tokio::time::sleep(Duration::from_millis(10)).await;
                continue;
            }
            bandcamp_rate_limiter()
                .until_ready_with_jitter(Jitter::up_to(BANDCAMP_RATE_LIMIT_JITTER))
                .await;
            if BANDCAMP_FOREGROUND_WAITERS.load(Ordering::Acquire) == 0 {
                break;
            }
            drop(start_guard);
        },
    }
}

pub(super) fn retry_after_duration(headers: &HeaderMap, now: SystemTime) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds).min(BANDCAMP_MAX_RETRY_DELAY));
    }
    httpdate::parse_http_date(value)
        .ok()?
        .duration_since(now)
        .ok()
        .map(|duration| duration.min(BANDCAMP_MAX_RETRY_DELAY))
}

pub(super) fn bandcamp_retry_delay(
    headers: Option<&HeaderMap>,
    retry_number: u32,
    now: SystemTime,
    jitter_ms: u64,
) -> Duration {
    let exponential_ms = BANDCAMP_RETRY_BASE_MS.saturating_mul(1_u64 << retry_number.min(6));
    let base = headers
        .and_then(|headers| retry_after_duration(headers, now))
        .unwrap_or_else(|| Duration::from_millis(exponential_ms));
    base.saturating_add(Duration::from_millis(jitter_ms))
        .min(BANDCAMP_MAX_RETRY_DELAY)
}

pub(super) fn is_retryable_bandcamp_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::REQUEST_TIMEOUT
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

pub(super) async fn send_bandcamp_request(
    request: RequestBuilder,
    context: &str,
    retry_policy: BandcampRetryPolicy,
) -> Result<Response, String> {
    send_bandcamp_request_with_priority(
        request,
        context,
        retry_policy,
        BandcampRequestPriority::Foreground,
    )
    .await
}

pub(super) async fn send_bandcamp_request_with_priority(
    request: RequestBuilder,
    context: &str,
    retry_policy: BandcampRetryPolicy,
    priority: BandcampRequestPriority,
) -> Result<Response, String> {
    let mut retry_number = 0;
    loop {
        wait_for_bandcamp_request_slot(priority).await;
        let attempt = request
            .try_clone()
            .ok_or_else(|| format!("Could not prepare a retry-safe request for {context}."))?;
        match attempt.send().await {
            Ok(response)
                if retry_policy == BandcampRetryPolicy::SafeRead
                    && retry_number < BANDCAMP_MAX_READ_RETRIES
                    && is_retryable_bandcamp_status(response.status()) =>
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
            Ok(response) => return Ok(response),
            Err(error)
                if retry_policy == BandcampRetryPolicy::SafeRead
                    && retry_number < BANDCAMP_MAX_READ_RETRIES
                    && (error.is_connect() || error.is_timeout()) =>
            {
                let jitter_ms = rand::thread_rng().gen_range(0..=BANDCAMP_RETRY_JITTER_MS);
                let delay = bandcamp_retry_delay(None, retry_number, SystemTime::now(), jitter_ms);
                retry_number += 1;
                tokio::time::sleep(delay).await;
            }
            Err(error) => return Err(redacted_request_error(context, error)),
        }
    }
}

pub(super) fn redacted_request_error(context: &str, error: reqwest::Error) -> String {
    format!("Could not reach {context}: {}", error.without_url())
}

pub(super) async fn fetch_bounded_json_request<T>(
    request: RequestBuilder,
    context: &str,
) -> Result<T, String>
where
    T: DeserializeOwned + Send + 'static,
{
    let response = send_bandcamp_request(
        request.header(reqwest::header::ACCEPT, "application/json"),
        context,
        BandcampRetryPolicy::SafeRead,
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "{context} returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
    {
        return Err(format!("{context} returned an unexpected content type."));
    }
    let bytes = read_bounded_response(response, MAX_JSON_RESPONSE_BYTES, context).await?;
    let parse_context = context.to_string();
    run_blocking("Could not finish parsing a Bandcamp response", move || {
        serde_json::from_slice(&bytes)
            .map_err(|_| format!("{parse_context} returned an unexpected response."))
    })
    .await
}

pub(super) async fn fetch_bounded_json<T: DeserializeOwned + Send + 'static>(
    url: Url,
    context: &str,
) -> Result<T, String> {
    fetch_bounded_json_request(http_client()?.get(url), context).await
}

pub(super) async fn read_bounded_response(
    mut response: Response,
    maximum_bytes: usize,
    context: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum_bytes as u64)
    {
        return Err(format!(
            "{context} returned an unexpectedly large response."
        ));
    }
    let initial_capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or_default()
        .min(maximum_bytes);
    let mut bytes = Vec::with_capacity(initial_capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| format!("{context} returned an unreadable response."))?
    {
        if chunk.len() > maximum_bytes.saturating_sub(bytes.len()) {
            return Err(format!(
                "{context} returned an unexpectedly large response."
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) fn http_client() -> Result<&'static Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .https_only(true)
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(25))
                .user_agent("Coda/0.1 (+https://bandcamp.com)")
                .redirect(Policy::custom(|attempt| {
                    let url = attempt.url().as_str();
                    let allowed = allowed_url(url, UrlKind::BandcampPage).is_some()
                        || allowed_url(url, UrlKind::BandcampMedia).is_some();
                    if allowed && attempt.previous().len() < 3 {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .build()
                .map_err(|error| format!("Could not initialize the secure network client: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}
