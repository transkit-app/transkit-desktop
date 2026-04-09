use std::sync::Mutex;
use tauri::Manager;
use crate::APP;
use log::{info, warn};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use window_shadows::set_shadow;

/// Shared state for Voice Anywhere feature.
pub struct VoiceAnywhereState {
    pub focused_window: Mutex<Option<String>>,
    /// Platform-specific identifier for the last focused external (non-Transkit) app.
    /// macOS  : app process name  e.g. "Zalo"
    /// Windows: HWND as decimal   e.g. "131072"
    /// Linux  : xdotool window ID e.g. "78901234"
    pub last_external_app: Mutex<Option<String>>,
}

impl VoiceAnywhereState {
    pub fn new() -> Self {
        Self {
            focused_window: Mutex::new(None),
            last_external_app: Mutex::new(None),
        }
    }
}

/// Snapshot the currently frontmost external application.
/// Called from voice_anywhere_window() BEFORE the FAB is shown, so the stored
/// value reflects the app the user was working in when they triggered the hotkey.
/// Only updates when no Transkit window (other than voice_anywhere itself) is focused —
/// this preserves the stored app when the user re-presses the hotkey from the FAB.
pub fn capture_last_external_app(app_handle: &tauri::AppHandle) {
    let transkit_focused = app_handle
        .windows()
        .iter()
        .any(|(label, w)| {
            label != "voice_anywhere"
                && label != "voice_anywhere_caption"
                && w.is_focused().unwrap_or(false)
        });
    if transkit_focused {
        info!("[VoiceAnywhere] capture_last_external_app: Transkit window focused — skipping capture");
        return;
    }
    match platform_get_frontmost_app() {
        Some(id) => {
            info!("[VoiceAnywhere] capture_last_external_app: captured '{}'", id);
            let state: tauri::State<VoiceAnywhereState> = app_handle.state();
            *state.last_external_app.lock().unwrap() = Some(id);
        }
        None => {
            warn!("[VoiceAnywhere] capture_last_external_app: platform returned None (Transkit frontmost or osascript failed)");
        }
    }
}

// ── macOS ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn platform_get_frontmost_app() -> Option<String> {
    use std::process::Command;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to get name of first application process whose frontmost is true"#)
        .output()
        .ok()?;
    if output.status.success() {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // Exclude TransKit itself
        if name.is_empty() || name.to_lowercase().contains("transkit") {
            None
        } else {
            Some(name)
        }
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn platform_focus_and_paste(app_name: &str) -> Result<(), String> {
    use std::process::Command;
    // Activate by process name via System Events — more reliable than
    // `tell application "{name}" to activate` which requires the bundle display
    // name and fails for apps whose process name differs (e.g. "Code" vs "Visual Studio Code").
    let safe = app_name.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"System Events\"\n\
            set frontmost of first process whose name is \"{safe}\" to true\n\
        end tell\n\
        delay 0.3\n\
        tell application \"System Events\" to keystroke \"v\" using command down"
    );
    info!("[VoiceAnywhere] platform_focus_and_paste: activating '{}'", app_name);
    let out = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        warn!("[VoiceAnywhere] platform_focus_and_paste failed: {}", err);
        return Err(format!("AppleScript failed: {err}"));
    }
    Ok(())
}

// ── Windows ───────────────────────────────────────────────────────────────────

#[cfg(windows)]
fn platform_get_frontmost_app() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 != 0 { Some(format!("{}", hwnd.0)) } else { None }
    }
}

