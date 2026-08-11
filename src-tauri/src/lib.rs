use governor::DefaultDirectRateLimiter;
use redb::{Database, TableDefinition};
use reqwest::Client;
use std::collections::BTreeMap;
use std::sync::{atomic::AtomicU64, Mutex, OnceLock};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

mod album_cache;
mod app_identity;
mod bandcamp_http;
mod desktop;
mod discover;
mod lastfm;
mod library;
mod library_cache;
#[cfg(target_os = "macos")]
mod macos_window;
mod media_session;
mod models;
mod player_state;
mod playlists;
mod radio;
mod storage;
mod subsonic;
mod system_media;
mod url_policy;
mod validation;

#[cfg(desktop)]
use desktop::{
    ensure_window_is_visible, should_maximize_main_window_on_startup, show_main_window,
    toggle_mini_player,
};
use discover::discover;
use lastfm::{
    lastfm_begin_auth, lastfm_complete_auth, lastfm_disconnect, lastfm_scrobble, lastfm_status,
    lastfm_update_now_playing,
};
use library::{
    connect, disconnect, fetch_album, fetch_library, has_connection, load_library_cache,
};
use media_session::{
    update_system_media_metadata, update_system_media_playback, update_system_media_timeline,
};
#[cfg(target_os = "windows")]
use models::SystemMediaControlEvent;
#[cfg(desktop)]
use models::SystemMediaState;
use player_state::{
    checkpoint_player_state, clear_player_state, load_player_state, player_state_contract_version,
    record_player_state_diagnostic, save_player_state,
};
use playlists::{
    create_playlist, delete_playlist, fetch_playlist, fetch_playlists, get_cover_url,
    get_stream_url, update_playlist,
};
use radio::{radio_show, radio_shows};

