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
    let menu = match language.as_str() {
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
    };
    if let Err(e) = tray_handle.set_menu(menu) {
        warn!("[tray] set_menu failed: {:?}", e);
    }
    #[cfg(not(target_os = "linux"))]
    if let Err(e) = tray_handle.set_tooltip(&format!("TransKit {}", app_handle.package_info().version)) {
        warn!("[tray] set_tooltip failed: {:?}", e);
    }

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

    // Target language (quick-switch in tray)
    let va_target = match get("voice_anywhere_target_language") {
        Some(v) => v.as_str().unwrap_or("none").to_string(),
        None => "none".to_string(),
    };
    safe_set_selected(&tray_handle, &format!("va_target_{}", va_target), true);

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
            // Voice Anywhere: target language items (prefix match)
            s if s.starts_with("va_target_") => on_va_target_click(app, &s["va_target_".len()..]),
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
    if let Err(e) = app.emit_all("translate_auto_copy_changed", mode) {
        warn!("[tray] emit translate_auto_copy_changed failed: {:?}", e);
    }
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
    let log_path = match app_log_dir(&app.config()) {
        Some(p) => p,
        None => { warn!("[tray] could not resolve app log dir"); return; }
    };
    let path_str = match log_path.to_str() {
        Some(s) => s,
        None => { warn!("[tray] log path is not valid UTF-8"); return; }
    };
    if let Err(e) = tauri::api::shell::open(&app.shell_scope(), path_str, None) {
        warn!("[tray] open log dir failed: {:?}", e);
    }
}
fn on_restart_click(app: &AppHandle) {
    info!("============== Restart App ==============");
    app.restart();
}
fn on_quit_click(app: &AppHandle) {
    if let Err(e) = app.global_shortcut_manager().unregister_all() {
        warn!("[tray] unregister_all shortcuts failed: {:?}", e);
    }
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

/// Maps a target language code to a short English display name for the tray menu.
fn target_lang_display_name(code: &str) -> String {
    match code {
        "en"     => "English",
        "vi"     => "Vietnamese",
        "ja"     => "Japanese",
        "zh_cn"  => "Chinese (Simplified)",
        "zh_tw"  => "Chinese (Traditional)",
        "ko"     => "Korean",
        "fr"     => "French",
        "de"     => "German",
        "es"     => "Spanish",
        "ru"     => "Russian",
        "it"     => "Italian",
        "tr"     => "Turkish",
        "pt_pt"  => "Portuguese",
        "pt_br"  => "Portuguese (Brazil)",
        "id"     => "Indonesian",
        "th"     => "Thai",
        "ms"     => "Malay",
        "ar"     => "Arabic",
        "hi"     => "Hindi",
        "mn_mo"  => "Mongolian",
        "mn_cy"  => "Mongolian (Cyrillic)",
        "km"     => "Khmer",
        "nb_no"  => "Norwegian Bokmål",
        "nn_no"  => "Norwegian Nynorsk",
        "fa"     => "Persian",
        "sv"     => "Swedish",
        "pl"     => "Polish",
        "nl"     => "Dutch",
        "uk"     => "Ukrainian",
        "he"     => "Hebrew",
        other    => other,
    }.to_string()
}

/// Localised string bundle for the Voice Anywhere tray submenu.
struct VaTrayLabels {
    title:          &'static str,
    stt_section:    &'static str,
    inherit:        &'static str,
    target_section: &'static str,
    no_translate:   &'static str,
    after_stop:     &'static str,
    clipboard:      &'static str,
    paste:          &'static str,
    inject_section: &'static str,
    replace:        &'static str,
    append:         &'static str,
    configure:      &'static str,
}

/// Returns the label bundle for the Voice Anywhere submenu in the given app language.
fn va_labels(lang: &str) -> VaTrayLabels {
    match lang {
        "vi" | "vi_vn" => VaTrayLabels {
            title:          "Nhập liệu giọng nói",
            stt_section:    "Nhà cung cấp STT",
            inherit:        "Giống Audio Monitor",
            target_section: "Dịch sang",
            no_translate:   "Không dịch",
            after_stop:     "Sau khi dừng",
            clipboard:      "Sao chép vào Clipboard",
            paste:          "Dán vào ứng dụng trước",
            inject_section: "Chế độ chèn (Transkit)",
            replace:        "Thay thế",
            append:         "Chèn thêm",
            configure:      "Cài đặt...",
        },
        "zh_cn" => VaTrayLabels {
            title:          "语音输入",
            stt_section:    "STT 服务",
            inherit:        "跟随监听器",
            target_section: "翻译为",
            no_translate:   "不翻译",
            after_stop:     "停止后",
            clipboard:      "复制到剪贴板",
            paste:          "粘贴到上一个应用",
            inject_section: "注入模式（Transkit）",
            replace:        "替换",
            append:         "追加",
            configure:      "设置...",
        },
        "zh_tw" => VaTrayLabels {
            title:          "語音輸入",
            stt_section:    "STT 服務",
            inherit:        "跟隨監聽器",
            target_section: "翻譯為",
            no_translate:   "不翻譯",
            after_stop:     "停止後",
            clipboard:      "複製到剪貼簿",
            paste:          "貼上到上一個應用程式",
            inject_section: "注入模式（Transkit）",
            replace:        "取代",
            append:         "附加",
            configure:      "設定...",
        },
        "ja" => VaTrayLabels {
            title:          "音声入力",
            stt_section:    "STT プロバイダー",
            inherit:        "モニターと同じ",
            target_section: "翻訳先",
            no_translate:   "翻訳しない",
            after_stop:     "停止後",
            clipboard:      "クリップボードにコピー",
            paste:          "前のアプリに貼り付け",
            inject_section: "挿入モード（Transkit）",
            replace:        "置換",
            append:         "追加",
            configure:      "設定...",
        },
        "ko" => VaTrayLabels {
            title:          "음성 입력",
            stt_section:    "STT 제공자",
            inherit:        "모니터와 동일",
            target_section: "번역 언어",
            no_translate:   "번역 안 함",
            after_stop:     "정지 후",
            clipboard:      "클립보드에 복사",
            paste:          "이전 앱에 붙여넣기",
            inject_section: "삽입 모드 (Transkit)",
            replace:        "대체",
            append:         "추가",
            configure:      "설정...",
        },
        "fr" => VaTrayLabels {
            title:          "Saisie vocale",
            stt_section:    "Fournisseur STT",
            inherit:        "Hériter du moniteur",
            target_section: "Traduire vers",
            no_translate:   "Ne pas traduire",
            after_stop:     "Après arrêt",
            clipboard:      "Copier dans le presse-papiers",
            paste:          "Coller dans la dernière app",
            inject_section: "Mode injection (Transkit)",
            replace:        "Remplacer",
            append:         "Ajouter",
            configure:      "Configurer...",
        },
        "de" => VaTrayLabels {
            title:          "Spracheingabe",
            stt_section:    "STT-Anbieter",
            inherit:        "Vom Monitor übernehmen",
            target_section: "Übersetzen nach",
            no_translate:   "Nicht übersetzen",
            after_stop:     "Nach dem Stopp",
            clipboard:      "In Zwischenablage kopieren",
            paste:          "In letzte App einfügen",
            inject_section: "Einfügemodus (Transkit)",
            replace:        "Ersetzen",
            append:         "Anhängen",
            configure:      "Konfigurieren...",
        },
        "ru" => VaTrayLabels {
            title:          "Голосовой ввод",
            stt_section:    "Провайдер STT",
            inherit:        "Как в мониторе",
            target_section: "Перевести на",
            no_translate:   "Без перевода",
            after_stop:     "После остановки",
            clipboard:      "Скопировать в буфер",
            paste:          "Вставить в последнее приложение",
            inject_section: "Режим вставки (Transkit)",
            replace:        "Заменить",
            append:         "Добавить",
            configure:      "Настроить...",
        },
        "pt_br" => VaTrayLabels {
            title:          "Entrada de voz",
            stt_section:    "Provedor STT",
            inherit:        "Herdar do Monitor",
            target_section: "Traduzir para",
            no_translate:   "Sem tradução",
            after_stop:     "Após parar",
            clipboard:      "Copiar para área de transferência",
            paste:          "Colar no último aplicativo",
            inject_section: "Modo de injeção (Transkit)",
            replace:        "Substituir",
            append:         "Acrescentar",
            configure:      "Configurar...",
        },
        "fa" => VaTrayLabels {
            title:          "ورودی صوتی",
            stt_section:    "ارائه‌دهنده STT",
            inherit:        "از مانیتور",
            target_section: "ترجمه به",
            no_translate:   "بدون ترجمه",
            after_stop:     "پس از توقف",
            clipboard:      "کپی در کلیپ‌بورد",
            paste:          "چسباندن در آخرین برنامه",
            inject_section: "حالت تزریق (Transkit)",
            replace:        "جایگزین",
            append:         "افزودن",
            configure:      "پیکربندی...",
        },
        "uk" => VaTrayLabels {
            title:          "Голосовий ввід",
            stt_section:    "Постачальник STT",
            inherit:        "Як у моніторі",
            target_section: "Перекласти на",
            no_translate:   "Без перекладу",
            after_stop:     "Після зупинки",
            clipboard:      "Копіювати в буфер",
            paste:          "Вставити в останній додаток",
            inject_section: "Режим вставки (Transkit)",
            replace:        "Замінити",
            append:         "Додати",
            configure:      "Налаштувати...",
        },
        _ => VaTrayLabels {
            title:          "Voice Anywhere",
            stt_section:    "STT Provider",
            inherit:        "Inherit from Monitor",
            target_section: "Translate to",
            no_translate:   "No translate",
            after_stop:     "After Stop",
            clipboard:      "Copy to Clipboard",
            paste:          "Paste to Last App",
            inject_section: "Inject Mode (Transkit)",
            replace:        "Replace",
            append:         "Append",
            configure:      "Configure...",
        },
    }
}

/// Builds the "Voice Anywhere" submenu dynamically from the current config.
/// Reads `app_language` from config so labels are always in the active UI language.
/// The selected/checked state is applied separately via set_selected() in
/// update_tray() after set_menu() completes.
fn build_voice_anywhere_submenu() -> SystemTraySubmenu {
    let lang = get("app_language")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "en".to_string());
    let l = va_labels(&lang);

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
        .add_item(CustomMenuItem::new("va_section_stt", l.stt_section).disabled())
        .add_item(CustomMenuItem::new("va_stt_inherit", l.inherit));

    for key in &stt_list {
        menu = menu.add_item(CustomMenuItem::new(
            format!("va_stt_{}", key),
            stt_service_display_name(key),
        ));
    }

    // ── Translate to section (favorites configured in Settings → Voice Input) ──
    let fav_targets: Vec<String> = get("voice_anywhere_favorite_targets")
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
        })
        .unwrap_or_else(|| vec!["en".to_string()]);

    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_section_target", l.target_section).disabled())
        .add_item(CustomMenuItem::new("va_target_none", l.no_translate));

    for code in &fav_targets {
        menu = menu.add_item(CustomMenuItem::new(
            format!("va_target_{}", code),
            target_lang_display_name(code),
        ));
    }

    // ── After Stop section ───────────────────────────────────────────────────
    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_section_action", l.after_stop).disabled())
        .add_item(CustomMenuItem::new("va_action_clipboard", l.clipboard))
        .add_item(CustomMenuItem::new("va_action_paste",    l.paste));

    // ── Inject Mode section (Transkit windows only) ──────────────────────────
    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_section_inject", l.inject_section).disabled())
        .add_item(CustomMenuItem::new("va_inject_replace", l.replace))
        .add_item(CustomMenuItem::new("va_inject_append",  l.append));

    // ── Configure shortcut ───────────────────────────────────────────────────
    menu = menu
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("va_config", l.configure));

    SystemTraySubmenu::new(l.title, menu)
}

