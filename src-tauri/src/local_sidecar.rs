/// local_sidecar.rs — Transkit Local Sidecar process manager
///
/// Manages the lifecycle of the Python inference sidecar that serves
/// LLM (translate/AI), ASR (STT), and TTS requests on localhost.
///
/// Tauri commands exposed:
///   local_sidecar_start(config, window)      → Result<(), String>
///   local_sidecar_stop(window)               → Result<(), String>
///   local_sidecar_status()                   → SidecarStatus
///   local_sidecar_check_setup()              → SetupStatus
///   local_sidecar_check_prereqs()            → Result<serde_json::Value, String>
///   local_sidecar_run_setup(window)          → Result<(), String>
///
/// Frontend event channels (window.emit):
///   "local-sidecar://ready"            { port: u16, capabilities: Vec<String> }
///   "local-sidecar://status"           { message: String }
///   "local-sidecar://setup-progress"   { type, step, message, percent }
///   "local-sidecar://stopped"          {}

use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, Window};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct LocalSidecarState {
    pub process: Mutex<Option<Child>>,
    pub port:    Mutex<u16>,
}

impl LocalSidecarState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            port:    Mutex::new(0),
        }
    }
}

// ── Return types ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SidecarStatus {
    pub running: bool,
    pub port:    u16,
    pub pid:     Option<u32>,
}

#[derive(Serialize)]
pub struct SetupStatus {
    pub ready:      bool,
    pub python:     Option<String>,
    pub env_dir:    String,
    pub components: Vec<String>,   // e.g. ["llm", "stt", "tts"]
}

// ── Sidecar config (passed from frontend) ────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarConfig {
    pub llm_model:          Option<String>,
    pub asr_model:          Option<String>,
    pub asr_task:           Option<String>,
    pub asr_language:       Option<String>,
    pub asr_chunk_seconds:  Option<u32>,
    pub asr_stride_seconds: Option<u32>,
    pub tts_engine:         Option<String>,
    pub tts_model:          Option<String>,
    pub tts_ref_audio:      Option<String>,
    pub llm_temperature:    Option<f64>,
    pub llm_max_tokens:     Option<u32>,
    pub log_level:          Option<String>,
    /// Comma-separated list of components the user has enabled in the UI
    /// (e.g. "stt" when LLM and TTS are unchecked).  If None, falls back to
    /// the installed-components list from the marker file.
    pub enabled_components: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn app_support_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.transkit.desktop")
}

fn sidecar_env_dir() -> PathBuf {
    app_support_dir().join("sidecar-env")
}

fn venv_python() -> PathBuf {
    #[cfg(target_os = "windows")]
    return sidecar_env_dir().join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    return sidecar_env_dir().join("bin").join("python3");
}

fn setup_marker() -> PathBuf {
    sidecar_env_dir().join(".setup_complete")
}

