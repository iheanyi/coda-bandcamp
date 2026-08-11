use url::Url;

#[derive(Clone, Copy)]
pub(crate) enum UrlKind {
    BandcampPage,
    BandcampMedia,
}

pub(crate) fn allowed_url(value: &str, kind: UrlKind) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    let allowed = match kind {
        UrlKind::BandcampPage => host == "bandcamp.com" || host.ends_with(".bandcamp.com"),
        UrlKind::BandcampMedia => host == "bcbits.com" || host.ends_with(".bcbits.com"),
    };
    allowed.then(|| parsed.to_string())
}
