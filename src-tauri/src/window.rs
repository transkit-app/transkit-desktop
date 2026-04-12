use std::fs;

use crate::config::get;
use crate::config::set;
use crate::StringWrapper;
use crate::APP;
use dirs::cache_dir;
use log::{info, warn};
use tauri::Manager;
use tauri::Monitor;
use tauri::Window;
use tauri::WindowBuilder;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use window_shadows::set_shadow;

// Get daemon window instance
fn get_daemon_window() -> Window {
    let app_handle = APP.get().unwrap();
    match app_handle.get_window("daemon") {
        Some(v) => v,
        None => {
            warn!("Daemon window not found, create new daemon window!");
            WindowBuilder::new(
                app_handle,
                "daemon",
                tauri::WindowUrl::App("daemon.html".into()),
            )
            .title("Daemon")
            .additional_browser_args("--disable-web-security")
            .visible(false)
            .build()
            .unwrap()
        }
    }
}

// Get monitor where the mouse is currently located
fn get_current_monitor(x: i32, y: i32) -> Monitor {
    info!("Mouse position: {}, {}", x, y);
    let daemon_window = get_daemon_window();
    let monitors = daemon_window.available_monitors().unwrap();

    for m in monitors {
        let size = m.size();
        let position = m.position();

        if x >= position.x
            && x <= (position.x + size.width as i32)
            && y >= position.y
            && y <= (position.y + size.height as i32)
        {
            info!("Current Monitor: {:?}", m);
            return m;
        }
    }
    warn!("Current Monitor not found, using primary monitor");
    daemon_window.primary_monitor().unwrap().unwrap()
}

// Creating a window on the mouse monitor
fn build_window(label: &str, title: &str) -> (Window, bool) {
    use mouse_position::mouse_position::{Mouse, Position};

    let mouse_position = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Position { x, y },
        Mouse::Error => {
            warn!("Mouse position not found, using (0, 0) as default");
            Position { x: 0, y: 0 }
        }
    };
    let current_monitor = get_current_monitor(mouse_position.x, mouse_position.y);
    let position = current_monitor.position();

    let app_handle = APP.get().unwrap();
    match app_handle.get_window(label) {
        Some(v) => {
            info!("Window existence: {}", label);
            v.set_focus().unwrap_or_default();
            (v, true)
        }
        None => {
            info!("Window not existence, Creating new window: {}", label);
            let mut builder = tauri::WindowBuilder::new(
                app_handle,
                label,
                tauri::WindowUrl::App("index.html".into()),
            )
            .position(position.x.into(), position.y.into())
            .additional_browser_args("--disable-web-security")
            .focused(true)
            .title(title)
            .visible(false);

            #[cfg(target_os = "macos")]
            {
                // transparent(true) is required for CSS rgba backgrounds and backdrop-filter
                // to actually composite against the desktop. macOSPrivateApi: true in
                // tauri.conf.json clears the WKWebView opaque layer at startup.
                builder = builder
                    .transparent(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .minimizable(false)
                    .maximizable(false);
            }
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.transparent(true).decorations(false);
            }
            let window = builder.build().unwrap();

            if label != "screenshot" {
                #[cfg(not(target_os = "linux"))]
                set_shadow(&window, true).unwrap_or_default();
            }
            let _ = window.current_monitor();
            (window, false)
        }
    }
}

pub fn config_window() {
    let (window, _exists) = build_window("config", "Config");
    window
        .set_min_size(Some(tauri::LogicalSize::new(960, 600)))
        .unwrap();
    window.set_size(tauri::LogicalSize::new(960, 820)).unwrap();
    window.center().unwrap();
    // Config window must float above the Monitor overlay and all other windows.
    // This also prevents the window from being buried on macOS (where the app
    // runs as Accessory with no Dock icon), making always_on_top the reliable
    // way to keep the config window reachable.
    window.set_always_on_top(true).unwrap_or_default();

    #[cfg(target_os = "windows")]
    window.set_skip_taskbar(false).unwrap_or_default();
}

