use super::*;

#[test]
fn main_window_keeps_native_chrome_enabled() {
    let config: Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).expect("valid Tauri config");
    let main_window = config["app"]["windows"]
        .as_array()
        .and_then(|windows| {
            windows
                .iter()
                .find(|window| window["label"].as_str() == Some("main"))
        })
        .expect("main window config");

    assert_eq!(main_window["decorations"], Value::Bool(true));
    assert_eq!(
        main_window["titleBarStyle"],
        Value::String("Visible".into())
    );
    assert_eq!(main_window["closable"], Value::Bool(true));
    assert_eq!(main_window["minimizable"], Value::Bool(true));
    assert_eq!(main_window["maximizable"], Value::Bool(true));
    assert_eq!(main_window["resizable"], Value::Bool(true));
    assert_ne!(
        main_window.get("maximized").and_then(Value::as_bool),
        Some(true)
    );
    assert_ne!(
        main_window.get("center").and_then(Value::as_bool),
        Some(true)
    );
    assert_ne!(
        main_window.get("fullscreen").and_then(Value::as_bool),
        Some(true)
    );
    assert_ne!(
        main_window.get("simpleFullscreen").and_then(Value::as_bool),
        Some(true)
    );
}

#[cfg(desktop)]
#[test]
fn window_state_plugin_registration_precedes_user_setup() {
    let source = include_str!("../lib.rs");
    let run_source = source
        .split_once("pub fn run()")
        .map(|(_, run_source)| run_source)
        .expect("run function");
    let setup_index = run_source.find(".setup(|app|").expect("user setup");
    let registration_index = run_source
        .find("let builder = with_window_state_plugin(builder);")
        .expect("static window-state plugin registration");

    assert!(
        registration_index < setup_index,
        "window-state plugin must be registered before user setup"
    );

    let setup_source = &run_source[setup_index
        ..run_source
            .find(".on_window_event")
            .expect("end of user setup")];
    assert!(
        !setup_source.contains("tauri_plugin_window_state::Builder"),
        "window-state plugin must not be registered dynamically in user setup"
    );
}

// Tauri's mock runtime test feature currently produces a test executable
// that cannot start on the hosted Windows runner. The source-order guard
// above still covers Windows; macOS and Linux exercise the runtime state.
#[cfg(all(desktop, not(target_os = "windows")))]
#[test]
fn window_state_plugin_is_initialized_before_user_setup_runs() {
    let setup_observed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let setup_observed_from_callback = setup_observed.clone();

    let mut app = with_window_state_plugin(tauri::test::mock_builder())
        .setup(move |app| {
            setup_observed_from_callback.store(
                app.handle().filename() == tauri_plugin_window_state::DEFAULT_FILENAME,
                std::sync::atomic::Ordering::SeqCst,
            );
            Ok(())
        })
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app with static window-state plugin");

    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    assert!(setup_observed.load(std::sync::atomic::Ordering::SeqCst));
    drop(app);
}

#[cfg(desktop)]
#[test]
fn first_launch_maximization_requires_an_absent_window_state_file() {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let app_config_dir = std::env::temp_dir().join(format!("coda-window-state-{suffix}"));
    let state_path = app_config_dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);

    assert!(should_maximize_main_window_on_startup(&app_config_dir));

    fs::create_dir_all(&app_config_dir).unwrap();
    fs::write(&state_path, b"{}").unwrap();
    assert!(!should_maximize_main_window_on_startup(&app_config_dir));

    fs::remove_file(state_path).unwrap();
    fs::remove_dir(app_config_dir).unwrap();
}

#[cfg(desktop)]
#[test]
fn window_state_lookup_errors_do_not_override_a_restored_window() {
    let error = std::io::Error::from(std::io::ErrorKind::PermissionDenied);

    assert!(!should_maximize_main_window_for_state_lookup(Err(error)));
}

#[test]
fn updater_plugin_is_enabled_only_for_the_production_identifier() {
    assert!(!updater_enabled_for_app_identifier("com.coda.bandcamp.dev"));
    assert!(updater_enabled_for_app_identifier(APP_ID));
    assert!(!updater_enabled_for_app_identifier(
        "com.coda.bandcamp.preview"
    ));
}

#[test]
fn windows_media_identity_matches_the_installer_and_disables_webview_keys() {
    let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let package: Value = serde_json::from_str(include_str!("../../../package.json")).unwrap();
    assert_eq!(
        config.get("version").and_then(Value::as_str),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(
        package.get("version").and_then(Value::as_str),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(
        config.get("identifier").and_then(Value::as_str),
        Some(APP_ID)
    );
    let browser_args = config
        .pointer("/app/windows/0/additionalBrowserArgs")
        .and_then(Value::as_str)
        .unwrap();
    let disabled_features = browser_args
        .strip_prefix("--disable-features=")
        .unwrap()
        .split(',')
        .collect::<BTreeSet<_>>();
    assert_eq!(
        disabled_features,
        BTreeSet::from([
            "HardwareMediaKeyHandling",
            "msPdfOOUI",
            "msSmartScreenProtection",
            "msWebOOUI",
        ])
    );
}

#[test]
fn desktop_dev_ignores_rust_build_artifacts_in_vite_watcher() {
    let package: Value = serde_json::from_str(include_str!("../../../package.json")).unwrap();
    assert_eq!(
        package.pointer("/scripts/web:dev").and_then(Value::as_str),
        Some("vite")
    );

    let vite_config = include_str!("../../../vite.config.ts");
    assert!(
        vite_config.contains(r#"ignored: ["**/src-tauri/target/**"]"#),
        "Vite must not recursively watch Rust build artifacts"
    );
}

#[cfg(desktop)]
#[test]
fn recognizes_windows_on_monitors_with_negative_coordinates() {
    assert!(overlaps_monitor(
        [-1_500, 120, 1_000, 700],
        [-1_920, 0, 1_920, 1_080]
    ));
    assert!(!overlaps_monitor(
        [4_000, 2_000, 1_000, 700],
        [-1_920, 0, 1_920, 1_080]
    ));
}

#[test]
fn monitor_overlap_math_is_saturating_for_extreme_coordinates() {
    assert!(!overlaps_monitor(
        [i32::MIN, i32::MIN, 1, 1],
        [i32::MAX, i32::MAX, 1, 1],
    ));
}

#[cfg(desktop)]
#[test]
fn positions_mini_player_below_a_top_menu_bar() {
    assert_eq!(
        mini_player_position([900, 0, 24, 24], [368, 240], [0, 0, 1_920, 1_080],),
        [728, 32],
    );
}

#[cfg(desktop)]
#[test]
fn positions_mini_player_above_a_bottom_taskbar() {
    assert_eq!(
        mini_player_position([900, 1_056, 24, 24], [368, 240], [0, 0, 1_920, 1_080],),
        [728, 808],
    );
}

#[cfg(desktop)]
#[test]
fn clamps_mini_player_inside_the_monitor_edges() {
    assert_eq!(
        mini_player_position([1_910, 0, 20, 24], [368, 240], [0, 0, 1_920, 1_080],),
        [1_544, 32],
    );
    assert_eq!(
        mini_player_position([-1_918, 0, 20, 24], [368, 240], [-1_920, 0, 1_920, 1_080],),
        [-1_912, 32],
    );
    assert_eq!(
        mini_player_position([150, 0, 20, 24], [300, 180], [0, 0, 320, 200],),
        [10, 12],
    );
}
