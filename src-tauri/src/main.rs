// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod audio_cmd;
mod auth;
mod backup;
mod clipboard;
mod cmd;
mod config;
mod edge_tts;
mod error;
mod hotkey;
mod local_sidecar;
mod narration;
mod screenshot;
mod server;
mod system_ocr;
mod tray;
mod updater;
mod voice_anywhere;
mod window;

use audio_cmd::*;
use local_sidecar::{
    LocalSidecarState,
    local_sidecar_start, local_sidecar_stop, local_sidecar_status,
    local_sidecar_check_setup, local_sidecar_check_prereqs, local_sidecar_run_setup,
    local_sidecar_list_cached_models, local_sidecar_delete_cached_model,
    local_sidecar_download_model, local_sidecar_get_port, local_sidecar_reveal_cache,
};
use narration::{
    narration_detect_devices, narration_get_status, narration_inject_audio, narration_list_devices,
    narration_setup, narration_start, narration_stop, NarrationState,
};
use auth::start_oauth_server;
use voice_anywhere::{
    VoiceAnywhereState, get_current_voice_anywhere_target, get_voice_anywhere_focused,
    hide_voice_anywhere_caption, show_voice_anywhere_caption,
    voice_inject_to_window, voice_copy_to_clipboard, voice_focus_and_paste,
    save_voice_anywhere_position, capture_voice_anywhere_target,
};
use backup::*;
use clipboard::*;
use cmd::*;
use config::*;
use edge_tts::synthesize_edge_tts;
use hotkey::*;
use log::info;
use once_cell::sync::OnceCell;
use screenshot::screenshot;
use server::*;
use std::sync::Mutex;
use system_ocr::*;
use tauri::api::notification::Notification;
use tauri::Manager;
use tauri_plugin_log::LogTarget;
use tray::*;
use updater::check_update;
use window::config_window;
use window::open_config_window;
use window::show_voice_anywhere_window;
use window::hide_voice_anywhere_window;
use window::updater_window;

// Global AppHandle
pub static APP: OnceCell<tauri::AppHandle> = OnceCell::new();

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

