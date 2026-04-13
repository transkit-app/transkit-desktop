use crate::config::{get, set};
use crate::window::updater_window;
use log::{info, warn};
use tauri::Manager;

pub fn check_update(app_handle: tauri::AppHandle) {
    let enable = match get("check_update") {
        Some(v) => v.as_bool().unwrap(),
        None => {
            set("check_update", true);
            true
        }
    };
    if !enable {
        return;
    }
    tauri::async_runtime::spawn(async move {
        match tauri::updater::builder(app_handle.clone()).check().await {
            Ok(update) => {
                if !update.is_update_available() {
                    return;
                }

                let available_version = update.latest_version().to_string();
                info!("[updater] New version available: {}", available_version);

                // Don't show popup if the user explicitly skipped this version.
                // Manual checks (tray / About page) still open the window directly via
                // updater_window(), bypassing this guard entirely.
                let skipped = get("skipped_version")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();

                if !skipped.is_empty() && skipped == available_version {
                    info!(
                        "[updater] Version {} was skipped by user, suppressing auto-popup",
                        available_version
                    );
                    return;
                }

                // Don't interrupt the user while the Audio Monitor overlay is open
                // (they're likely in a meeting / recording session).
                let monitor_active = app_handle
                    .get_window("monitor")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);

                if monitor_active {
                    info!("[updater] Monitor window is active, suppressing update popup");
                    return;
                }

                updater_window();
            }
            Err(e) => {
                warn!("[updater] Failed to check update: {}", e);
            }
        }
    });
}

/// Save the version string the user wants to skip.
/// Called from the Updater window when the user clicks "Skip This Version".
#[tauri::command]
pub fn skip_version(version: String) {
    info!("[updater] User skipped version {}", version);
    set("skipped_version", version);
}
