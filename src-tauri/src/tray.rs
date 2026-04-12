use crate::clipboard::*;
use crate::config::{get, set};
use crate::window::config_window;
use crate::window::input_translate;
use crate::window::monitor_window;
use crate::window::ocr_recognize;
use crate::window::ocr_translate;
use crate::window::updater_window;
use log::{info, warn};
use tauri::CustomMenuItem;
use tauri::GlobalShortcutManager;
use tauri::SystemTrayEvent;
use tauri::SystemTrayMenu;
use tauri::SystemTrayMenuItem;
use tauri::SystemTraySubmenu;
use tauri::{AppHandle, Manager};

/// In Tauri 1.x, `SystemTrayHandle::get_item()` panics if the ID is absent and, critically,
/// does so *while holding* the internal `ids` Mutex — which permanently poisons that Mutex so
/// every subsequent `set_menu` call crashes with `PoisonError`.  `try_get_item` is the safe
/// fallible alternative: it returns `Option` and never touches the Mutex under panic conditions.
fn safe_set_selected(tray_handle: &tauri::SystemTrayHandle, id: &str, selected: bool) {
    if let Some(item) = tray_handle.try_get_item(id) {
        let _ = item.set_selected(selected);
    } else {
        warn!("[tray] set_selected: item '{}' not found in current menu — skipping", id);
    }
}

#[tauri::command]
pub fn update_tray(app_handle: tauri::AppHandle, mut language: String, mut copy_mode: String) {
    let tray_handle = app_handle.tray_handle();

    if language.is_empty() {
        language = match get("app_language") {
            Some(v) => v.as_str().unwrap().to_string(),
            None => {
                set("app_language", "en");
                "en".to_string()
            }
        };
    }
    if copy_mode.is_empty() {
        copy_mode = match get("translate_auto_copy") {
            Some(v) => v.as_str().unwrap().to_string(),
            None => {
                set("translate_auto_copy", "disable");
                "disable".to_string()
            }
        };
    }

    info!(
        "Update tray with language: {}, copy mode: {}",
        language, copy_mode
    );
    tray_handle
        .set_menu(match language.as_str() {
            "en" => tray_menu_en(),
            "zh_cn" => tray_menu_zh_cn(),
            "zh_tw" => tray_menu_zh_tw(),
            "ja" => tray_menu_ja(),
            "ko" => tray_menu_ko(),
            "fr" => tray_menu_fr(),
            "de" => tray_menu_de(),
            "ru" => tray_menu_ru(),
            "pt_br" => tray_menu_pt_br(),
            "fa" => tray_menu_fa(),
            "uk" => tray_menu_uk(),
            "vi" | "vi_vn" => tray_menu_vi(),
            _ => tray_menu_en(),
        })
        .unwrap();
    #[cfg(not(target_os = "linux"))]
    tray_handle
        .set_tooltip(&format!("TransKit {}", app_handle.package_info().version))
        .unwrap();

    let enable_clipboard_monitor = match get("clipboard_monitor") {
        Some(v) => v.as_bool().unwrap(),
        None => {
            set("clipboard_monitor", false);
            false
        }
    };

    safe_set_selected(&tray_handle, "clipboard_monitor", enable_clipboard_monitor);

    match copy_mode.as_str() {
        "source"        => safe_set_selected(&tray_handle, "copy_source",        true),
        "target"        => safe_set_selected(&tray_handle, "copy_target",        true),
        "source_target" => safe_set_selected(&tray_handle, "copy_source_target", true),
        "disable"       => safe_set_selected(&tray_handle, "copy_disable",       true),
        _ => {}
    }

    // ── Voice Anywhere state ─────────────────────────────────────────────────
    // STT service — fall back to "inherit" when empty or unset
    let va_stt = match get("voice_anywhere_stt_service") {
        Some(v) => v.as_str().unwrap_or("").to_string(),
        None => String::new(),
    };
    let va_stt_id = if va_stt.is_empty() || va_stt == "inherit" {
        "va_stt_inherit".to_string()
    } else {
        format!("va_stt_{}", va_stt)
    };
    safe_set_selected(&tray_handle, &va_stt_id, true);

    // Language
    let va_lang = match get("voice_anywhere_language") {
        Some(v) => v.as_str().unwrap_or("auto").to_string(),
        None => "auto".to_string(),
    };
    safe_set_selected(&tray_handle, &format!("va_lang_{}", va_lang), true);

    // After-stop action
    let va_action = match get("voice_anywhere_action") {
        Some(v) => v.as_str().unwrap_or("clipboard").to_string(),
        None => "clipboard".to_string(),
    };
    safe_set_selected(&tray_handle, &format!("va_action_{}", va_action), true);

    // Inject mode (Transkit windows)
    let va_inject = match get("voice_anywhere_inject_mode") {
        Some(v) => v.as_str().unwrap_or("replace").to_string(),
        None => "replace".to_string(),
    };
    safe_set_selected(&tray_handle, &format!("va_inject_{}", va_inject), true);
}

