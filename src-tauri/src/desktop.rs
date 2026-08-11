#[cfg(desktop)]
use std::path::Path;
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
pub(super) fn should_maximize_main_window_for_state_lookup(
    state_file_exists: std::io::Result<bool>,
) -> bool {
    matches!(state_file_exists, Ok(false))
}

#[cfg(desktop)]
pub(super) fn should_maximize_main_window_on_startup(app_config_dir: &Path) -> bool {
    let state_path = app_config_dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);
    should_maximize_main_window_for_state_lookup(state_path.try_exists())
}

#[cfg(desktop)]
pub(super) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("mini-player") {
        let _ = window.hide();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
pub(super) fn toggle_mini_player(
    app: &tauri::AppHandle,
    event_rect: Option<tauri::Rect>,
    event_position: Option<tauri::PhysicalPosition<f64>>,
) {
    let Some(window) = app.get_webview_window("mini-player") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    let tray_rect = event_rect.or_else(|| {
        app.tray_by_id("coda-tray")
            .and_then(|tray| tray.rect().ok().flatten())
    });
    let approximate_scale = window.scale_factor().unwrap_or(1.0);
    let approximate_tray_center = tray_rect.map(|rect| {
        let position = rect.position.to_physical::<i32>(approximate_scale);
        let size = rect.size.to_physical::<u32>(approximate_scale);
        (
            f64::from(position.x) + f64::from(size.width) / 2.0,
            f64::from(position.y) + f64::from(size.height) / 2.0,
        )
    });
    let monitor = event_position
        .and_then(|position| {
            app.monitor_from_point(position.x, position.y)
                .ok()
                .flatten()
        })
        .or_else(|| {
            approximate_tray_center.and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten())
        })
        .or_else(|| {
            app.get_webview_window("main")
                .and_then(|main| main.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    };
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();
    let area = [
        work_area.position.x,
        work_area.position.y,
        i32::try_from(work_area.size.width).unwrap_or(i32::MAX),
        i32::try_from(work_area.size.height).unwrap_or(i32::MAX),
    ];
    let tray = tray_rect
        .map(|rect| {
            let position = rect.position.to_physical::<i32>(scale_factor);
            let size = rect.size.to_physical::<u32>(scale_factor);
            [
                position.x,
                position.y,
                i32::try_from(size.width).unwrap_or(i32::MAX),
                i32::try_from(size.height).unwrap_or(i32::MAX),
            ]
        })
        .unwrap_or_else(|| {
            [
                area[0].saturating_add(area[2]).saturating_sub(32),
                area[1],
                24,
                24,
            ]
        });
    let size = tauri::LogicalSize::new(368.0, 240.0).to_physical::<u32>(scale_factor);
    let position = mini_player_position(tray, [size.width, size.height], area);
    let _ = window.set_position(tauri::PhysicalPosition::new(position[0], position[1]));
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(desktop)]
pub(super) fn mini_player_position(
    tray: [i32; 4],
    window: [u32; 2],
    monitor: [i32; 4],
) -> [i32; 2] {
    const EDGE_GUTTER: i64 = 8;
    const TRAY_GAP: i64 = 8;

    fn clamp_axis(
        desired: i64,
        monitor_start: i64,
        monitor_length: i64,
        window_length: i64,
    ) -> i32 {
        let minimum = monitor_start.saturating_add(EDGE_GUTTER);
        let maximum = monitor_start
            .saturating_add(monitor_length)
            .saturating_sub(window_length)
            .saturating_sub(EDGE_GUTTER)
            .max(minimum);
        desired.clamp(minimum, maximum) as i32
    }

    let [tray_x, tray_y, tray_width, tray_height] = tray.map(i64::from);
    let [window_width, window_height] = window.map(i64::from);
    let [monitor_x, monitor_y, monitor_width, monitor_height] = monitor.map(i64::from);
    let tray_center_x = tray_x.saturating_add(tray_width / 2);
    let tray_center_y = tray_y.saturating_add(tray_height / 2);
    let monitor_center_y = monitor_y.saturating_add(monitor_height / 2);
    let desired_x = tray_center_x.saturating_sub(window_width / 2);
    let desired_y = if tray_center_y <= monitor_center_y {
        tray_y.saturating_add(tray_height).saturating_add(TRAY_GAP)
    } else {
        tray_y
            .saturating_sub(window_height)
            .saturating_sub(TRAY_GAP)
    };

    [
        clamp_axis(desired_x, monitor_x, monitor_width, window_width),
        clamp_axis(desired_y, monitor_y, monitor_height, window_height),
    ]
}

#[cfg(desktop)]
pub(super) fn overlaps_monitor(window: [i32; 4], monitor: [i32; 4]) -> bool {
    let [window_x, window_y, window_width, window_height] = window;
    let [monitor_x, monitor_y, monitor_width, monitor_height] = monitor;
    let overlap_width = (window_x.saturating_add(window_width))
        .min(monitor_x.saturating_add(monitor_width))
        - window_x.max(monitor_x);
    let overlap_height = (window_y.saturating_add(window_height))
        .min(monitor_y.saturating_add(monitor_height))
        - window_y.max(monitor_y);
    overlap_width >= 80 && overlap_height >= 40
}

#[cfg(desktop)]
pub(super) fn ensure_window_is_visible(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let width = i32::try_from(size.width).unwrap_or(i32::MAX);
    let height = i32::try_from(size.height).unwrap_or(i32::MAX);
    let is_visible = monitors.iter().any(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_width = i32::try_from(monitor_size.width).unwrap_or(i32::MAX);
        let monitor_height = i32::try_from(monitor_size.height).unwrap_or(i32::MAX);
        overlaps_monitor(
            [position.x, position.y, width, height],
            [
                monitor_position.x,
                monitor_position.y,
                monitor_width,
                monitor_height,
            ],
        )
    });
    if is_visible {
        return;
    }

    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned());
    if let Some(monitor) = target {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let centered_x = monitor_position.x
            + (i32::try_from(monitor_size.width).unwrap_or(width) - width).max(0) / 2;
        let centered_y = monitor_position.y
            + (i32::try_from(monitor_size.height).unwrap_or(height) - height).max(0) / 2;
        let _ = window.set_position(tauri::PhysicalPosition::new(centered_x, centered_y));
    }
}