#[cfg(desktop)]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const CREDENTIAL_KEY: &str = "subsonic";
const SERVER_BASE: &str = "https://bandcamp.com/api/subsonic";
const DISCOVER_ENDPOINT: &str = "https://bandcamp.com/api/discover/1/discover_web";
const RADIO_LIST_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/list";
const RADIO_SHOWS_ENDPOINT: &str = "https://bandcamp.com/api/radio_api/1/get_radio_shows";
const RADIO_SHOW_ENDPOINT: &str = "https://bandcamp.com/api/bcweekly/2/get";
const API_VERSION: &str = "1.16.1";
const MAX_CREDENTIAL_LENGTH: usize = 512;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const BANDCAMP_REQUESTS_PER_SECOND: u32 = 2;
const BANDCAMP_MAX_READ_RETRIES: u32 = 2;
const BANDCAMP_RETRY_BASE_MS: u64 = 400;
const BANDCAMP_RETRY_JITTER_MS: u64 = 180;
const BANDCAMP_MAX_RETRY_DELAY: Duration = Duration::from_secs(30);
const BANDCAMP_RATE_LIMIT_JITTER: Duration = Duration::from_millis(80);
const MAX_PLAYLISTS: usize = 5_000;
const MAX_PLAYLIST_TRACKS: usize = 25_000;
const MAX_PLAYLIST_MUTATION_ITEMS: usize = 5_000;
const MAX_PLAYLIST_NAME_LENGTH: usize = 256;
const MAX_PLAYLIST_COMMENT_LENGTH: usize = 4_096;
const MAX_SUBSONIC_TEXT_LENGTH: usize = 1_024;
const MAX_SUBSONIC_DURATION_SECONDS: u64 = 10 * 365 * 24 * 60 * 60;
const DISCOVER_PAGE_SIZE: usize = 40;
const MAX_DISCOVER_TAG_LENGTH: usize = 64;
const MAX_DISCOVER_CURSOR_LENGTH: usize = 2_048;
const MAX_RADIO_SHOWS: usize = 1_000;
const RADIO_SHOW_PAGE_SIZE: u64 = 24;
const MAX_RADIO_CURSOR_LENGTH: usize = 128;
const MAX_RADIO_CHAPTERS: usize = 256;
const MAX_RADIO_TEXT_LENGTH: usize = 4_096;
const MAX_RADIO_DURATION_SECONDS: f64 = 24.0 * 60.0 * 60.0;
const RADIO_SERIES_CATALOG: &[(u64, &str, &str)] = &[
    (1, "Bandcamp Electronic", "bandcamp-electronic"),
    (2, "Bandcamp Selects", "bandcamp-selects"),
    (4, "The Game Show", "the-game-show"),
    (5, "The Hip Hop Show", "the-hip-hop-show"),
    (6, "The Indie Show", "the-indie-show"),
    (7, "The Metal Show", "the-metal-show"),
];
const LIBRARY_CACHE_VERSION: u8 = 1;
const LIBRARY_CACHE_FILE: &str = "library-cache-v1.json";
const LIBRARY_CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const LIBRARY_FULL_RECONCILE_INTERVAL_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_LIBRARY_ALBUMS: usize = 5_000;
const MAX_LIBRARY_CACHE_BYTES: usize = 32 * 1024 * 1024;
const ALBUM_METADATA_CACHE_FILE: &str = "album-metadata-cache-v1.redb";
const ALBUM_TRACK_CACHE_ENTRY_VERSION: u8 = 1;
const PERSISTED_ALBUM_TRACK_CACHE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_ENTRIES: usize = 256;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_WEIGHT: usize = 4_096;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PERSISTED_ALBUM_TRACK_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const MAX_PERSISTED_ALBUM_TRACK_CACHE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const REDB_ALBUM_METADATA_MEMORY_CACHE_BYTES: usize = 8 * 1024 * 1024;
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
const LASTFM_SHARED_SECRET: &str = match option_env!("CODA_LASTFM_SHARED_SECRET") {
    Some(value) => value,
    None => "",
};
const MAX_LASTFM_METADATA_LENGTH: usize = 1_024;
const MAX_LASTFM_RESPONSE_BYTES: usize = 1024 * 1024;
const PLAYER_STATE_VERSION: u8 = 1;
const PLAYER_STATE_CONTRACT_VERSION: u8 = 2;
const PLAYER_STATE_FILE: &str = "player-state.json";
const PLAYER_CHECKPOINT_FILE: &str = "player-state-checkpoint.json";
const PLAYER_DIAGNOSTIC_FILE: &str = "player-state-diagnostic.log";
const MAX_PLAYER_DIAGNOSTIC_BYTES: u64 = 64 * 1024;
const MAX_PLAYER_STATE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PLAYER_CHECKPOINT_BYTES: usize = 16 * 1024;
const MAX_SYSTEM_MEDIA_ARTWORK_BYTES: usize = 5 * 1024 * 1024;
const MAX_SYSTEM_MEDIA_ARTWORK_CACHE: usize = 32;
const MAX_PLAYER_QUEUE_LENGTH: usize = 25_000;
const MAX_PLAYER_TEXT_LENGTH: usize = 1_024;
const MAX_PLAYER_SECONDS: f64 = 7.0 * 24.0 * 60.0 * 60.0;
const MAX_PLAYER_TRACK_NUMBER: u64 = 100_000;
const MAX_PLAYER_TIMESTAMP_MS: u64 = 8_640_000_000_000_000;
const MAX_RADIO_CHAPTER_KEY_LENGTH: usize = 128;

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static LASTFM_HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static BANDCAMP_RATE_LIMITER: OnceLock<DefaultDirectRateLimiter> = OnceLock::new();
static PLAYER_STATE_LOCK: Mutex<()> = Mutex::new(());
static LIBRARY_CACHE_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static ALBUM_METADATA_DATABASE_INIT_LOCK: Mutex<()> = Mutex::new(());
static CONNECTION_GENERATION: AtomicU64 = AtomicU64::new(0);
static LIBRARY_SYNC_GENERATION: AtomicU64 = AtomicU64::new(0);
static ALBUM_METADATA_DATABASE: OnceLock<Database> = OnceLock::new();
static ALBUM_REFRESH_GENERATIONS: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
const ALBUM_TRACKS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("album_tracks_v1");