pub fn tray_event_handler<'a>(app: &'a AppHandle, event: SystemTrayEvent) {
    match event {
        #[cfg(target_os = "windows")]
        SystemTrayEvent::LeftClick { .. } => on_tray_click(),
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "input_translate" => on_input_translate_click(),
            "copy_source" => on_auto_copy_click(app, "source"),
            "clipboard_monitor" => on_clipboard_monitor_click(app),
            "copy_target" => on_auto_copy_click(app, "target"),
            "copy_source_target" => on_auto_copy_click(app, "source_target"),
            "copy_disable" => on_auto_copy_click(app, "disable"),
            "ocr_recognize" => on_ocr_recognize_click(),
            "ocr_translate" => on_ocr_translate_click(),
            "audio_monitor" => on_audio_monitor_click(),
            // va_config opens the Config window (same as "config")
            "config" | "va_config" => on_config_click(),
            "check_update" => on_check_update_click(),
            "view_log" => on_view_log_click(app),
            "restart" => on_restart_click(app),
            "quit" => on_quit_click(app),
            // Voice Anywhere: fixed action/inject items
            "va_action_paste"      => on_va_action_click(app, "paste"),
            "va_action_clipboard"  => on_va_action_click(app, "clipboard"),
            "va_inject_replace"    => on_va_inject_click(app, "replace"),
            "va_inject_append"     => on_va_inject_click(app, "append"),
            // Voice Anywhere: dynamic STT service items (prefix match)
            s if s.starts_with("va_stt_") => on_va_stt_click(app, &s["va_stt_".len()..]),
            // Voice Anywhere: language items (prefix match)
            s if s.starts_with("va_lang_") => on_va_lang_click(app, &s["va_lang_".len()..]),
            _ => {}
        },
        _ => {}
    }
}

#[cfg(target_os = "windows")]
fn on_tray_click() {
    let event = match get("tray_click_event") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => {
            set("tray_click_event", "config");
            "config".to_string()
        }
    };
    match event.as_str() {
        "config" => config_window(),
        "translate" => input_translate(),
        "ocr_recognize" => ocr_recognize(),
        "ocr_translate" => ocr_translate(),
        "disable" => {}
        _ => config_window(),
    }
}
fn on_input_translate_click() {
    input_translate();
}
fn on_clipboard_monitor_click(app: &AppHandle) {
    let enable_clipboard_monitor = match get("clipboard_monitor") {
        Some(v) => v.as_bool().unwrap(),
        None => {
            set("clipboard_monitor", false);
            false
        }
    };
    let current = !enable_clipboard_monitor;
    // Update Config File
    set("clipboard_monitor", current);
    // Update State and Start Monitor
    let state = app.state::<ClipboardMonitorEnableWrapper>();
    state
        .0
        .lock()
        .unwrap()
        .replace_range(.., &current.to_string());
    if current {
        start_clipboard_monitor(app.app_handle());
    }
    // Update Tray Menu Status
    safe_set_selected(&app.tray_handle(), "clipboard_monitor", current);
}
fn on_auto_copy_click(app: &AppHandle, mode: &str) {
    info!("Set copy mode to: {}", mode);
    set("translate_auto_copy", mode);
    app.emit_all("translate_auto_copy_changed", mode).unwrap();
    update_tray(app.app_handle(), "".to_string(), mode.to_string());
}
fn on_ocr_recognize_click() {
    ocr_recognize();
}
fn on_ocr_translate_click() {
    ocr_translate();
}

