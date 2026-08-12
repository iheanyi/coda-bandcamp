use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime};

pub(crate) const MAX_MEDIA_SECONDS: f64 = 7.0 * 24.0 * 60.0 * 60.0;
pub(crate) const MAX_METADATA_TEXT_LENGTH: usize = 1_024;
pub(crate) const MAX_RADIO_CHAPTERS: usize = 256;
pub(crate) const MAX_TRACK_NUMBER: u64 = 100_000;

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

pub(crate) fn bounded_trimmed_text(value: &str, maximum: usize) -> Option<&str> {
    let trimmed = value.trim();
    valid_bounded_text(trimmed, maximum, true).then_some(trimmed)
}

pub(crate) fn valid_library_date(value: &str) -> bool {
    if !valid_bounded_text(value, MAX_METADATA_TEXT_LENGTH, true) || value.trim() != value {
        return false;
    }
    if let Ok(date) = DateTime::parse_from_rfc3339(value) {
        return (1..=9_999).contains(&date.year())
            && date.offset().local_minus_utc().unsigned_abs() <= 14 * 60 * 60;
    }
    let naive_date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|date| date.year())
        .or_else(|_| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f").map(|date| date.year())
        })
        .or_else(|_| {
            NaiveDateTime::parse_from_str(value, "%d %b %Y %H:%M:%S%.f GMT").map(|date| date.year())
        });
    naive_date.is_ok_and(|year| (1..=9_999).contains(&year))
}
