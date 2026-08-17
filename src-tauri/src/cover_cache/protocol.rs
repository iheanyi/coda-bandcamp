use super::fetch::resolve_cover_art;
use super::store::valid_revision;
use super::ResolvedCoverArt;
use crate::subsonic::validate_identifier;
use percent_encoding::percent_decode_str;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::AppHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedCoverProtocolRequest {
    pub(crate) cover_art_id: String,
    pub(crate) revision: String,
    pub(crate) session_scope: String,
    pub(crate) head: bool,
}

fn valid_session_scope(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

pub(crate) fn parse_cover_protocol_request(
    method: &Method,
    path_and_query: &str,
) -> Result<ParsedCoverProtocolRequest, StatusCode> {
    let head = match *method {
        Method::GET => false,
        Method::HEAD => true,
        _ => return Err(StatusCode::METHOD_NOT_ALLOWED),
    };
    let (path, query) = path_and_query
        .split_once('?')
        .ok_or(StatusCode::BAD_REQUEST)?;
    let encoded_id = path
        .strip_prefix("/v1/600/")
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .ok_or(StatusCode::NOT_FOUND)?;
    let cover_art_id = percent_decode_str(encoded_id)
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .into_owned();
    if validate_identifier(&cover_art_id).is_err() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut revision = None;
    let mut session_scope = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            return Err(StatusCode::BAD_REQUEST);
        };
        match key {
            "v" if revision.is_none() && valid_revision(value) => {
                revision = Some(value.to_string());
            }
            "s" if session_scope.is_none() && valid_session_scope(value) => {
                session_scope = Some(value.to_string());
            }
            _ => return Err(StatusCode::BAD_REQUEST),
        }
    }
    Ok(ParsedCoverProtocolRequest {
        cover_art_id,
        revision: revision.ok_or(StatusCode::BAD_REQUEST)?,
        session_scope: session_scope.ok_or(StatusCode::BAD_REQUEST)?,
        head,
    })
}

fn protocol_error(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("the static cover protocol response is valid")
}

pub(crate) fn cover_protocol_success_response(
    resolved: ResolvedCoverArt,
    head: bool,
) -> Response<Vec<u8>> {
    let length = resolved.bytes.len();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, resolved.media_type)
        .header(header::CONTENT_LENGTH, length.to_string())
        // The source URL contains a renderer-generated session scope plus the
        // content revision. Disconnect and account replacement rotate the
        // scope, while an artwork update rotates the revision.
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header("X-Content-Type-Options", "nosniff")
        .body(if head { Vec::new() } else { resolved.bytes })
        .unwrap_or_else(|_| protocol_error(StatusCode::INTERNAL_SERVER_ERROR))
}

pub(crate) async fn cover_protocol_response(
    app: &AppHandle,
    webview_label: &str,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if !matches!(webview_label, "main" | "mini-player") {
        return protocol_error(StatusCode::FORBIDDEN);
    }
    let Some(path_and_query) = request.uri().path_and_query().map(|value| value.as_str()) else {
        return protocol_error(StatusCode::BAD_REQUEST);
    };
    let parsed = match parse_cover_protocol_request(request.method(), path_and_query) {
        Ok(parsed) => parsed,
        Err(status) => return protocol_error(status),
    };
    let resolved = match resolve_cover_art(app, &parsed.cover_art_id).await {
        Ok(resolved) => resolved,
        Err(_) => return protocol_error(StatusCode::NOT_FOUND),
    };
    cover_protocol_success_response(resolved, parsed.head)
}
