use super::*;
// Child test modules import this module as a shared, test-only prelude.
#[allow(unused_imports)]
use crate::{
    album_cache::*, app_identity::*, bandcamp_http::*, cover_cache::*, daily::*, desktop::*,
    discover::*, favorites::*, lastfm::*, library::*, library_cache::*, media_session::*,
    models::*, player_state::*, playlists::*, radio::*, storage::*, subsonic::*, url_policy::*,
    validation::*,
};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{
    header::{HeaderMap, RETRY_AFTER},
    StatusCode,
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::PathBuf,
    time::{Duration, UNIX_EPOCH},
};

mod command_boundaries;
mod cover_cache;
mod cover_ordering;
mod daily;
mod desktop;
mod discover;
mod favorites;
mod lastfm;
mod library;
mod media_session;
mod player_state;
mod playlists;
mod radio;
mod subsonic;

fn sample_player_track(id: &str) -> PlayerStateTrack {
    PlayerStateTrack {
        id: id.into(),
        title: "Afterimage".into(),
        artist: "Night Archive".into(),
        album: "Soft Focus".into(),
        album_id: "album-1".into(),
        duration: 210,
        track: 2,
        disc: Some(1),
        cover_art: Some("cover-1".into()),
        palette: ["#cf6046".into(), "#2f2624".into()],
    }
}

fn sample_player_state() -> PlayerStateSnapshot {
    PlayerStateSnapshot {
        version: PLAYER_STATE_VERSION,
        saved_at: 1_700_000_000_000,
        persistence_generation: 0,
        queue: vec![sample_player_track("track-1")],
        current_index: 0,
        position_seconds: 42.0,
        volume: 0.72,
        repeat_mode: "all".into(),
        queue_open: true,
        last_fm_progress: Some(LastFmPlaybackProgress {
            track_id: "track-1".into(),
            started_at: 1_700_000_000,
            listened_seconds: 40.0,
            last_position: 42.0,
            now_playing_sent: true,
            scrobble_state: "sent".into(),
        }),
        radio_scrobble_progress: None,
    }
}

fn temporary_player_state_path(label: &str) -> PathBuf {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    std::env::temp_dir()
        .join(format!("coda-player-state-{label}-{suffix}"))
        .join(PLAYER_STATE_FILE)
}

fn sample_album(id: &str) -> Album {
    Album {
        id: id.into(),
        title: "Soft Focus".into(),
        artist: "Night Archive".into(),
        song_count: 9,
        duration: 2_460,
        cover_art: Some("cover-1".into()),
        year: Some(2026),
        genre: Some("Ambient".into()),
        added_at: Some("2026-07-25T02:00:00Z".into()),
        starred_at: Some("2026-07-25T03:00:00Z".into()),
        played_at: Some("2026-07-25T04:00:00Z".into()),
        original_release_date: Some(ItemDate {
            year: 2025,
            month: None,
            day: None,
        }),
        release_date: Some(ItemDate {
            year: 2026,
            month: Some(7),
            day: Some(25),
        }),
    }
}

fn sample_track(id: &str) -> Track {
    Track {
        id: id.into(),
        title: "Afterimage".into(),
        artist: "Night Archive".into(),
        album: "Soft Focus".into(),
        album_id: "album-1".into(),
        duration: 210,
        track: 1,
        disc: Some(1),
        album_artist: Some("Night Archive".into()),
        music_brainz_id: None,
        cover_art: Some("cover-1".into()),
        starred_at: None,
    }
}

fn temporary_library_cache_path(label: &str) -> PathBuf {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    std::env::temp_dir()
        .join(format!("coda-library-cache-{label}-{suffix}"))
        .join(LIBRARY_CACHE_FILE)
}

fn temporary_album_metadata_cache_path(label: &str) -> PathBuf {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    std::env::temp_dir()
        .join(format!("coda-album-metadata-cache-{label}-{suffix}"))
        .join(ALBUM_METADATA_CACHE_FILE)
}