fn scripts_dir() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = vec![
        // Development: repo root relative to Cargo.toml
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/local_sidecar"),
        // macOS .app bundle: Contents/MacOS/../Resources/scripts/local_sidecar
        exe_dir.join("../Resources/scripts/local_sidecar"),
        // Windows installer / Linux: scripts/ sits next to the exe
        exe_dir.join("scripts/local_sidecar"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

fn server_script() -> Option<PathBuf> {
    let p = scripts_dir()?.join("server.py");
    p.exists().then_some(p)
}

fn setup_script() -> Option<PathBuf> {
    let p = scripts_dir()?.join("setup.py");
    p.exists().then_some(p)
}

fn download_script() -> Option<PathBuf> {
    let p = scripts_dir()?.join("download.py");
    p.exists().then_some(p)
}

/// Find an available TCP port in the ephemeral range.
fn find_free_port(start: u16) -> u16 {
    for port in start..=65535 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    start
}

fn system_python() -> String {
    #[cfg(target_os = "windows")]
    {
        for cmd in &["python", "python3", "py"] {
            if std::process::Command::new(cmd)
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return cmd.to_string();
            }
        }
        return "python".to_string();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let candidates = [
            "/opt/homebrew/bin/python3",
            "/opt/homebrew/bin/python3.12",
            "/opt/homebrew/bin/python3.11",
            "/opt/homebrew/bin/python3.10",
            "/usr/local/bin/python3",
        ];
        for p in &candidates {
            if std::path::Path::new(p).exists() {
                return p.to_string();
            }
        }
        "python3".to_string()
    }
}

fn base_env() -> (String, String) {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        let path = std::env::var("PATH").unwrap_or_default();
        return (home, path);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let path_env = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".to_string();
        (home, path_env)
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Internal implementation — accepts AppHandle so it can be called both from
/// the Tauri command (which has a Window) and from the app setup callback
/// (where no window exists yet).
pub fn start_with_handle(
    config: SidecarConfig,
    app_handle: AppHandle,
    state: &LocalSidecarState,
) -> Result<(), String> {
    // Stop any existing process first
    stop_inner(state);

    let script = server_script()
        .ok_or("Sidecar server script not found. Ensure scripts/local_sidecar/server.py exists.")?;

    let python = if venv_python().exists() {
        venv_python().to_string_lossy().into_owned()
    } else {
        return Err("Local Sidecar environment is not installed. Go to Settings → Local Sidecar to set it up.".to_string());
    };

    let port = find_free_port(49152);
    info!("[LocalSidecar] Starting on port {}", port);

    let llm_model = config.llm_model.unwrap_or_else(|| "mlx-community/gemma-3-4b-it-qat-4bit".to_string());
    let asr_model = config.asr_model.unwrap_or_else(|| "mlx-community/whisper-large-v3-turbo".to_string());
    let asr_task  = config.asr_task.unwrap_or_else(|| "transcribe".to_string());
    let tts_engine = config.tts_engine.unwrap_or_else(|| "kokoro".to_string());
    let tts_model  = config.tts_model.unwrap_or_default();
    let log_level  = config.log_level.unwrap_or_else(|| "info".to_string());
    let temperature = config.llm_temperature.unwrap_or(0.3).to_string();
    let max_tokens  = config.llm_max_tokens.unwrap_or(512).to_string();
    let chunk_secs  = config.asr_chunk_seconds.unwrap_or(7).to_string();
    let stride_secs = config.asr_stride_seconds.unwrap_or(5).to_string();

    let (home, path_env) = base_env();

    // Compute the active components: intersection of what is installed (marker file)
    // and what the user has enabled in the UI.  This prevents preloading (and
    // auto-downloading) components that were installed but are currently disabled.
    let installed: std::collections::HashSet<String> =
        read_installed_components().into_iter().collect();
    let installed_components = if let Some(ref enabled_str) = config.enabled_components {
        let enabled: std::collections::HashSet<String> = enabled_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let mut active: Vec<String> = installed.intersection(&enabled).cloned().collect();
        active.sort();
        active.join(",")
    } else {
        let mut all: Vec<String> = installed.into_iter().collect();
        all.sort();
        all.join(",")
    };

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--port").arg(port.to_string())
        .arg("--llm-model").arg(&llm_model)
        .arg("--asr-model").arg(&asr_model)
        .arg("--asr-task").arg(&asr_task)
        .arg("--tts-engine").arg(&tts_engine)
        .arg("--tts-model").arg(&tts_model)
        .arg("--tts-ref-audio").arg(config.tts_ref_audio.unwrap_or_default())
        .arg("--llm-temperature").arg(&temperature)
        .arg("--llm-max-tokens").arg(&max_tokens)
        .arg("--asr-chunk-seconds").arg(&chunk_secs)
        .arg("--asr-stride-seconds").arg(&stride_secs)
        .arg("--log-level").arg(&log_level)
        .arg("--installed-components").arg(&installed_components)
        .env("PATH", path_env)
        .env("HOME", &home)
        .env("TOKENIZERS_PARALLELISM", "false")
        .env("PYTHONPATH", script.parent().unwrap_or(std::path::Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(lang) = config.asr_language {
        cmd.arg("--asr-language").arg(&lang);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start sidecar: {}", e))?;
    info!("[LocalSidecar] Process started PID={}", child.id());

    // Store port
    *state.port.lock().unwrap() = port;

    // Read stdout — wait for {"type":"ready"} then keep forwarding
    let stdout = child.stdout.take().ok_or("Failed to get sidecar stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get sidecar stderr")?;

    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    info!("[LocalSidecar] stdout: {}", &line);
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        match val.get("type").and_then(|t| t.as_str()) {
                            Some("ready") => {
                                let _ = app_handle.emit_all("local-sidecar://ready", &val);
                            }
                            Some("starting") | Some("status") => {
                                let _ = app_handle.emit_all("local-sidecar://status", &val);
                            }
                            Some("model_loading") | Some("model_ready") | Some("model_error") => {
                                let _ = app_handle.emit_all("local-sidecar://model-status", &val);
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    warn!("[LocalSidecar] stdout error: {}", e);
                    break;
                }
                _ => {}
            }
        }
        info!("[LocalSidecar] stdout reader ended");
        // Reset port so local_sidecar_get_port returns 0 while server is dead.
        let sidecar = app_handle.state::<LocalSidecarState>();
        if let Ok(mut p) = sidecar.port.lock() {
            *p = 0;
        }
        let _ = app_handle.emit_all("local-sidecar://stopped", serde_json::json!({}));
    });

    // Pipe stderr to Tauri log
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                if !line.is_empty() {
                    info!("[LocalSidecar:stderr] {}", line);
                }
            }
        }
    });

    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