fn translate_window() -> Window {
    use mouse_position::mouse_position::{Mouse, Position};
    // Mouse physical position
    let mut mouse_position = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Position { x, y },
        Mouse::Error => {
            warn!("Mouse position not found, using (0, 0) as default");
            Position { x: 0, y: 0 }
        }
    };
    let (window, exists) = build_window("translate", "Translate");

    // Get Translate Window Size (needed for both new and reused windows)
    let width = match get("translate_window_width") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            if !exists {
                set("translate_window_width", 350);
            }
            350
        }
    };
    let height = match get("translate_window_height") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            if !exists {
                set("translate_window_height", 420);
            }
            420
        }
    };

    let monitor = window.current_monitor().unwrap().unwrap();
    let dpi = monitor.scale_factor();

    if !exists {
        window.set_skip_taskbar(true).unwrap();
        window
            .set_size(tauri::PhysicalSize::new(
                (width as f64) * dpi,
                (height as f64) * dpi,
            ))
            .unwrap();

        // Prevent destroy on close — hide instead so next invocation reuses the window.
        let win_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                win_clone.hide().unwrap_or_default();
            }
        });
    }

    let position_type = match get("translate_window_position") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => "mouse".to_string(),
    };

    match position_type.as_str() {
        "mouse" => {
            // Adjust window position to stay within monitor bounds
            let monitor_size = monitor.size();
            let monitor_size_width = monitor_size.width as f64;
            let monitor_size_height = monitor_size.height as f64;
            let monitor_position = monitor.position();
            let monitor_position_x = monitor_position.x as f64;
            let monitor_position_y = monitor_position.y as f64;

            if mouse_position.x as f64 + width as f64 * dpi
                > monitor_position_x + monitor_size_width
            {
                mouse_position.x -= (width as f64 * dpi) as i32;
                if (mouse_position.x as f64) < monitor_position_x {
                    mouse_position.x = monitor_position_x as i32;
                }
            }
            if mouse_position.y as f64 + height as f64 * dpi
                > monitor_position_y + monitor_size_height
            {
                mouse_position.y -= (height as f64 * dpi) as i32;
                if (mouse_position.y as f64) < monitor_position_y {
                    mouse_position.y = monitor_position_y as i32;
                }
            }

            window
                .set_position(tauri::PhysicalPosition::new(
                    mouse_position.x,
                    mouse_position.y,
                ))
                .unwrap();
        }
        _ => {
            let position_x = match get("translate_window_position_x") {
                Some(v) => v.as_i64().unwrap(),
                None => 0,
            };
            let position_y = match get("translate_window_position_y") {
                Some(v) => v.as_i64().unwrap(),
                None => 0,
            };
            window
                .set_position(tauri::PhysicalPosition::new(
                    (position_x as f64) * dpi,
                    (position_y as f64) * dpi,
                ))
                .unwrap();
        }
    }

    // Always show before emitting event. On Windows/WebView2 and Linux/WebKitGTK,
    // hidden windows can miss frontend event handling.
    window.show().unwrap_or_default();
    window.set_focus().unwrap_or_default();

    window
}

pub fn selection_translate() {
    use selection::get_text;
    // Get Selected Text
    let text = get_text();
    if text.trim().is_empty() {
        return;
    }
    let app_handle = APP.get().unwrap();
    // Write into State
    let state: tauri::State<StringWrapper> = app_handle.state();
    state.0.lock().unwrap().replace_range(.., &text);

    let window = translate_window();
    window.emit("new_text", text).unwrap();
}

pub fn input_translate() {
    let app_handle = APP.get().unwrap();
    // Clear State
    let state: tauri::State<StringWrapper> = app_handle.state();
    state
        .0
        .lock()
        .unwrap()
        .replace_range(.., "[INPUT_TRANSLATE]");
    let window = translate_window();
    let position_type = match get("translate_window_position") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => "mouse".to_string(),
    };
    if position_type == "mouse" {
        window.center().unwrap();
    }

    window.emit("new_text", "[INPUT_TRANSLATE]").unwrap();
}

pub fn text_translate(text: String) {
    let app_handle = APP.get().unwrap();
    // Clear State
    let state: tauri::State<StringWrapper> = app_handle.state();
    state.0.lock().unwrap().replace_range(.., &text);
    let window = translate_window();
    window.emit("new_text", text).unwrap();
}

pub fn image_translate() {
    let app_handle = APP.get().unwrap();
    let state: tauri::State<StringWrapper> = app_handle.state();
    state
        .0
        .lock()
        .unwrap()
        .replace_range(.., "[IMAGE_TRANSLATE]");
    let window = translate_window();
    window.emit("new_text", "[IMAGE_TRANSLATE]").unwrap();
}