fn on_audio_monitor_click() {
    monitor_window();
}

fn on_config_click() {
    config_window();
}

fn on_check_update_click() {
    updater_window();
}
fn on_view_log_click(app: &AppHandle) {
    use tauri::api::path::app_log_dir;
    let log_path = app_log_dir(&app.config()).unwrap();
    tauri::api::shell::open(&app.shell_scope(), log_path.to_str().unwrap(), None).unwrap();
}
fn on_restart_click(app: &AppHandle) {
    info!("============== Restart App ==============");
    app.restart();
}
fn on_quit_click(app: &AppHandle) {
    app.global_shortcut_manager().unregister_all().unwrap();
    info!("============== Quit App ==============");
    app.exit(0);
}

// ── Voice Anywhere helpers ─────────────────────────────────────────────────

/// Maps a service instance key (e.g. "deepgram_stt" or "deepgram_stt@abc123")
/// to a short human-readable display name for the tray menu.
fn stt_service_display_name(instance_key: &str) -> String {
    let service_name = instance_key.split('@').next().unwrap_or(instance_key);
    let base = match service_name {
        "soniox_stt"               => "Soniox",
        "assemblyai_stt"           => "AssemblyAI",
        "openai_whisper_stt"       => "OpenAI Whisper",
        "gladia_stt"               => "Gladia",
        "deepgram_stt"             => "Deepgram",
        "custom_stt"               => "Custom WebSocket",
        "transkit_cloud_stt"       => "TransKit Cloud",
        "transkit_cloud_dictation" => "TransKit Dictation",
        "local_sidecar_stt"        => "Local Sidecar",
        "onnx_stt"                 => "ONNX (Offline)",
        _                          => service_name,
    };
    // Append a short id suffix when the key has a @id component so the user
    // can distinguish multiple instances of the same service type.
    if instance_key.contains('@') {
        let suffix: String = instance_key
            .split('@')
            .nth(1)
            .unwrap_or("")
            .chars()
            .take(6)
            .collect();
        format!("{} ({})", base, suffix)
    } else {
        base.to_string()
    }
}

/// Builds the "Voice Anywhere" submenu dynamically from the current config.
/// Called on every tray rebuild so its content always reflects the live state.
/// The selected/checked state is applied separately via set_selected() in
/// update_tray() after set_menu() completes.
fn build_voice_anywhere_submenu() -> SystemTraySubmenu {
    // ── STT Provider section ─────────────────────────────────────────────────
    let stt_list: Vec<String> = get("transcription_service_list")
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
        })
        .unwrap_or_default();

    let mut menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("va_section_stt", "STT Provider").disabled())
        .add_item(CustomMenuItem::new("va_stt_inherit", "Inherit from Monitor"));

    for key in &stt_list {
        menu = menu.add_item(CustomMenuItem::new(
            format!("va_stt_{}", key),
            stt_service_display_name(key),
        ));
    }

    // ── Language section (same curated list as the in-app context menu) ──────
    let lang_entries: &[(&str, &str)] = &[
        ("auto", "Auto (Monitor)"),
        ("en",   "English"),
        ("vi",   "Tiếng Việt"),
        ("zh",   "中文"),
        ("ja",   "日本語"),
        ("ko",   "한국어"),
        ("fr",   "Français"),
        ("de",   "Deutsch"),
        ("es",   "Español"),
        ("pt",   "Português"),
        ("ru",   "Русский"),
    ];

    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_section_lang", "Language").disabled());

    for (code, label) in lang_entries {
        menu = menu.add_item(CustomMenuItem::new(format!("va_lang_{}", code), *label));
    }

    // ── After Stop section ───────────────────────────────────────────────────
    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_section_action", "After Stop").disabled())
        .add_item(CustomMenuItem::new("va_action_clipboard", "Copy to Clipboard"))
        .add_item(CustomMenuItem::new("va_action_paste",    "Paste to Last App"));

    // ── Inject Mode section (Transkit windows only) ──────────────────────────
    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_section_inject", "Inject Mode (Transkit)").disabled())
        .add_item(CustomMenuItem::new("va_inject_replace", "Replace"))
        .add_item(CustomMenuItem::new("va_inject_append",  "Append"));

    // ── Configure shortcut ───────────────────────────────────────────────────
    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_config", "Configure..."));

    SystemTraySubmenu::new("Voice Anywhere", menu)
}

