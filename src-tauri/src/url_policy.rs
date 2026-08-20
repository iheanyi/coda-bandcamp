use url::Url;

#[derive(Clone, Copy)]
pub(crate) enum UrlKind {
    BandcampPage,
    BandcampMedia,
}

pub(crate) fn allowed_url(value: &str, kind: UrlKind) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some_and(|port| port != 443)
    {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    let allowed = match kind {
        UrlKind::BandcampPage => host == "bandcamp.com" || host.ends_with(".bandcamp.com"),
        UrlKind::BandcampMedia => host == "bcbits.com" || host.ends_with(".bcbits.com"),
    };
    allowed.then(|| parsed.to_string())
}

pub(crate) fn bcbits_album_art_url(image_id: u64) -> String {
    format!("https://f4.bcbits.com/img/a{image_id}_10.jpg")
}

pub(crate) fn bcbits_show_art_url(image_id: u64) -> String {
    format!("https://f4.bcbits.com/img/{image_id:010}_10.jpg")
}
