use crate::system_media;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{atomic::AtomicU64, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionInput {
    pub(crate) username: String,
    pub(crate) password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SystemMediaMetadataInput {
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) album: String,
    pub(crate) artwork_url: Option<String>,
    pub(crate) can_previous: bool,
    pub(crate) can_next: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemMediaControlEvent {
    pub(crate) action: String,
    pub(crate) position_seconds: Option<f64>,
}

pub(crate) struct SystemMediaState {
    pub(crate) session: Mutex<Option<system_media::NativeMediaSession>>,
    pub(crate) artwork_cache: Mutex<VecDeque<(String, system_media::SystemMediaArtwork)>>,
    pub(crate) metadata_generation: AtomicU64,
    pub(crate) playback_generation: AtomicU64,
    pub(crate) timeline_generation: AtomicU64,
}

impl SystemMediaState {
    pub(crate) fn new() -> Self {
        Self {
            session: Mutex::new(None),
            artwork_cache: Mutex::new(VecDeque::new()),
            metadata_generation: AtomicU64::new(0),
            playback_generation: AtomicU64::new(0),
            timeline_generation: AtomicU64::new(0),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ItemDate {
    pub(crate) year: u64,
    pub(crate) month: Option<u64>,
    pub(crate) day: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Album {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) song_count: u64,
    pub(crate) duration: u64,
    pub(crate) cover_art: Option<String>,
    pub(crate) year: Option<u64>,
    pub(crate) genre: Option<String>,
    pub(crate) added_at: Option<String>,
    pub(crate) starred_at: Option<String>,
    pub(crate) played_at: Option<String>,
    pub(crate) original_release_date: Option<ItemDate>,
    pub(crate) release_date: Option<ItemDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LibraryCacheSnapshot {
    pub(crate) version: u8,
    pub(crate) saved_at: u64,
    #[serde(default)]
    pub(crate) last_full_sync_at: u64,
    pub(crate) albums: Vec<Album>,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum LibrarySyncEvent {
    Page {
        page_index: u64,
        loaded: usize,
        albums: Vec<Album>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Track {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) album: String,
    pub(crate) album_id: String,
    pub(crate) duration: u64,
    pub(crate) track: u64,
    pub(crate) disc: Option<u64>,
    pub(crate) album_artist: Option<String>,
    pub(crate) music_brainz_id: Option<String>,
    pub(crate) cover_art: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersistedAlbumTracks {
    pub(crate) version: u8,
    pub(crate) saved_at: u64,
    pub(crate) album_id: String,
    pub(crate) tracks: Vec<Track>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) comment: Option<String>,
    pub(crate) owner: Option<String>,
    pub(crate) public: Option<bool>,
    pub(crate) song_count: u64,
    pub(crate) duration: u64,
    pub(crate) created_at: Option<String>,
    pub(crate) changed_at: Option<String>,
    pub(crate) cover_art: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistDetail {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) comment: Option<String>,
    pub(crate) owner: Option<String>,
    pub(crate) public: Option<bool>,
    pub(crate) song_count: u64,
    pub(crate) duration: u64,
    pub(crate) created_at: Option<String>,
    pub(crate) changed_at: Option<String>,
    pub(crate) cover_art: Option<String>,
    pub(crate) tracks: Vec<Track>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlaylistUpdateInput {
    pub(crate) playlist_id: String,
    pub(crate) name: Option<String>,
    pub(crate) comment: Option<String>,
    pub(crate) public: Option<bool>,
    #[serde(default)]
    pub(crate) song_ids_to_add: Vec<String>,
    #[serde(default)]
    pub(crate) song_indexes_to_remove: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlayerStateTrack {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) album: String,
    pub(crate) album_id: String,
    pub(crate) duration: u64,
    pub(crate) track: u64,
    pub(crate) disc: Option<u64>,
    pub(crate) cover_art: Option<String>,
    pub(crate) palette: [String; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LastFmPlaybackProgress {
    pub(crate) track_id: String,
    pub(crate) started_at: u64,
    pub(crate) listened_seconds: f64,
    pub(crate) last_position: f64,
    pub(crate) now_playing_sent: bool,
    pub(crate) scrobble_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RadioScrobbleProgress {
    pub(crate) show_track_id: String,
    pub(crate) active_chapter_key: Option<String>,
    pub(crate) chapter_started_at: u64,
    pub(crate) chapter_listened_seconds: f64,
    pub(crate) last_position: f64,
    pub(crate) chapter_now_playing_sent: bool,
    pub(crate) chapter_scrobble_state: String,
    pub(crate) show_started_at: u64,
    pub(crate) show_listened_seconds: f64,
    pub(crate) show_scrobble_state: String,
    pub(crate) scrobbled_chapter_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlayerStateSnapshot {
    pub(crate) version: u8,
    pub(crate) saved_at: u64,
    pub(crate) queue: Vec<PlayerStateTrack>,
    pub(crate) current_index: usize,
    pub(crate) position_seconds: f64,
    pub(crate) volume: f64,
    pub(crate) repeat_mode: String,
    pub(crate) queue_open: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_fm_progress: Option<LastFmPlaybackProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) radio_scrobble_progress: Option<RadioScrobbleProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlayerStateCheckpoint {
    pub(crate) current_index: usize,
    pub(crate) current_track_id: String,
    pub(crate) position_seconds: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_fm_progress: Option<LastFmPlaybackProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) radio_scrobble_progress: Option<RadioScrobbleProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastFmSession {
    pub(crate) username: String,
    pub(crate) key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastFmStatus {
    pub(crate) configured: bool,
    pub(crate) connected: bool,
    pub(crate) username: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastFmAuthorization {
    pub(crate) authorization_url: String,
    pub(crate) token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastFmTrackInput {
    pub(crate) artist: String,
    pub(crate) title: String,
    pub(crate) album: String,
    pub(crate) album_artist: Option<String>,
    pub(crate) music_brainz_id: Option<String>,
    pub(crate) duration: u64,
    pub(crate) track_number: u64,
    pub(crate) chosen_by_user: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastFmScrobbleInput {
    pub(crate) track: LastFmTrackInput,
    pub(crate) timestamp: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoverInput {
    pub(crate) tag: String,
    pub(crate) sort: String,
    pub(crate) cursor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoverPage {
    pub(crate) results: Vec<DiscoverRelease>,
    pub(crate) result_count: u64,
    pub(crate) cursor: Option<String>,
    pub(crate) has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoverRelease {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) genre: Option<String>,
    pub(crate) location: Option<String>,
    pub(crate) item_url: String,
    pub(crate) artwork_url: Option<String>,
    pub(crate) featured_track: Option<DiscoverTrack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoverTrack {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) duration: u64,
    pub(crate) stream_url: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawDiscoverPage {
    #[serde(default)]
    pub(crate) results: Vec<RawDiscoverRelease>,
    #[serde(default)]
    pub(crate) result_count: u64,
    pub(crate) cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawDiscoverRelease {
    pub(crate) item_id: Value,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) item_url: String,
    pub(crate) album_artist: Option<String>,
    pub(crate) band_name: Option<String>,
    pub(crate) band_location: Option<String>,
    pub(crate) genre: Option<String>,
    pub(crate) primary_image: Option<RawDiscoverImage>,
    pub(crate) featured_track: Option<RawDiscoverTrack>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawDiscoverImage {
    pub(crate) image_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawDiscoverTrack {
    pub(crate) id: Value,
    #[serde(default)]
    pub(crate) title: String,
    pub(crate) stream_url: Option<String>,
    pub(crate) duration: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RadioShowSummary {
    pub(crate) id: u64,
    pub(crate) subtitle: String,
    pub(crate) description: String,
    pub(crate) published_at: String,
    pub(crate) artwork_url: Option<String>,
    pub(crate) series: Option<RadioSeries>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RadioShow {
    pub(crate) id: u64,
    pub(crate) title: String,
    pub(crate) subtitle: String,
    pub(crate) description: String,
    pub(crate) published_at: String,
    pub(crate) artwork_url: Option<String>,
    pub(crate) duration: u64,
    pub(crate) stream_url: String,
    pub(crate) chapters: Vec<RadioChapter>,
    pub(crate) series: Option<RadioSeries>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RadioSeries {
    pub(crate) id: u64,
    pub(crate) title: String,
    pub(crate) slug: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RadioShowsPage {
    pub(crate) results: Vec<RadioShowSummary>,
    pub(crate) cursor: Option<String>,
    pub(crate) has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RadioChapter {
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) album: Option<String>,
    pub(crate) timecode: u64,
    pub(crate) item_url: Option<String>,
    pub(crate) artist_url: Option<String>,
    pub(crate) album_url: Option<String>,
    pub(crate) artwork_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawRadioList {
    #[serde(default)]
    pub(crate) results: Vec<RawRadioSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawRadioShowsPage {
    #[serde(default)]
    pub(crate) items: Vec<RawRadioSeriesShow>,
    pub(crate) next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawRadioSeriesShow {
    pub(crate) item_id: u64,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) description: String,
    #[serde(default)]
    pub(crate) date: String,
    pub(crate) image_id: Option<u64>,
    pub(crate) franchise_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RadioShowsRequest {
    pub(crate) page_size: u64,
    pub(crate) next_cursor: Option<String>,
    pub(crate) radio_franchise_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawRadioSummary {
    pub(crate) id: u64,
    #[serde(default)]
    pub(crate) subtitle: String,
    #[serde(default)]
    pub(crate) desc: String,
    #[serde(default)]
    pub(crate) published_date: String,
    pub(crate) v2_image_id: Option<u64>,
    pub(crate) screen_image_id: Option<u64>,
    pub(crate) image_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawRadioShow {
    pub(crate) show_id: u64,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) subtitle: String,
    #[serde(default)]
    pub(crate) desc: String,
    #[serde(default)]
    pub(crate) published_date: String,
    pub(crate) show_v2_image_id: Option<u64>,
    pub(crate) show_screen_image_id: Option<u64>,
    pub(crate) show_image_id: Option<u64>,
    pub(crate) audio_duration: Option<f64>,
    #[serde(default)]
    pub(crate) audio_stream: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) tracks: Vec<RawRadioChapter>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawRadioChapter {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) artist: String,
    pub(crate) album_title: Option<String>,
    pub(crate) timecode: Option<f64>,
    pub(crate) track_url: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) album_url: Option<String>,
    pub(crate) track_art_id: Option<u64>,
    pub(crate) url_hints: Option<RawRadioUrlHints>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawRadioUrlHints {
    pub(crate) subdomain: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct DiscoverRequest<'a> {
    pub(crate) category_id: u8,
    pub(crate) tag_norm_names: Vec<&'a str>,
    pub(crate) geoname_id: u8,
    pub(crate) slice: &'a str,
    pub(crate) time_facet_id: Option<u8>,
    pub(crate) cursor: &'a str,
    pub(crate) size: usize,
    pub(crate) include_result_types: [&'a str; 2],
    pub(crate) followed_bands: bool,
}
