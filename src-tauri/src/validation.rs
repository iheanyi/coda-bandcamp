pub(crate) fn valid_musicbrainz_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

pub(crate) fn valid_bounded_text(value: &str, maximum: usize, required: bool) -> bool {
    value.len() <= maximum
        && !value.chars().any(char::is_control)
        && (!required || !value.trim().is_empty())
}