// Text to be translated
pub struct StringWrapper(pub Mutex<String>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, cwd| {
            Notification::new(&app.config().tauri.bundle.identifier)
                .title("The program is already running. Please do not start it again!")
                .body(cwd)
                .icon("icon")
                .show()
                .unwrap();
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([LogTarget::LogDir, LogTarget::Stdout])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs_watch::init())
        .system_tray(tauri::SystemTray::new())
        .setup(|app| {
            info!("============== Start App ==============");
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                let trusted =
                    macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
                info!("MacOS Accessibility Trusted: {}", trusted);
            }
            // Global AppHandle
            APP.get_or_init(|| app.handle());
            // Init Config
            info!("Init Config Store");
            init_config(app);
            // Check First Run
            if is_first_run() {
                // Open Config Window
                info!("First Run, opening config window");
                config_window();
            }
            app.manage(StringWrapper(Mutex::new("".to_string())));
            app.manage(AudioState {
                microphone: Mutex::new(crate::audio::microphone::MicCapture::new()),
                system_audio: Mutex::new(crate::audio::SystemAudioCapture::new()),
                stop_flag: Mutex::new(None),
            });
            app.manage(NarrationState::new());
            app.manage(VoiceAnywhereState::new());
            app.manage(LocalSidecarState::new());
            // Update Tray Menu
            update_tray(app.app_handle(), "".to_string(), "".to_string());
            // Start http server
            start_server();
            // Register Global Shortcut
            match register_shortcut("all") {
                Ok(()) => {}
                Err(e) => Notification::new(app.config().tauri.bundle.identifier.clone())
                    .title("Failed to register global shortcut")
                    .body(&e)
                    .icon("icon")
                    .show()
                    .unwrap(),
            }
            match get("proxy_enable") {
                Some(v) => {
                    if v.as_bool().unwrap()
                        && get("proxy_host")
                            .map_or(false, |host| !host.as_str().unwrap().is_empty())
                    {
                        let _ = set_proxy();
                    }
                }
                None => {}
            }
            // Auto-show Voice Anywhere FAB if "always visible" is enabled
            if get("voice_anywhere_always_visible")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                window::voice_anywhere_window();
            }
            // Auto-start Local Sidecar if enabled
            if get("local_sidecar_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                let sidecar_state = app.state::<LocalSidecarState>();
                let config = local_sidecar::SidecarConfig {
                    llm_model: get("local_sidecar_llm_model").and_then(|v| v.as_str().map(|s| s.to_string())),
                    asr_model: get("local_sidecar_asr_model").and_then(|v| v.as_str().map(|s| s.to_string())),
                    asr_task: get("local_sidecar_asr_task").and_then(|v| v.as_str().map(|s| s.to_string())),
                    asr_language: get("local_sidecar_asr_language").and_then(|v| v.as_str().map(|s| s.to_string())),
                    asr_chunk_seconds: get("local_sidecar_asr_chunk_seconds").and_then(|v| v.as_u64()).map(|v| v as u32),
                    asr_stride_seconds: get("local_sidecar_asr_stride_seconds").and_then(|v| v.as_u64()).map(|v| v as u32),
                    tts_engine: get("local_sidecar_tts_engine").and_then(|v| v.as_str().map(|s| s.to_string())),
                    tts_model: get("local_sidecar_tts_model").and_then(|v| v.as_str().map(|s| s.to_string())),
                    tts_ref_audio: get("local_sidecar_tts_ref_audio").and_then(|v| v.as_str().map(|s| s.to_string())),
                    llm_temperature: get("local_sidecar_llm_temperature").and_then(|v| v.as_f64()),
                    llm_max_tokens: get("local_sidecar_llm_max_tokens").and_then(|v| v.as_u64()).map(|v| v as u32),
                    log_level: None,
                    enabled_components: None,
                };
                if let Err(e) = local_sidecar::start_with_handle(config, app.handle(), &sidecar_state) {
                    log::warn!("[LocalSidecar] Auto-start failed: {}", e);
                }
            }
            // Check Update
            check_update(app.handle());
            let clipboard_monitor = match get("clipboard_monitor") {
                Some(v) => v.as_bool().unwrap(),
                None => {
                    set("clipboard_monitor", false);
                    false
                }
            };
            app.manage(ClipboardMonitorEnableWrapper(Mutex::new(
                clipboard_monitor.to_string(),
            )));
            start_clipboard_monitor(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reload_store,
            get_text,
            cut_image,
            get_base64,
            copy_img,
            system_ocr,
            set_proxy,
            unset_proxy,
            run_binary,
            open_devtools,
            set_window_buttons_hidden,
            register_shortcut_by_frontend,
            update_tray,
            updater_window,
            screenshot,
            webdav,
            local,
            install_plugin,
            font_list,
            aliyun,
            get_audio_capabilities,
            start_audio_capture,
            stop_audio_capture,
            play_audio_bytes,
            stop_audio_playback,
            synthesize_edge_tts,
            open_config_window,
            restart_app,
            start_oauth_server,
            narration_list_devices,
            narration_detect_devices,
            narration_setup,
            narration_start,
            narration_inject_audio,
            narration_stop,
            narration_get_status,
            get_current_voice_anywhere_target,
            get_voice_anywhere_focused,
            show_voice_anywhere_caption,
            hide_voice_anywhere_caption,
            voice_inject_to_window,
            voice_copy_to_clipboard,
            voice_focus_and_paste,
            save_voice_anywhere_position,
            capture_voice_anywhere_target,
            show_voice_anywhere_window,
            hide_voice_anywhere_window,
            local_sidecar_start,
            local_sidecar_stop,
            local_sidecar_status,
            local_sidecar_check_setup,
            local_sidecar_check_prereqs,
            local_sidecar_run_setup,
            local_sidecar_list_cached_models,
            local_sidecar_delete_cached_model,
            local_sidecar_download_model,
            local_sidecar_get_port,
            local_sidecar_reveal_cache
        ])
        .on_system_tray_event(tray_event_handler)
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // 窗口关闭不退出
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