#[cfg(windows)]
fn platform_focus_and_paste(hwnd_str: &str) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetForegroundWindow, ShowWindow, SW_RESTORE};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_TYPE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_V,
    };

    let hwnd_val: isize = hwnd_str
        .parse()
        .map_err(|e| format!("Invalid HWND '{hwnd_str}': {e}"))?;

    unsafe {
        let hwnd = HWND(hwnd_val);
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }

    std::thread::sleep(std::time::Duration::from_millis(200));

    unsafe {
        let make = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| -> INPUT {
            let mut inp: INPUT = std::mem::zeroed();
            inp.r#type = INPUT_TYPE(1); // INPUT_KEYBOARD
            inp.Anonymous.ki = KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            };
            inp
        };

        let inputs = [
            make(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            make(VK_V, KEYBD_EVENT_FLAGS(0)),
            make(VK_V, KEYEVENTF_KEYUP),
            make(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
    Ok(())
}

// ── Linux ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn platform_get_frontmost_app() -> Option<String> {
    use std::process::Command;
    let out = Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .ok()?;
    if out.status.success() {
        let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !id.is_empty() { Some(id) } else { None }
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn platform_focus_and_paste(window_id: &str) -> Result<(), String> {
    use std::process::Command;
    Command::new("xdotool")
        .args(["windowfocus", "--sync", window_id])
        .output()
        .map_err(|e| format!("xdotool windowfocus: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(100));
    Command::new("xdotool")
        .args(["key", "--clearmodifiers", "ctrl+v"])
        .output()
        .map_err(|e| format!("xdotool key: {e}"))?;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Snapshots the currently focused Transkit window and external app.
/// Called when recording starts to ensure we know where to inject the transcript.
#[tauri::command]
pub fn capture_voice_anywhere_target() -> Result<(), String> {
    let app_handle = APP.get().ok_or("App handle not found")?;
    
    // 1. Record the currently focused Transkit window.
    {
        let state: tauri::State<VoiceAnywhereState> = app_handle.state();
        let focused = app_handle
            .windows()
            .iter()
            .find(|(label, w)| {
                *label != "voice_anywhere" 
                    && *label != "voice_anywhere_caption" 
                    && w.is_focused().unwrap_or(false)
            })
            .map(|(label, _)| label.clone());
        
        // Only update if we actually found a focused Transkit window.
        // If no Transkit window is focused, we keep the previous one or let external app capture handle it.
        if let Some(label) = focused {
            *state.focused_window.lock().unwrap() = Some(label);
        }
    }

    // 2. Capture the frontmost external (non-Transkit) app.
    capture_last_external_app(app_handle);
    
    Ok(())
}

/// Returns the window label that was focused when the Voice Anywhere hotkey last fired.
#[tauri::command]
pub fn get_voice_anywhere_focused() -> Option<String> {
    let app = APP.get().unwrap();
    let state: tauri::State<VoiceAnywhereState> = app.state();
    let result = state.focused_window.lock().unwrap().clone();
    result
}

/// Returns the Transkit window that is focused right now, excluding voice_anywhere itself.
#[tauri::command]
pub fn get_current_voice_anywhere_target() -> Option<String> {
    let app = APP.get().unwrap();
    app.windows()
        .iter()
        .find(|(label, window)| {
            *label != "voice_anywhere"
                && *label != "voice_anywhere_caption"
                && window.is_focused().unwrap_or(false)
        })
        .map(|(label, _)| label.clone())
}

/// Copy `text` to the clipboard, then focus the last recorded external app and
/// simulate a paste (Cmd+V on macOS, Ctrl+V on Windows/Linux).
/// Falls back to clipboard-only if no external app was recorded.
#[tauri::command]
pub fn voice_focus_and_paste(text: String) -> Result<(), String> {
    // 1. Copy to clipboard first so it's ready when the target app gets focus.
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(&text).map_err(|e| e.to_string())?;

    // 2. Focus the stored external app and send paste.
    let app = APP.get().unwrap();
    let state: tauri::State<VoiceAnywhereState> = app.state();
    let app_id = state.last_external_app.lock().unwrap().clone();

    match app_id {
        Some(id) => {
            std::thread::sleep(std::time::Duration::from_millis(50));
            platform_focus_and_paste(&id)
        }
        None => {
            // last_external_app was never captured — clipboard is set but no paste.
            // This happens when a Transkit window was focused at hotkey time,
            // or capture_last_external_app couldn't identify the frontmost app.
            warn!("[VoiceAnywhere] voice_focus_and_paste: no external app captured — clipboard only");
            Err("No target app recorded. Try pressing the hotkey while your target app is in focus.".into())
        }
    }
}

#[tauri::command]
pub fn show_voice_anywhere_caption(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    interim: String,
    final_text: String,
    error_msg: String,
    fab_state: String,
) -> Result<(), String> {
    let app = APP.get().unwrap();
    let window = app
        .get_window("voice_anywhere_caption")
        .ok_or_else(|| "voice_anywhere_caption window not found".to_string())?;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    set_shadow(&window, false).ok();

    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .emit(
            "voice_anywhere_caption_update",
            serde_json::json!({
                "interim": interim,
                "finalText": final_text,
                "errorMsg": error_msg,
                "fabState": fab_state,
            }),
        )
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_voice_anywhere_caption() -> Result<(), String> {
    let app = APP.get().unwrap();
    if let Some(window) = app.get_window("voice_anywhere_caption") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Persist the physical position of the Voice Anywhere FAB window so it is
/// restored on the next hotkey press instead of snapping back to the default corner.
/// Called from the JS side on `tauri://move` (debounced).
#[tauri::command]
pub fn save_voice_anywhere_position(x: i32, y: i32) {
    info!("[VoiceAnywhere] saving position: ({}, {})", x, y);
    crate::config::set("voice_anywhere_pos_x", x);
    crate::config::set("voice_anywhere_pos_y", y);
}

/// Routes the final transcript to a Transkit window via a `voice_inject` event.
#[tauri::command]
pub fn voice_inject_to_window(label: String, text: String, mode: String) -> Result<(), String> {
    let app = APP.get().unwrap();
    if let Some(window) = app.get_window(&label) {
        window
            .emit(
                "voice_inject",
                serde_json::json!({
                    "label": label,
                    "text": text,
                    "mode": mode,
                }),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Writes the transcript to the system clipboard only (no focus change).
#[tauri::command]
pub fn voice_copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}