// ── Voice Anywhere tray-click handlers ────────────────────────────────────

fn on_va_stt_click(app: &AppHandle, stt_key: &str) {
    info!("VA tray: set STT service → {}", stt_key);
    set("voice_anywhere_stt_service", stt_key);
    app.emit_all("voice_anywhere_stt_service_changed", stt_key).unwrap();
    update_tray(app.app_handle(), String::new(), String::new());
}

fn on_va_lang_click(app: &AppHandle, lang_code: &str) {
    info!("VA tray: set language → {}", lang_code);
    set("voice_anywhere_language", lang_code);
    app.emit_all("voice_anywhere_language_changed", lang_code).unwrap();
    update_tray(app.app_handle(), String::new(), String::new());
}

fn on_va_action_click(app: &AppHandle, action: &str) {
    info!("VA tray: set action → {}", action);
    set("voice_anywhere_action", action);
    app.emit_all("voice_anywhere_action_changed", action).unwrap();
    update_tray(app.app_handle(), String::new(), String::new());
}

fn on_va_inject_click(app: &AppHandle, mode: &str) {
    info!("VA tray: set inject mode → {}", mode);
    set("voice_anywhere_inject_mode", mode);
    app.emit_all("voice_anywhere_inject_mode_changed", mode).unwrap();
    update_tray(app.app_handle(), String::new(), String::new());
}

