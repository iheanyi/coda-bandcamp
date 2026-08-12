#[test]
fn every_tauri_command_enters_through_the_async_runtime() {
    let sources = [
        ("discover", include_str!("../discover.rs")),
        ("favorites", include_str!("../favorites.rs")),
        ("lastfm", include_str!("../lastfm.rs")),
        ("library", include_str!("../library.rs")),
        ("media_session", include_str!("../media_session.rs")),
        ("player_state", include_str!("../player_state.rs")),
        ("playlists", include_str!("../playlists.rs")),
        ("radio", include_str!("../radio.rs")),
    ];

    let mut command_count = 0;
    for (module, source) in sources {
        let lines = source.lines().collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            command_count += 1;
            let signature = lines
                .iter()
                .skip(index + 1)
                .find(|candidate| !candidate.trim().is_empty())
                .expect("a command annotation must have a function signature");
            assert!(
                signature.contains(" async fn "),
                "{module} has a synchronous Tauri command after line {}: {signature}",
                index + 1
            );
        }
    }
    assert_eq!(
        command_count, 34,
        "the registered command inventory changed"
    );
}

#[test]
fn blocking_native_dependencies_stay_behind_explicit_boundaries() {
    let library = include_str!("../library.rs");
    assert!(library.contains("async fn has_connection"));
    assert!(library.contains("async fn disconnect"));
    assert!(library.contains("run_blocking"));

    let lastfm = include_str!("../lastfm.rs");
    assert!(lastfm.contains("async fn lastfm_status"));
    assert!(lastfm.contains("async fn lastfm_disconnect"));
    assert!(lastfm.contains("run_blocking"));

    let player_state = include_str!("../player_state.rs");
    assert!(player_state.contains("async fn record_player_state_diagnostic"));
    assert!(player_state.contains("run_blocking"));
}

#[test]
fn blocking_tasks_run_off_the_calling_thread() {
    let calling_thread = std::thread::current().id();
    let worker_thread = tauri::async_runtime::block_on(run_blocking(
        "Could not run the blocking-boundary test",
        || Ok(std::thread::current().id()),
    ))
    .unwrap();

    assert_ne!(calling_thread, worker_thread);
}

#[test]
fn production_modules_declare_their_dependencies_explicitly() {
    let sources = [
        ("album_cache", include_str!("../album_cache.rs")),
        ("bandcamp_http", include_str!("../bandcamp_http.rs")),
        ("desktop", include_str!("../desktop.rs")),
        ("discover", include_str!("../discover.rs")),
        ("favorites", include_str!("../favorites.rs")),
        ("lastfm", include_str!("../lastfm.rs")),
        ("library", include_str!("../library.rs")),
        ("library_cache", include_str!("../library_cache.rs")),
        ("media_session", include_str!("../media_session.rs")),
        ("models", include_str!("../models.rs")),
        ("player_state", include_str!("../player_state.rs")),
        ("playlists", include_str!("../playlists.rs")),
        ("radio", include_str!("../radio.rs")),
        ("storage", include_str!("../storage.rs")),
        ("subsonic", include_str!("../subsonic.rs")),
        ("url_policy", include_str!("../url_policy.rs")),
        ("validation", include_str!("../validation.rs")),
    ];

    for (module, source) in sources {
        assert!(
            !source.contains("use super::*;"),
            "{module} imports the entire composition root"
        );
    }

    let composition_root = include_str!("../lib.rs");
    for module in [
        "album_cache",
        "bandcamp_http",
        "desktop",
        "discover",
        "favorites",
        "lastfm",
        "library",
        "library_cache",
        "media_session",
        "models",
        "player_state",
        "playlists",
        "radio",
        "storage",
        "subsonic",
        "url_policy",
        "validation",
    ] {
        assert!(
            !composition_root.contains(&format!("use {module}::*;")),
            "the composition root imports all of {module}"
        );
    }
}

#[test]
fn chunked_responses_are_rejected_as_soon_as_the_bound_is_crossed() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 1_024];
        let _ = stream.read(&mut request);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n6\r\nabcdef\r\n6\r\nghijkl\r\n0\r\n\r\n",
            )
            .unwrap();
    });

    let result = tauri::async_runtime::block_on(async move {
        let response = reqwest::Client::new()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap();
        read_bounded_response(response, 10, "Test response").await
    });
    server.join().unwrap();

    assert_eq!(
        result.unwrap_err(),
        "Test response returned an unexpectedly large response."
    );
}
use super::*;
use std::net::TcpListener;
