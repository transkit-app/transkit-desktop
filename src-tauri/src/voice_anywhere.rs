use std::sync::Mutex;
use tauri::Manager;
use crate::APP;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use window_shadows::set_shadow;

/// Shared state for Voice Anywhere feature.
/// Stores the label of the Transkit window that was focused when the hotkey fired,
/// so the final transcript can be routed back to it.
pub struct VoiceAnywhereState {
    pub focused_window: Mutex<Option<String>>,
}

impl VoiceAnywhereState {
    pub fn new() -> Self {
        Self {
            focused_window: Mutex::new(None),
        }
    }
}

/// Returns the window label that was focused when the Voice Anywhere hotkey last fired.
/// The frontend calls this on mount to know where to inject the transcript.
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

/// Routes the final transcript to the appropriate Transkit window via a `voice_inject` event.
/// Called by the `voice_anywhere` frontend when a final transcript is ready and the
/// previously focused window was a Transkit window (not an external app).
///
/// `label`  – window label, e.g. "translate", "monitor", "config"
/// `text`   – final transcript text
/// `mode`   – "replace" or "append"
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

/// Writes the transcript to the system clipboard.
/// Used when the previously focused window was an external application,
/// or when paste simulation is unavailable.
#[tauri::command]
pub fn voice_copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}