fn tray_menu_en() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Input Translate");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Realtime Translate");
    let copy_source = CustomMenuItem::new("copy_source", "Source");
    let copy_target = CustomMenuItem::new("copy_target", "Target");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Clipboard Monitor");
    let copy_source_target = CustomMenuItem::new("copy_source_target", "Source+Target");
    let copy_disable = CustomMenuItem::new("copy_disable", "Disable");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "OCR Recognize");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "OCR Translate");
    let config = CustomMenuItem::new("config", "Config");
    let check_update = CustomMenuItem::new("check_update", "Check Update");
    let view_log = CustomMenuItem::new("view_log", "View Log");
    let restart = CustomMenuItem::new("restart", "Restart");
    let quit = CustomMenuItem::new("quit", "Quit");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(audio_monitor)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Auto Copy",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_zh_cn() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "输入翻译");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "监听剪切板");
    let copy_source = CustomMenuItem::new("copy_source", "原文");
    let copy_target = CustomMenuItem::new("copy_target", "译文");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "原文+译文");
    let copy_disable = CustomMenuItem::new("copy_disable", "关闭");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "文字识别");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "截图翻译");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "音频监听");
    let config = CustomMenuItem::new("config", "偏好设置");
    let check_update = CustomMenuItem::new("check_update", "检查更新");
    let restart = CustomMenuItem::new("restart", "重启应用");
    let view_log = CustomMenuItem::new("view_log", "查看日志");
    let quit = CustomMenuItem::new("quit", "退出");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "自动复制",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_zh_tw() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "輸入翻譯");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "偵聽剪貼簿");
    let copy_source = CustomMenuItem::new("copy_source", "原文");
    let copy_target = CustomMenuItem::new("copy_target", "譯文");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "原文+譯文");
    let copy_disable = CustomMenuItem::new("copy_disable", "關閉");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "文字識別");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "截圖翻譯");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "音訊監聽");
    let config = CustomMenuItem::new("config", "偏好設定");
    let check_update = CustomMenuItem::new("check_update", "檢查更新");
    let restart = CustomMenuItem::new("restart", "重啓程式");
    let view_log = CustomMenuItem::new("view_log", "查看日誌");
    let quit = CustomMenuItem::new("quit", "退出");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "自動複製",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_ja() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "翻訳を入力");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "クリップボードを監視する");
    let copy_source = CustomMenuItem::new("copy_source", "原文");
    let copy_target = CustomMenuItem::new("copy_target", "訳文");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "原文+訳文");
    let copy_disable = CustomMenuItem::new("copy_disable", "閉じる");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "テキスト認識");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "スクリーンショットの翻訳");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "音声モニター");
    let config = CustomMenuItem::new("config", "プリファレンス設定");
    let check_update = CustomMenuItem::new("check_update", "更新を確認する");
    let restart = CustomMenuItem::new("restart", "アプリの再起動");
    let view_log = CustomMenuItem::new("view_log", "ログを見る");
    let quit = CustomMenuItem::new("quit", "退出する");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "自動コピー",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_ko() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "입력 번역");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "감청 전단판");
    let copy_source = CustomMenuItem::new("copy_source", "원문");
    let copy_target = CustomMenuItem::new("copy_target", "번역문");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "원문+번역문");
    let copy_disable = CustomMenuItem::new("copy_disable", "닫기");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "문자인식");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "스크린샷 번역");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "오디오 모니터");
    let config = CustomMenuItem::new("config", "기본 설정");
    let check_update = CustomMenuItem::new("check_update", "업데이트 확인");
    let restart = CustomMenuItem::new("restart", "응용 프로그램 다시 시작");
    let view_log = CustomMenuItem::new("view_log", "로그 보기");
    let quit = CustomMenuItem::new("quit", "퇴출");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "자동 복사",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_fr() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Traduction d'entrée");
    let clipboard_monitor =
        CustomMenuItem::new("clipboard_monitor", "Surveiller le presse-papiers");
    let copy_source = CustomMenuItem::new("copy_source", "Source");
    let copy_target = CustomMenuItem::new("copy_target", "Cible");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Source+Cible");
    let copy_disable = CustomMenuItem::new("copy_disable", "Désactiver");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Reconnaissance de texte");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Traduction d'image");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Moniteur Audio");
    let config = CustomMenuItem::new("config", "Paramètres");
    let check_update = CustomMenuItem::new("check_update", "Vérifier les mises à jour");
    let restart = CustomMenuItem::new("restart", "Redémarrer l'application");
    let view_log = CustomMenuItem::new("view_log", "Voir le journal");
    let quit = CustomMenuItem::new("quit", "Quitter");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Copier automatiquement",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}