/// Tauri command wrapper — delegates to start_with_handle.
#[tauri::command]
pub fn local_sidecar_start(
    config: SidecarConfig,
    window: Window,
    state: State<'_, LocalSidecarState>,
) -> Result<(), String> {
    start_with_handle(config, window.app_handle(), &state)
}

/// Stop the sidecar process gracefully.
#[tauri::command]
pub fn local_sidecar_stop(
    window: Window,
    state: State<'_, LocalSidecarState>,
) -> Result<(), String> {
    stop_inner(&state);
    let _ = window.app_handle().emit_all("local-sidecar://stopped", serde_json::json!({}));
    Ok(())
}

/// Returns the port the sidecar is currently listening on (0 if not running).
/// Checks process liveness so a crashed process returns 0, not a stale port.
#[tauri::command]
pub fn local_sidecar_get_port(state: State<'_, LocalSidecarState>) -> u16 {
    // Check liveness without holding the process lock while acquiring port lock.
    let alive = {
        let mut guard = state.process.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_mut()
            .map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false))
            .unwrap_or(false)
    };
    if alive {
        *state.port.lock().unwrap_or_else(|e| e.into_inner())
    } else {
        0
    }
}

fn stop_inner(state: &LocalSidecarState) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some(mut child) = guard.take() {
            info!("[LocalSidecar] Stopping PID={}", child.id());
            let _ = child.kill();
            let _ = child.wait();
            info!("[LocalSidecar] Process stopped");
        }
    }
    if let Ok(mut p) = state.port.lock() {
        *p = 0;
    }
}

/// Returns current sidecar status.
/// Uses try_wait() to detect whether the process is actually still alive,
/// so the UI doesn't show "running" after a crash (e.g. OOM during model load).
#[tauri::command]
pub fn local_sidecar_status(state: State<'_, LocalSidecarState>) -> SidecarStatus {
    let mut guard = state.process.lock().unwrap();
    let port  = *state.port.lock().unwrap();
    match guard.as_mut() {
        Some(child) => {
            // try_wait returns Ok(None) if still running, Ok(Some(status)) if exited
            let alive = child.try_wait().map(|s| s.is_none()).unwrap_or(false);
            SidecarStatus {
                running: alive,
                port: if alive { port } else { 0 },
                pid: Some(child.id()),
            }
        },
        None => SidecarStatus {
            running: false,
            port: 0,
            pid: None,
        },
    }
}