#[cfg(desktop)]
fn with_window_state_plugin<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                StateFlags::POSITION
                    | StateFlags::SIZE
                    | StateFlags::MAXIMIZED
                    | StateFlags::VISIBLE,
            )
            .with_denylist(&["mini-player"])
            .build(),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = system_media::set_process_app_user_model_id();
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        show_main_window(app);
    }));
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());
    #[cfg(desktop)]
    let builder = with_window_state_plugin(builder);

    builder
        .on_page_load(|webview, _| {
            if webview.label() == "main" {
                let window = webview.window();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                let should_maximize_main_window = app
                    .path()
                    .app_config_dir()
                    .map(|directory| should_maximize_main_window_on_startup(&directory))
                    .unwrap_or(false);
                if should_maximize_main_window {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.maximize();
                    }
                }
                ensure_window_is_visible(app);
                app.manage(SystemMediaState::new());

                #[cfg(target_os = "macos")]
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = macos_window::install_centered_title(&window) {
                        eprintln!("Could not install Coda's centered native title: {error}");
                    }
                }

                let product_name = app
                    .config()
                    .product_name
                    .clone()
                    .unwrap_or_else(|| "Coda".to_string());
                let show = MenuItem::with_id(
                    app,
                    "show",
                    format!("Show {product_name}"),
                    true,
                    None::<&str>,
                )?;
                let mini_player =
                    MenuItem::with_id(app, "mini-player", "Mini Player", true, None::<&str>)?;
                let play_pause =
                    MenuItem::with_id(app, "play-pause", "Play / Pause", true, None::<&str>)?;
                let previous =
                    MenuItem::with_id(app, "previous", "Previous Track", true, None::<&str>)?;
                let next = MenuItem::with_id(app, "next", "Next Track", true, None::<&str>)?;
                let shuffle = MenuItem::with_id(
                    app,
                    "shuffle-library",
                    "Shuffle Entire Library",
                    true,
                    None::<&str>,
                )?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = MenuItem::with_id(
                    app,
                    "quit",
                    format!("Quit {product_name}"),
                    true,
                    None::<&str>,
                )?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &show,
                        &mini_player,
                        &separator,
                        &play_pause,
                        &previous,
                        &next,
                        &shuffle,
                        &PredefinedMenuItem::separator(app)?,
                        &quit,
                    ],
                )?;

                TrayIconBuilder::with_id("coda-tray")
                    .icon(
                        app.default_window_icon()
                            .cloned()
                            .ok_or("Coda's tray icon is unavailable.")?,
                    )
                    .tooltip(product_name)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "mini-player" => toggle_mini_player(app, None, None),
                        "play-pause" | "previous" | "next" | "shuffle-library" => {
                            let _ = app.emit("coda://tray-control", event.id().as_ref());
                        }
                        "quit" => {
                            show_main_window(app);
                            let _ = app.save_window_state(
                                StateFlags::POSITION
                                    | StateFlags::SIZE
                                    | StateFlags::MAXIMIZED
                                    | StateFlags::VISIBLE,
                            );
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            position,
                            rect,
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            toggle_mini_player(tray.app_handle(), Some(rect), Some(position));
                        }
                    })
                    .build(app)?;
                // A prior close intentionally hides the window in the tray. Make an
                // explicit app launch visible regardless of the restored window state.
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            has_connection,
            connect,
            disconnect,
            load_library_cache,
            player_state_contract_version,
            record_player_state_diagnostic,
            load_player_state,
            save_player_state,
            checkpoint_player_state,
            clear_player_state,
            lastfm_status,
            lastfm_begin_auth,
            lastfm_complete_auth,
            lastfm_disconnect,
            lastfm_update_now_playing,
            lastfm_scrobble,
            fetch_library,
            fetch_album,
            fetch_playlists,
            fetch_playlist,
            create_playlist,
            update_playlist,
            delete_playlist,
            get_stream_url,
            get_cover_url,
            discover,
            radio_shows,
            radio_show,
            update_system_media_metadata,
            update_system_media_playback,
            update_system_media_timeline
        ])
        .run(tauri::generate_context!())
        .expect("error while running Coda");
}

#[cfg(test)]
mod tests;