fn tray_menu_de() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Eingabeübersetzung");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Zwischenablage überwachen");
    let copy_source = CustomMenuItem::new("copy_source", "Quelle");
    let copy_target = CustomMenuItem::new("copy_target", "Ziel");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Quelle+Ziel");
    let copy_disable = CustomMenuItem::new("copy_disable", "Deaktivieren");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Texterkennung");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Bildübersetzung");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Audio-Monitor");
    let config = CustomMenuItem::new("config", "Einstellungen");
    let check_update = CustomMenuItem::new("check_update", "Auf Updates prüfen");
    let restart = CustomMenuItem::new("restart", "Anwendung neu starten");
    let view_log = CustomMenuItem::new("view_log", "Protokoll anzeigen");
    let quit = CustomMenuItem::new("quit", "Beenden");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Automatisch kopieren",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_ru() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Ввод перевода");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Следить за буфером обмена");
    let copy_source = CustomMenuItem::new("copy_source", "Источник");
    let copy_target = CustomMenuItem::new("copy_target", "Цель");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Источник+Цель");
    let copy_disable = CustomMenuItem::new("copy_disable", "Отключить");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Распознавание текста");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Перевод изображения");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Аудио монитор");
    let config = CustomMenuItem::new("config", "Настройки");
    let check_update = CustomMenuItem::new("check_update", "Проверить обновления");
    let restart = CustomMenuItem::new("restart", "Перезапустить приложение");
    let view_log = CustomMenuItem::new("view_log", "Просмотр журнала");
    let quit = CustomMenuItem::new("quit", "Выход");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Автоматическое копирование",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_fa() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "متن");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "گوش دادن به تخته برش");
    let copy_source = CustomMenuItem::new("copy_source", "منبع");
    let copy_target = CustomMenuItem::new("copy_target", "هدف");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "منبع + هدف");
    let copy_disable = CustomMenuItem::new("copy_disable", "متن");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "تشخیص متن");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "ترجمه عکس");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "نظارت صوتی");
    let config = CustomMenuItem::new("config", "تنظیمات ترجیح");
    let check_update = CustomMenuItem::new("check_update", "بررسی بروزرسانی");
    let restart = CustomMenuItem::new("restart", "راه‌اندازی مجدد برنامه");
    let view_log = CustomMenuItem::new("view_log", "مشاهده گزارشات");
    let quit = CustomMenuItem::new("quit", "خروج");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "کپی خودکار",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_pt_br() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Traduzir Entrada");
    let clipboard_monitor =
        CustomMenuItem::new("clipboard_monitor", "Monitorando a área de transferência");
    let copy_source = CustomMenuItem::new("copy_source", "Origem");
    let copy_target = CustomMenuItem::new("copy_target", "Destino");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Origem+Destino");
    let copy_disable = CustomMenuItem::new("copy_disable", "Desabilitar");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Reconhecimento de Texto");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Tradução de Imagem");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Monitor de Áudio");
    let config = CustomMenuItem::new("config", "Configurações");
    let check_update = CustomMenuItem::new("check_update", "Checar por Atualização");
    let restart = CustomMenuItem::new("restart", "Reiniciar aplicativo");
    let view_log = CustomMenuItem::new("view_log", "Exibir Registro");
    let quit = CustomMenuItem::new("quit", "Sair");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Copiar Automaticamente",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_uk() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Введення перекладу");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Стежити за буфером обміну");
    let copy_source = CustomMenuItem::new("copy_source", "Джерело");
    let copy_target = CustomMenuItem::new("copy_target", "Мета");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Джерело+Мета");
    let copy_disable = CustomMenuItem::new("copy_disable", "Відключивши");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Розпізнавання тексту");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Переклад зображення");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Аудіо монітор");
    let config = CustomMenuItem::new("config", "Настройка");
    let check_update = CustomMenuItem::new("check_update", "Перевірити оновлення");
    let restart = CustomMenuItem::new("restart", "Перезапустити додаток");
    let view_log = CustomMenuItem::new("view_log", "Перегляд журналу");
    let quit = CustomMenuItem::new("quit", "Вихід");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Автоматичне копіювання",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_item(audio_monitor)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}

fn tray_menu_vi() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Mở hộp thoại dịch");
    let audio_monitor = CustomMenuItem::new("audio_monitor", "Dịch âm thanh realtime");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Dịch từ clipboard");
    let copy_source = CustomMenuItem::new("copy_source", "Ngôn ngữ nguồn");
    let copy_target = CustomMenuItem::new("copy_target", "Ngôn ngữ đích");
    let copy_source_target = CustomMenuItem::new("copy_source_target", "Nguồn+Đích");
    let copy_disable = CustomMenuItem::new("copy_disable", "Tắt");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "OCR - Nhận dạng văn bản");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "OCR - Dịch ảnh chụp màn hình");
    let config = CustomMenuItem::new("config", "Cài đặt");
    let check_update = CustomMenuItem::new("check_update", "Kiểm tra cập nhật");
    let restart = CustomMenuItem::new("restart", "Khởi động lại");
    let quit = CustomMenuItem::new("quit", "Thoát");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(audio_monitor)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Tự động sao chép",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_submenu(build_voice_anywhere_submenu())
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(quit)
}
