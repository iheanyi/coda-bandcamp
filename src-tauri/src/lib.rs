use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

mod album_cache;
mod app_identity;
mod bandcamp_http;
mod cover_cache;
mod daily;
mod desktop;
mod discover;
mod favorites;
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

use cover_cache::{cover_cache_diagnostics, invalidate_cover_art, CoverCacheState};
use daily::{daily_article, daily_articles};
#[cfg(desktop)]
use desktop::{
    ensure_window_is_visible, should_maximize_main_window_on_startup, show_main_window,
    toggle_mini_player,
};
use discover::discover;
use favorites::{fetch_favorites, reconcile_favorite_tracks, set_favorite};
use lastfm::{
    lastfm_begin_auth, lastfm_complete_auth, lastfm_disconnect, lastfm_scrobble, lastfm_status,
    lastfm_update_now_playing,
};
use library::{
    connect, disconnect, fetch_album, fetch_library, has_connection, load_library_cache,
};
#[cfg(desktop)]
use media_session::SystemMediaState;
use media_session::{
    update_system_media_metadata, update_system_media_playback, update_system_media_timeline,
};
use player_state::{
    checkpoint_player_state, clear_player_state, load_player_state, player_state_contract_version,
    record_player_state_diagnostic, save_player_state,
};
use playlists::{
    create_playlist, delete_playlist, fetch_playlist, fetch_playlists, get_stream_url,
    update_playlist,
};
use radio::{radio_show, radio_shows};

#[cfg(desktop)]
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

fn updater_enabled_for_app_identifier(identifier: &str) -> bool {
    identifier == app_identity::APP_ID
}

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
    #[cfg(debug_assertions)]
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .try_init();
    let _ = system_media::set_process_app_user_model_id();
    let builder = tauri::Builder::default().register_asynchronous_uri_scheme_protocol(
        "coda-cover",
        |context, request, responder| {
            let app = context.app_handle().clone();
            let webview_label = context.webview_label().to_string();
            tauri::async_runtime::spawn(async move {
                responder.respond(
                    cover_cache::cover_protocol_response(&app, &webview_label, request).await,
                );
            });
        },
    );
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
            app.manage(CoverCacheState::initialize(app.handle())?);
            #[cfg(desktop)]
            {
                if updater_enabled_for_app_identifier(&app.config().identifier) {
                    app.handle()
                        .plugin(tauri_plugin_updater::Builder::new().build())?;
                }
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
                            if let Err(error) = cover_cache::flush_cover_art_accesses(app) {
                                eprintln!("Could not flush cover artwork access times: {error}");
                            }
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
            fetch_favorites,
            set_favorite,
            reconcile_favorite_tracks,
            fetch_playlists,
            fetch_playlist,
            create_playlist,
            update_playlist,
            delete_playlist,
            get_stream_url,
            invalidate_cover_art,
            cover_cache_diagnostics,
            daily_articles,
            daily_article,
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