/// Read the installed components list from the .setup_complete marker file.
fn read_installed_components() -> Vec<String> {
    let marker = setup_marker();
    let content = match std::fs::read_to_string(&marker) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    json.get("components")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

/// Check whether the Python environment is ready.
#[tauri::command]
pub fn local_sidecar_check_setup() -> SetupStatus {
    let env_dir    = sidecar_env_dir();
    let python     = venv_python();
    let marker     = setup_marker();
    let ready      = marker.exists() && python.exists();
    let components = if ready { read_installed_components() } else { vec![] };

    SetupStatus {
        ready,
        python: if ready { Some(python.to_string_lossy().into_owned()) } else { None },
        env_dir: env_dir.to_string_lossy().into_owned(),
        components,
    }
}

/// Check prerequisites (Python 3.10+, Homebrew) before running setup.
/// Runs setup.py --prereqs and returns the JSON result.
#[tauri::command]
pub fn local_sidecar_check_prereqs() -> Result<serde_json::Value, String> {
    let script = setup_script()
        .ok_or("Setup script not found. Ensure scripts/local_sidecar/setup.py exists.")?;

    let python = system_python();
    let (home, path_env) = base_env();

    let output = Command::new(&python)
        .arg(&script)
        .arg("--prereqs")
        .env("PATH", &path_env)
        .env("HOME", &home)
        .output()
        .map_err(|e| format!("Failed to run prereqs check: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.is_empty() { stderr.to_string() } else { stdout.to_string() };
        return Err(format!("Prereqs check failed: {}", detail.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if val.get("type").and_then(|t| t.as_str()) == Some("prereqs") {
                return Ok(val);
            }
        }
    }

    // Fallback: could not parse — return a safe error object
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Could not parse prereqs output. stdout={} stderr={}",
        stdout.trim(),
        stderr.trim()
    ))
}

/// Run the setup script.  Streams progress events via `local-sidecar://setup-progress`.
/// components: comma-separated list e.g. "llm,stt,tts"
/// tts_package: pip package name for TTS, empty string = skip TTS
#[tauri::command]
pub fn local_sidecar_run_setup(
    window: Window,
    components: Option<String>,
    tts_package: Option<String>,
) -> Result<(), String> {
    let script = setup_script()
        .ok_or("Setup script not found. Ensure scripts/local_sidecar/setup.py exists.")?;

    let python = system_python();
    let (home, path_env) = base_env();
    let components_str = components.unwrap_or_else(|| "llm,stt,tts".to_string());
    let tts_pkg = tts_package.unwrap_or_else(|| "kokoro-mlx".to_string());

    info!("[LocalSidecar] Running setup with {} — components={} tts={}", python, components_str, tts_pkg);

    let mut child = Command::new(&python)
        .arg(&script)
        .arg("--components").arg(&components_str)
        .arg("--tts-package").arg(&tts_pkg)
        .env("PATH", &path_env)
        .env("HOME", &home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start setup: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to get setup stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get setup stderr")?;

    // Forward all stdout JSON events to the frontend
    let window_stdout = window.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                if !line.is_empty() {
                    info!("[LocalSidecar:setup] {}", &line);
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        let _ = window_stdout.emit("local-sidecar://setup-progress", &val);
                    }
                }
            }
        }
    });

    // Forward stderr to frontend as error events and also to log
    let window_stderr = window.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        let mut buf = String::new();
        for line in reader.lines() {
            if let Ok(line) = line {
                if !line.is_empty() {
                    error!("[LocalSidecar:setup:stderr] {}", line);
                    buf.push_str(&line);
                    buf.push('\n');
                }
            }
        }
        // After stderr drains, if we collected anything emit it as an error event
        // (only if not already a JSON error — setup.py handles its own errors on stdout)
        if !buf.is_empty() {
            let payload = serde_json::json!({
                "type": "error",
                "message": buf.trim()
            });
            let _ = window_stderr.emit("local-sidecar://setup-progress", &payload);
        }
    });

    // Wait for the child in a background thread and emit a final error if it crashes
    let window_wait = window.clone();
    std::thread::spawn(move || {
        match child.wait() {
            Ok(status) if !status.success() => {
                let code = status.code().unwrap_or(-1);
                // Only emit if the setup script didn't already emit its own error on stdout
                // Give stdout thread a moment to flush, then check if we need to emit
                std::thread::sleep(std::time::Duration::from_millis(200));
                let payload = serde_json::json!({
                    "type": "error",
                    "message": format!("Setup process exited with code {}", code)
                });
                let _ = window_wait.emit("local-sidecar://setup-progress", &payload);
            }
            Err(e) => {
                let payload = serde_json::json!({
                    "type": "error",
                    "message": format!("Setup process error: {}", e)
                });
                let _ = window_wait.emit("local-sidecar://setup-progress", &payload);
            }
            _ => {}
        }
    });

    Ok(())
}