pub fn recognize_window() {
    let (window, exists) = build_window("recognize", "Recognize");
    if exists {
        window.emit("new_image", "").unwrap();
        return;
    }
    let width = match get("recognize_window_width") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            set("recognize_window_width", 800);
            800
        }
    };
    let height = match get("recognize_window_height") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            set("recognize_window_height", 400);
            400
        }
    };
    let monitor = window.current_monitor().unwrap().unwrap();
    let dpi = monitor.scale_factor();
    window
        .set_size(tauri::PhysicalSize::new(
            (width as f64) * dpi,
            (height as f64) * dpi,
        ))
        .unwrap();
    window.center().unwrap();
    #[cfg(target_os = "windows")]
    window.set_skip_taskbar(false).unwrap_or_default();
    window.emit("new_image", "").unwrap();
}

#[cfg(not(target_os = "macos"))]
fn screenshot_window() -> Window {
    let (window, _exists) = build_window("screenshot", "Screenshot");

    window.set_skip_taskbar(true).unwrap();
    #[cfg(target_os = "macos")]
    {
        let monitor = window.current_monitor().unwrap().unwrap();
        let size = monitor.size();
        window.set_decorations(false).unwrap();
        window.set_size(*size).unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    window.set_fullscreen(true).unwrap();

    window.set_always_on_top(true).unwrap();
    window
}

pub fn ocr_recognize() {
    #[cfg(target_os = "macos")]
    {
        let app_handle = APP.get().unwrap();
        let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
        app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
        if !app_cache_dir_path.exists() {
            // 创建目录
            fs::create_dir_all(&app_cache_dir_path).expect("Create Cache Dir Failed");
        }
        app_cache_dir_path.push("transkit_screenshot_cut.png");

        let path = app_cache_dir_path.to_string_lossy().replace("\\\\?\\", "");
        println!("Screenshot path: {}", path);
        if let Ok(_output) = std::process::Command::new("/usr/sbin/screencapture")
            .arg("-i")
            .arg("-r")
            .arg(path)
            .output()
        {
            recognize_window();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = screenshot_window();
        let window_ = window.clone();
        window.listen("success", move |event| {
            recognize_window();
            window_.unlisten(event.id())
        });
    }
}
pub fn ocr_translate() {
    #[cfg(target_os = "macos")]
    {
        let app_handle = APP.get().unwrap();
        let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
        app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
        if !app_cache_dir_path.exists() {
            // 创建目录
            fs::create_dir_all(&app_cache_dir_path).expect("Create Cache Dir Failed");
        }
        app_cache_dir_path.push("transkit_screenshot_cut.png");

        let path = app_cache_dir_path.to_string_lossy().replace("\\\\?\\", "");
        println!("Screenshot path: {}", path);
        if let Ok(_output) = std::process::Command::new("/usr/sbin/screencapture")
            .arg("-i")
            .arg("-r")
            .arg(path)
            .output()
        {
            image_translate();
            ();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = screenshot_window();
        let window_ = window.clone();
        window.listen("success", move |event| {
            image_translate();
            window_.unlisten(event.id())
        });
    }
}

#[tauri::command(async)]
pub fn updater_window() {
    let (window, _exists) = build_window("updater", "Updater");
    window
        .set_min_size(Some(tauri::LogicalSize::new(600, 400)))
        .unwrap();
    window.set_size(tauri::LogicalSize::new(600, 400)).unwrap();
    window.center().unwrap();
    window.set_always_on_top(true).unwrap_or_default();
    window.show().unwrap_or_default();
    window.unminimize().unwrap_or_default();
    window.set_focus().unwrap_or_default();
    #[cfg(target_os = "windows")]
    window.set_skip_taskbar(false).unwrap_or_default();
}

#[tauri::command]
pub fn open_config_window() {
    config_window();
}

/// Tauri command: show the Voice Anywhere FAB (same as pressing the hotkey).
/// Called from the Config window when "Always visible" is enabled.
#[tauri::command]
pub fn show_voice_anywhere_window() {
    voice_anywhere_window();
}

/// Tauri command: hide the Voice Anywhere FAB.
/// Called from the Config window when "Always visible" is disabled.
#[tauri::command]
pub fn hide_voice_anywhere_window() {
    let app_handle = APP.get().unwrap();
    if let Some(window) = app_handle.get_window("voice_anywhere") {
        window.hide().unwrap_or_default();
    }
}

/// Show the Voice Anywhere FAB window.
///
/// Before revealing the window we snapshot which Transkit window currently has
/// OS focus (if any) so the transcript can be routed there.  The FAB window
/// itself is always-on-top and transparent, so it must never steal focus from
/// an in-use application — that is why it is declared with `focus: false` in
/// tauri.conf.json.
pub fn voice_anywhere_window() {
    let app_handle = APP.get().unwrap();

    // Record the currently focused Transkit window BEFORE showing the FAB.
    // voice_anywhere itself is excluded so toggling the shortcut while FAB is
    // visible doesn't overwrite the real target.
    {
        let state: tauri::State<crate::voice_anywhere::VoiceAnywhereState> =
            app_handle.state();
        let focused = app_handle
            .windows()
            .iter()
            .find(|(label, w)| {
                *label != "voice_anywhere" && w.is_focused().unwrap_or(false)
            })
            .map(|(label, _)| label.clone());
        *state.focused_window.lock().unwrap() = focused;
    }
    // Capture the frontmost external (non-Transkit) app for the "paste" inject mode.
    crate::voice_anywhere::capture_last_external_app(app_handle);

    if let Some(window) = app_handle.get_window("voice_anywhere") {
        // Disable the native OS window shadow for the FAB.
        // The shadow follows the window rectangle (not the circular FAB shape)
        // and creates a visible gray/blue border around the icon. CSS box-shadow
        // on the FAB element provides sufficient visual depth instead.
        #[cfg(not(target_os = "linux"))]
        set_shadow(&window, false).unwrap_or_default();

        // Resize + position the FAB window.
        // Size always reflects the current fab_size config.
        // Position: restore user-dragged location if saved; fall back to default bottom-right.
        if let Some(daemon) = app_handle.get_window("daemon") {
            if let Ok(Some(monitor)) = daemon.primary_monitor() {
                let size = monitor.size();
                let pos = monitor.position();
                let scale = monitor.scale_factor();
                let fab_logical: f64 = crate::config::get("voice_anywhere_fab_size")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(72.0);
                let padding_logical: f64 = 36.0;
                let win_logical: f64 = fab_logical + padding_logical * 2.0;
                // Always resize to match current fab_size
                let _ = window.set_size(tauri::LogicalSize::new(win_logical, win_logical));

                // Restore saved physical position if available, otherwise default bottom-right
                let saved = crate::config::get("voice_anywhere_pos_x")
                    .and_then(|x| crate::config::get("voice_anywhere_pos_y").map(|y| (x, y)))
                    .and_then(|(x, y)| Some((x.as_i64()? as i32, y.as_i64()? as i32)));

                let (wx, wy) = if let Some((sx, sy)) = saved {
                    // Clamp to keep window within current monitor bounds
                    let win_phys = (win_logical * scale) as i32;
                    let mx = pos.x;
                    let my = pos.y;
                    let mw = size.width as i32;
                    let mh = size.height as i32;
                    let cx = sx.max(mx).min(mx + mw - win_phys);
                    let cy = sy.max(my).min(my + mh - win_phys);
                    (cx, cy)
                } else {
                    let margin_logical: f64 = 28.0;
                    let offset = ((padding_logical + fab_logical + margin_logical) * scale) as i32;
                    (pos.x + size.width as i32 - offset, pos.y + size.height as i32 - offset)
                };
                let _ = window.set_position(tauri::PhysicalPosition::new(wx, wy));
            }
        }

        // Send a trigger event so the React component can start recording if
        // `voice_anywhere_autostart` is enabled.
        window.emit("voice_anywhere_trigger", ()).unwrap_or_default();
        window.show().unwrap_or_default();
    } else {
        warn!("voice_anywhere window not found — check tauri.conf.json");
    }
}

pub fn monitor_window() {
    let app_handle = APP.get().unwrap();
    // The monitor window is pre-declared in tauri.conf.json (transparent: true, visible: false).
    // macOSPrivateApi: true ensures Tauri sets up WKWebView transparency properly at creation time,
    // avoiding manual ObjC calls and the GCD-dispatch panic that those can trigger.
    if let Some(window) = app_handle.get_window("monitor") {
        // Enable shadow so Windows/macOS DWM properly composites rounded corners.
        // Without this the transparent window corners render as white squares on Windows.
        #[cfg(not(target_os = "linux"))]
        set_shadow(&window, true).unwrap_or_default();

        // Rust-side safety net: prevent OS-level close from destroying the window.
        // The JS onCloseRequested handler is the primary handler (it also calls hide),
        // but this catches any edge-cases where JS hasn't loaded yet.
        let win_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                win_clone.hide().unwrap_or_default();
            }
        });
        // On Windows: restore taskbar presence so the user can minimize/restore.
        #[cfg(target_os = "windows")]
        window.set_skip_taskbar(false).unwrap_or_default();

        // On Windows a minimized window must be unminimized before show/focus work correctly.
        window.unminimize().unwrap_or_default();
        window.center().unwrap_or_default();
        window.show().unwrap_or_default();
        window.set_focus().unwrap_or_default();
    }
}
