use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LastFmScrobbleInput {
    pub(crate) track: LastFmTrackInput,
    pub(crate) timestamp: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