/// Download a HuggingFace model to the local cache.
/// Streams `local-sidecar://download-progress` events: {type, percent, message, repo_id}.
#[tauri::command]
pub fn local_sidecar_download_model(
    repo_id: String,
    window: Window,
) -> Result<(), String> {
    let script = download_script()
        .ok_or("Download script not found.")?;

    let python = if venv_python().exists() {
        venv_python().to_string_lossy().into_owned()
    } else {
        return Err("Local Sidecar environment not installed. Go to Settings → Local Model.".to_string());
    };

    let (home, path_env) = base_env();

    let mut child = Command::new(&python)
        .arg(&script)
        .arg("--repo").arg(&repo_id)
        .env("PATH", path_env)
        .env("HOME", &home)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start download: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;

    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                if !line.is_empty() {
                    if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&line) {
                        // Tag every event with the repo so the UI can match it
                        if let Some(obj) = val.as_object_mut() {
                            obj.insert("repo_id".to_string(), serde_json::json!(repo_id));
                        }
                        let _ = window.emit("local-sidecar://download-progress", &val);
                    }
                }
            }
        }
        let _ = child.wait();
    });

    Ok(())
}

// ── Model cache management ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CachedModel {
    pub repo_id:    String,
    pub size_bytes: u64,
    pub path:       String,
}

/// Returns the HuggingFace hub cache directory.
fn hf_cache_dir() -> PathBuf {
    if let Ok(p) = std::env::var("HF_HUB_CACHE").or_else(|_| std::env::var("HUGGINGFACE_HUB_CACHE")) {
        return PathBuf::from(p);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cache")
        .join("huggingface")
        .join("hub")
}

/// Recursively sum directory size in bytes.
fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_symlink() {
                if let Ok(meta) = std::fs::metadata(&p) {
                    total += meta.len();
                }
            } else if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Convert HF cache dir name → repo_id.
/// "models--mlx-community--whisper-large-v3-turbo" → "mlx-community/whisper-large-v3-turbo"
fn dir_name_to_repo_id(name: &str) -> Option<String> {
    let rest = name.strip_prefix("models--")?;
    let mut parts = rest.splitn(2, "--");
    let org   = parts.next()?;
    let model = parts.next()?;
    Some(format!("{}/{}", org, model))
}

/// List all models cached in the HuggingFace hub cache directory.
#[tauri::command]
pub fn local_sidecar_list_cached_models() -> Vec<CachedModel> {
    let cache = hf_cache_dir();
    let mut models = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&cache) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() { continue; }
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !name.starts_with("models--") { continue; }
            if let Some(repo_id) = dir_name_to_repo_id(&name) {
                models.push(CachedModel {
                    repo_id,
                    size_bytes: dir_size(&p),
                    path: p.to_string_lossy().into_owned(),
                });
            }
        }
    }
    models.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    models
}

/// Delete a cached model by repo_id.
#[tauri::command]
pub fn local_sidecar_delete_cached_model(repo_id: String) -> Result<(), String> {
    let cache = hf_cache_dir();
    let dir_name = format!("models--{}", repo_id.replace('/', "--"));
    let model_path = cache.join(&dir_name);
    if !model_path.exists() {
        return Err(format!("Cached model not found: {}", repo_id));
    }
    std::fs::remove_dir_all(&model_path)
        .map_err(|e| format!("Failed to delete model cache: {}", e))?;
    info!("[LocalSidecar] Deleted model cache: {}", repo_id);
    Ok(())
}

/// Open the HuggingFace hub cache directory in the system file manager.
#[tauri::command]
pub fn local_sidecar_reveal_cache() -> Result<(), String> {
    let path = hf_cache_dir();
    std::fs::create_dir_all(&path).ok();
    let path_str = path.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path_str)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path_str)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path_str)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}