// ── Voice Anywhere tray-click handlers ────────────────────────────────────

fn on_va_stt_click(app: &AppHandle, stt_key: &str) {
    info!("VA tray: set STT service → {}", stt_key);
    set("voice_anywhere_stt_service", stt_key);
    if let Err(e) = app.emit_all("voice_anywhere_stt_service_changed", stt_key) {
        warn!("[tray] emit voice_anywhere_stt_service_changed failed: {:?}", e);
    }
    update_tray(app.app_handle(), String::new(), String::new());
}

fn on_va_target_click(app: &AppHandle, target_code: &str) {
    info!("VA tray: set target language → {}", target_code);
    set("voice_anywhere_target_language", target_code);
    if let Err(e) = app.emit_all("voice_anywhere_target_language_changed", target_code) {
        warn!("[tray] emit voice_anywhere_target_language_changed failed: {:?}", e);
    }
    update_tray(app.app_handle(), String::new(), String::new());
}

fn on_va_action_click(app: &AppHandle, action: &str) {
    info!("VA tray: set action → {}", action);
    set("voice_anywhere_action", action);
    if let Err(e) = app.emit_all("voice_anywhere_action_changed", action) {
        warn!("[tray] emit voice_anywhere_action_changed failed: {:?}", e);
    }
    update_tray(app.app_handle(), String::new(), String::new());
}

fn on_va_inject_click(app: &AppHandle, mode: &str) {
    info!("VA tray: set inject mode → {}", mode);
    set("voice_anywhere_inject_mode", mode);
    if let Err(e) = app.emit_all("voice_anywhere_inject_mode_changed", mode) {
        warn!("[tray] emit voice_anywhere_inject_mode_changed failed: {:?}", e);
    }
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
