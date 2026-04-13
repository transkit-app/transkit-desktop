/// onnx_engine.rs — Transkit ONNX STT Engine process manager
///
/// Manages the lifecycle of a sherpa-onnx powered STT server running on localhost.
/// This is separate from the Local Sidecar (local_sidecar.rs) and does NOT modify it.
///
/// The ONNX engine reuses the same server.py script as the Local Sidecar but is
/// started with --asr-backend onnx, a separate port range (49200+), and its own
/// Python environment.
///
/// Tauri commands exposed:
///   onnx_engine_check_setup()              -> OnnxSetupStatus
///   onnx_engine_install(window)            -> Result<(), String>
///   onnx_engine_start(config, window)      -> Result<(), String>
///   onnx_engine_stop(window)               -> Result<(), String>
///   onnx_engine_status(state)              -> OnnxEngineStatus
///   onnx_engine_get_port(state)            -> u16
///   onnx_model_download(repo, window)      -> Result<(), String>
///   onnx_model_list()                      -> Vec<OnnxModel>
///   onnx_model_delete(repo)                -> Result<(), String>
///
/// Frontend event channels (window.emit):
///   "onnx-engine://setup-progress"   { type, step, message, percent }
///   "onnx-engine://ready"            { port: u16 }
///   "onnx-engine://stopped"          {}
///   "onnx-model://progress"          { step, percent, message, file }

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
#[cfg(target_os = "windows")]
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, Window};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct OnnxEngineState {
    pub process: Mutex<Option<Child>>,
    pub port:    Mutex<u16>,
}

impl OnnxEngineState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            port:    Mutex::new(0),
        }
    }
}

// ── Return types ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OnnxSetupStatus {
    pub ready:             bool,
    pub python:            Option<String>,
    pub sherpa_installed:  bool,
    /// "macos_mlx_venv" | "macos_standalone" | "windows" | "linux"
    pub platform:          String,
}

#[derive(Serialize)]
pub struct OnnxEngineStatus {
    pub running: bool,
    pub port:    u16,
    pub pid:     Option<u32>,
}

#[derive(Serialize)]
pub struct OnnxModel {
    pub repo_id:     String,
    pub path:        String,
    pub size_bytes:  u64,
    pub has_encoder: bool,  // true for encoder*.onnx OR model*.onnx (CTC)
    pub has_decoder: bool,
    pub has_joiner:  bool,
    pub has_tokens:  bool,
    pub is_ctc:      bool,  // CTC model: no decoder/joiner needed
}

// ── Config passed from frontend ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct OnnxSttConfig {
    pub asr_model:    Option<String>,
    pub asr_language: Option<String>,
    pub log_level:    Option<String>,
}

// ── Path helpers ──────────────────────────────────────────────────────────────

fn onnx_engine_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.transkit.desktop")
        .join("onnx-engine")
}

fn onnx_models_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.transkit.desktop")
        .join("onnx-models")
}

fn setup_marker() -> PathBuf {
    onnx_engine_dir().join(".onnx_setup_complete")
}

/// Sidecar shared venv python (reused when available on macOS).
fn sidecar_python() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_default()
        .join("com.transkit.desktop")
        .join("sidecar-env")
        .join("bin")
        .join("python3")
}

fn onnx_python_exe() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        // Prefer existing sidecar venv — avoids a second Python environment
        let sp = sidecar_python();
        if sp.exists() {
            return sp;
        }
        // Fall back to onnx-specific venv
        onnx_engine_dir().join("env").join("bin").join("python3")
    }
    #[cfg(target_os = "windows")]
    {
        onnx_engine_dir().join("python").join("python.exe")
    }
    #[cfg(target_os = "linux")]
    {
        onnx_engine_dir().join("env").join("bin").join("python3")
    }
}

/// Resolve the server.py script path (same logic as local_sidecar.rs).
fn server_script() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = vec![
        // Development: relative to Cargo.toml
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/local_sidecar/server.py"),
        // macOS app bundle: Contents/MacOS/../Resources/...
        exe_dir.join("../Resources/scripts/local_sidecar/server.py"),
        // Windows installer: resources are next to the .exe
        exe_dir.join("scripts/local_sidecar/server.py"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

fn find_free_port(start: u16) -> u16 {
    for port in start..=65535 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    start
}

fn base_env() -> (String, String) {
    #[cfg(target_os = "windows")]
    {
        // On Windows, inherit the current process PATH so Python can find its DLLs.
        // HOME doesn't exist on Windows; use USERPROFILE instead.
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

/// Determine which Python platform variant we're on.
fn detect_platform() -> String {
    #[cfg(target_os = "macos")]
    {
        if sidecar_python().exists() {
            "macos_mlx_venv".to_string()
        } else {
            "macos_standalone".to_string()
        }
    }
    #[cfg(target_os = "windows")]
    { "windows".to_string() }
    #[cfg(target_os = "linux")]
    { "linux".to_string() }
}

/// Check whether sherpa_onnx is importable in the onnx python exe.
fn check_sherpa_installed(python: &PathBuf) -> bool {
    if !python.exists() {
        return false;
    }
    let result = Command::new(python)
        .args(["-c", "import sherpa_onnx"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    result.map(|s| s.success()).unwrap_or(false)
}

/// Emit a progress event to the frontend.
fn emit_progress(window: &Window, step: &str, message: &str, percent: u8) {
    let payload = serde_json::json!({
        "type": "progress",
        "step": step,
        "message": message,
        "percent": percent,
    });
    let _ = window.emit("onnx-engine://setup-progress", &payload);
}

fn emit_error(window: &Window, message: &str) {
    let payload = serde_json::json!({
        "type": "error",
        "message": message,
    });
    let _ = window.emit("onnx-engine://setup-progress", &payload);
}

fn emit_done(window: &Window) {
    let payload = serde_json::json!({
        "type": "done",
        "ready": true,
    });
    let _ = window.emit("onnx-engine://setup-progress", &payload);
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Check whether the ONNX engine Python environment is ready.
#[tauri::command]
pub fn onnx_engine_check_setup() -> OnnxSetupStatus {
    let python = onnx_python_exe();
    let platform = detect_platform();
    let sherpa_installed = check_sherpa_installed(&python);
    let marker_exists = setup_marker().exists();
    let ready = marker_exists && python.exists() && sherpa_installed;

    OnnxSetupStatus {
        ready,
        python: if python.exists() {
            Some(python.to_string_lossy().into_owned())
        } else {
            None
        },
        sherpa_installed,
        platform,
    }
}

/// Install the sherpa-onnx Python environment.
/// Streams progress via "onnx-engine://setup-progress" events.
#[tauri::command]
pub fn onnx_engine_install(window: Window) -> Result<(), String> {
    let engine_dir = onnx_engine_dir();
    std::fs::create_dir_all(&engine_dir)
        .map_err(|e| format!("Failed to create onnx-engine dir: {}", e))?;

    let platform = detect_platform();

    // ── macOS: reuse sidecar venv ──────────────────────────────────────────────
    if platform == "macos_mlx_venv" {
        let python = sidecar_python();
        emit_progress(&window, "install", "Installing sherpa-onnx into sidecar venv...", 10);

        let mut child = Command::new(&python)
            .args(["-m", "pip", "install", "sherpa-onnx", "--quiet"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run pip: {}", e))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        let window_clone = window.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for (i, line) in reader.lines().enumerate() {
                if let Ok(line) = line {
                    if !line.is_empty() {
                        emit_progress(&window_clone, "install", &line, 10 + (i as u8).min(80));
                    }
                }
            }
        });

        let window_wait = window.clone();
        let engine_dir_clone = engine_dir.clone();
        std::thread::spawn(move || {
            match child.wait() {
                Ok(status) if status.success() => {
                    let _ = std::fs::write(
                        engine_dir_clone.join(".onnx_setup_complete"),
                        serde_json::json!({ "platform": "macos_mlx_venv" }).to_string(),
                    );
                    emit_done(&window_wait);
                }
                Ok(status) => {
                    emit_error(&window_wait, &format!("pip exited with code {}", status.code().unwrap_or(-1)));
                }
                Err(e) => {
                    emit_error(&window_wait, &format!("pip wait error: {}", e));
                }
            }
        });

        return Ok(());
    }

    // ── macOS standalone / Linux: create venv ────────────────────────────────
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let venv_dir = engine_dir.join("env");
        emit_progress(&window, "venv", "Creating Python virtual environment...", 5);

        // Find a system python3
        let system_python = find_system_python();

        let venv_out = Command::new(&system_python)
            .args(["-m", "venv", venv_dir.to_str().unwrap_or("env")])
            .output()
            .map_err(|e| format!("Failed to create venv: {}", e))?;

        if !venv_out.status.success() {
            let msg = String::from_utf8_lossy(&venv_out.stderr);
            return Err(format!("venv creation failed: {}", msg.trim()));
        }

        let pip_exe = venv_dir.join("bin").join("pip3");
        let packages = ["sherpa-onnx", "fastapi", "uvicorn", "websockets", "numpy"];

        emit_progress(&window, "install", "Installing sherpa-onnx and dependencies...", 20);

        let window_clone = window.clone();
        let engine_dir_clone = engine_dir.clone();

        let mut child = Command::new(&pip_exe)
            .arg("install")
            .args(&packages)
            .arg("--quiet")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run pip: {}", e))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for (i, line) in reader.lines().enumerate() {
                if let Ok(line) = line {
                    if !line.is_empty() {
                        emit_progress(&window_clone, "install", &line, 20 + (i as u8).min(70));
                    }
                }
            }
        });

        let window_wait = window.clone();
        std::thread::spawn(move || {
            match child.wait() {
                Ok(status) if status.success() => {
                    let _ = std::fs::write(
                        engine_dir_clone.join(".onnx_setup_complete"),
                        serde_json::json!({ "platform": "standalone" }).to_string(),
                    );
                    emit_done(&window_wait);
                }
                Ok(status) => {
                    emit_error(&window_wait, &format!("pip exited with code {}", status.code().unwrap_or(-1)));
                }
                Err(e) => {
                    emit_error(&window_wait, &format!("pip error: {}", e));
                }
            }
        });

        return Ok(());
    }

    // ── Windows: embedded Python ──────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        let python_dir = engine_dir.join("python");
        let python_exe = python_dir.join("python.exe");

        // Step 1: download embedded Python if needed
        if !python_exe.exists() {
            emit_progress(&window, "download_python", "Downloading Python 3.11 embeddable package...", 5);

            let url = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip";
            let zip_path = engine_dir.join("python-embed.zip");

            let resp = reqwest::blocking::get(url)
                .map_err(|e| format!("Failed to download Python: {}", e))?;
            let bytes = resp.bytes()
                .map_err(|e| format!("Failed to read Python zip: {}", e))?;
            std::fs::write(&zip_path, &bytes)
                .map_err(|e| format!("Failed to save Python zip: {}", e))?;

            emit_progress(&window, "extract_python", "Extracting Python...", 20);
            std::fs::create_dir_all(&python_dir)
                .map_err(|e| format!("Failed to create python dir: {}", e))?;

            let file = std::fs::File::open(&zip_path)
                .map_err(|e| format!("Failed to open zip: {}", e))?;
            let mut archive = zip::ZipArchive::new(file)
                .map_err(|e| format!("Failed to read zip: {}", e))?;
            archive.extract(&python_dir)
                .map_err(|e| format!("Failed to extract zip: {}", e))?;
            let _ = std::fs::remove_file(&zip_path);

            // Patch python311._pth to enable site-packages and import site
            let pth_file = python_dir.join("python311._pth");
            if pth_file.exists() {
                let content = std::fs::read_to_string(&pth_file)
                    .unwrap_or_default();
                let patched = content
                    .replace("#import site", "import site")
                    .replace("#Lib\\site-packages", "Lib\\site-packages");
                // Ensure Lib\site-packages is present
                let patched = if !patched.contains("Lib\\site-packages") {
                    format!("{}\nLib\\site-packages\nimport site\n", patched)
                } else {
                    patched
                };
                let _ = std::fs::write(&pth_file, patched);
            }
        }

        // Step 2: get-pip.py if pip is not importable yet
        let pip_check = Command::new(&python_exe)
            .args(["-m", "pip", "--version"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !pip_check.map(|status| status.success()).unwrap_or(false) {
            emit_progress(&window, "download_pip", "Downloading pip...", 30);

            let get_pip_url = "https://bootstrap.pypa.io/get-pip.py";
            let get_pip_path = engine_dir.join("get-pip.py");
            let resp = reqwest::blocking::get(get_pip_url)
                .map_err(|e| format!("Failed to download get-pip.py: {}", e))?;
            let bytes = resp.bytes()
                .map_err(|e| format!("Failed to read get-pip.py: {}", e))?;
            std::fs::write(&get_pip_path, &bytes)
                .map_err(|e| format!("Failed to save get-pip.py: {}", e))?;

            emit_progress(&window, "install_pip", "Installing pip...", 40);
            use std::os::windows::process::CommandExt;
            let out = Command::new(&python_exe)
                .arg(&get_pip_path)
                .arg("--no-warn-script-location")
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("Failed to run get-pip.py: {}", e))?;
            if !out.status.success() {
                let msg = String::from_utf8_lossy(&out.stderr);
                return Err(format!("get-pip.py failed: {}", msg.trim()));
            }
        }

        // Step 3: install packages
        emit_progress(&window, "install", "Installing sherpa-onnx...", 50);

        let packages = ["sherpa-onnx", "fastapi", "uvicorn", "websockets", "numpy"];
        let window_clone = window.clone();
        let engine_dir_clone = engine_dir.clone();
        let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let stderr_lines_clone = Arc::clone(&stderr_lines);

        let mut child = Command::new(&python_exe)
            .args(["-m", "pip", "install"])
            .args(&packages)
            .arg("--no-warn-script-location")
            .arg("--quiet")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW (CommandExt already imported above)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run pip: {}", e))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for (i, line) in reader.lines().enumerate() {
                if let Ok(line) = line {
                    if !line.is_empty() {
                        emit_progress(&window_clone, "install", &line, 50 + (i as u8).min(45));
                    }
                }
            }
        });

        let stderr = child.stderr.take().ok_or("No stderr")?;
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    warn!("[OnnxEngine:pip stderr] {}", trimmed);
                    if let Ok(mut lines) = stderr_lines_clone.lock() {
                        if lines.len() < 20 {
                            lines.push(trimmed.to_string());
                        }
                    }
                }
            }
        });

        let window_wait = window.clone();
        std::thread::spawn(move || {
            match child.wait() {
                Ok(status) if status.success() => {
                    let _ = std::fs::write(
                        engine_dir_clone.join(".onnx_setup_complete"),
                        serde_json::json!({ "platform": "windows" }).to_string(),
                    );
                    emit_done(&window_wait);
                }
                Ok(status) => {
                    let stderr_summary = stderr_lines
                        .lock()
                        .map(|lines| lines.join("\n"))
                        .unwrap_or_default();
                    let message = if stderr_summary.is_empty() {
                        format!("pip exited with code {}", status.code().unwrap_or(-1))
                    } else {
                        format!(
                            "pip exited with code {}: {}",
                            status.code().unwrap_or(-1),
                            stderr_summary
                        )
                    };
                    emit_error(&window_wait, &message);
                }
                Err(e) => {
                    emit_error(&window_wait, &format!("pip error: {}", e));
                }
            }
        });

        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for ONNX engine install".to_string())
}

/// Start the ONNX STT engine server.
#[tauri::command]
pub fn onnx_engine_start(
    config: OnnxSttConfig,
    window: Window,
    state: State<'_, OnnxEngineState>,
) -> Result<(), String> {
    start_with_handle(config, window.app_handle(), &state)
}

pub fn start_with_handle(
    config: OnnxSttConfig,
    app_handle: AppHandle,
    state: &OnnxEngineState,
) -> Result<(), String> {
    // Stop any existing process
    stop_inner(state);

    let script = server_script()
        .ok_or("Server script not found. Ensure scripts/local_sidecar/server.py exists.")?;

    let python = onnx_python_exe();
    if !python.exists() {
        return Err(
            "ONNX engine Python not found. Go to Settings → Offline STT to install it."
                .to_string(),
        );
    }

    // Use a separate port range from the MLX sidecar (49152+)
    let port = find_free_port(49200);
    info!("[OnnxEngine] Starting on port {}", port);

    let asr_model = config.asr_model.unwrap_or_else(|| "csukuangfj/sherpa-onnx-streaming-zipformer-small-en-2023-06-26".to_string());
    let log_level = config.log_level.unwrap_or_else(|| "info".to_string());

    let (home, path_env) = base_env();

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--port").arg(port.to_string())
        .arg("--asr-backend").arg("onnx")
        .arg("--asr-model").arg(&asr_model)
        .arg("--log-level").arg(&log_level)
        .env("PATH", path_env)
        .env("HOME", &home)
        .env("TOKENIZERS_PARALLELISM", "false")
        .env(
            "PYTHONPATH",
            script.parent().unwrap_or(std::path::Path::new(".")),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Hide the console window on Windows so no terminal flashes up
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Some(lang) = config.asr_language {
        cmd.arg("--asr-language").arg(&lang);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start ONNX engine: {}", e))?;
    info!("[OnnxEngine] Process started PID={}", child.id());

    *state.port.lock().unwrap() = port;

    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    // Shared stderr buffer so the stdout thread can include crash output in the stopped event.
    let stderr_buf: std::sync::Arc<Mutex<Vec<String>>> =
        std::sync::Arc::new(Mutex::new(Vec::new()));
    let stderr_buf_writer = std::sync::Arc::clone(&stderr_buf);

    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    info!("[OnnxEngine] stdout: {}", &line);
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        match val.get("type").and_then(|t| t.as_str()) {
                            Some("ready") => {
                                let _ = app_handle.emit_all("onnx-engine://ready", &val);
                            }
                            Some("starting") | Some("status") => {
                                let _ = app_handle.emit_all("onnx-engine://status", &val);
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    warn!("[OnnxEngine] stdout error: {}", e);
                    break;
                }
                _ => {}
            }
        }
        info!("[OnnxEngine] stdout reader ended");
        let engine = app_handle.state::<OnnxEngineState>();
        if let Ok(mut p) = engine.port.lock() {
            *p = 0;
        }
        // Give the stderr thread a moment to flush its last lines
        std::thread::sleep(std::time::Duration::from_millis(100));
        let error_output = stderr_buf
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default();
        let _ = app_handle.emit_all(
            "onnx-engine://stopped",
            serde_json::json!({ "error": if error_output.is_empty() { serde_json::Value::Null } else { error_output.into() } }),
        );
    });

    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let line = line.trim().to_string();
                if !line.is_empty() {
                    info!("[OnnxEngine:stderr] {}", line);
                    if let Ok(mut buf) = stderr_buf_writer.lock() {
                        if buf.len() < 30 {
                            buf.push(line);
                        }
                    }
                }
            }
        }
    });

    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

/// Stop the ONNX engine process.
#[tauri::command]
pub fn onnx_engine_stop(
    window: Window,
    state: State<'_, OnnxEngineState>,
) -> Result<(), String> {
    stop_inner(&state);
    let _ = window
        .app_handle()
        .emit_all("onnx-engine://stopped", serde_json::json!({}));
    Ok(())
}

/// Return the port the ONNX engine is listening on (0 if not running).
#[tauri::command]
pub fn onnx_engine_get_port(state: State<'_, OnnxEngineState>) -> u16 {
    let alive = {
        let mut guard = state.process.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .as_mut()
            .map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false))
            .unwrap_or(false)
    };
    if alive {
        *state.port.lock().unwrap_or_else(|e| e.into_inner())
    } else {
        0
    }
}

/// Return current ONNX engine status.
#[tauri::command]
pub fn onnx_engine_status(state: State<'_, OnnxEngineState>) -> OnnxEngineStatus {
    let mut guard = state.process.lock().unwrap();
    let port = *state.port.lock().unwrap();
    match guard.as_mut() {
        Some(child) => {
            let alive = child.try_wait().map(|s| s.is_none()).unwrap_or(false);
            OnnxEngineStatus {
                running: alive,
                port: if alive { port } else { 0 },
                pid: Some(child.id()),
            }
        }
        None => OnnxEngineStatus {
            running: false,
            port: 0,
            pid: None,
        },
    }
}

fn stop_inner(state: &OnnxEngineState) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some(mut child) = guard.take() {
            info!("[OnnxEngine] Stopping PID={}", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut p) = state.port.lock() {
        *p = 0;
    }
}

// ── Model management ──────────────────────────────────────────────────────────

/// Download a Zipformer ONNX model from HuggingFace.
/// Streams "onnx-model://progress" events to the window.
#[tauri::command]
pub fn onnx_model_download(repo: String, window: Window) -> Result<(), String> {
    let models_dir = onnx_models_dir();
    let repo_dir = models_dir.join(repo.replace('/', "__"));

    std::fs::create_dir_all(&repo_dir)
        .map_err(|e| format!("Failed to create model dir: {}", e))?;

    let repo_clone = repo.clone();
    let window_clone = window.clone();

    std::thread::spawn(move || {
        if let Err(e) = download_model_inner(&repo_clone, &repo_dir, &window_clone) {
            let _ = window_clone.emit(
                "onnx-model://progress",
                serde_json::json!({
                    "step": "error",
                    "percent": 0,
                    "message": e,
                    "file": "",
                }),
            );
        }
    });

    Ok(())
}

fn download_model_inner(repo: &str, repo_dir: &PathBuf, window: &Window) -> Result<(), String> {
    // reqwest is async-only; use tauri's runtime handle to block on the async work.
    tauri::async_runtime::block_on(download_model_async(repo, repo_dir, window))
}

async fn download_model_async(repo: &str, repo_dir: &PathBuf, window: &Window) -> Result<(), String> {
    let api_url = format!("https://huggingface.co/api/models/{}", repo);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Failed to query HuggingFace API: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "HuggingFace API returned {}: repo '{}' not found or rate-limited.",
            resp.status(),
            repo
        ));
    }

    let model_info: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HuggingFace API response: {}", e))?;

    // Extract file list from siblings
    let siblings = model_info
        .get("siblings")
        .and_then(|s| s.as_array())
        .ok_or("HuggingFace API response missing 'siblings' field")?;

    // Filter for .onnx files, tokens, models, and config files
    let files_to_download: Vec<String> = siblings
        .iter()
        .filter_map(|s| s.get("rfilename").and_then(|f| f.as_str()).map(|f| f.to_string()))
        .filter(|f| {
            let lf = f.to_lowercase();
            f.ends_with(".onnx") ||
            lf.contains("tokens") ||
            f.ends_with(".model") ||
            f.ends_with(".yaml") ||
            f.ends_with(".json") ||
            lf.contains("vocab")
        })
        .collect();

    if files_to_download.is_empty() {
        return Err(format!(
            "No .onnx or tokens.txt files found in repo '{}'. \
             Check the repo ID — expected a Zipformer RNNT model.",
            repo
        ));
    }

    let total = files_to_download.len();
    info!("[OnnxEngine] Downloading {} files from {}", total, repo);

    for (i, filename) in files_to_download.iter().enumerate() {
        let download_url = format!(
            "https://huggingface.co/{}/resolve/main/{}",
            repo, filename
        );
        let dest = repo_dir.join(filename);

        // Create parent dirs if needed (some models have subdirs)
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let percent = ((i as f32 / total as f32) * 90.0) as u8;
        let _ = window.emit(
            "onnx-model://progress",
            serde_json::json!({
                "step": "downloading",
                "percent": percent,
                "message": format!("Downloading {} ({}/{})", filename, i + 1, total),
                "file": filename,
            }),
        );

        let file_resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download {}: {}", filename, e))?;

        if !file_resp.status().is_success() {
            return Err(format!(
                "Failed to download {}: HTTP {}",
                filename,
                file_resp.status()
            ));
        }

        let bytes = file_resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read {}: {}", filename, e))?;

        std::fs::write(&dest, &bytes)
            .map_err(|e| format!("Failed to write {}: {}", filename, e))?;

        info!("[OnnxEngine] Downloaded {} ({} bytes)", filename, bytes.len());
    }

    // Write manifest
    let manifest = serde_json::json!({
        "repo_id": repo,
        "files": files_to_download,
        "downloaded_at": chrono_now(),
    });
    let _ = std::fs::write(
        repo_dir.join(".manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    );

    let _ = window.emit(
        "onnx-model://progress",
        serde_json::json!({
            "step": "done",
            "percent": 100,
            "message": format!("Model '{}' downloaded successfully.", repo),
            "file": "",
        }),
    );

    Ok(())
}

fn chrono_now() -> String {
    // Simple ISO timestamp without chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{}", secs)
}

/// List all downloaded ONNX models.
#[tauri::command]
pub fn onnx_model_list() -> Vec<OnnxModel> {
    let models_dir = onnx_models_dir();
    let mut models = Vec::new();

    let entries = match std::fs::read_dir(&models_dir) {
        Ok(e) => e,
        Err(_) => return models,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Convert back to repo_id: "hynt__Zipformer-30M" -> "hynt/Zipformer-30M"
        let repo_id = dir_name.replacen("__", "/", 1);

        let has_encoder_file = has_glob(&path, "encoder");
        let has_model_file   = has_glob(&path, "model");   // CTC: model.onnx / model.int8.onnx
        let has_encoder = has_encoder_file || has_model_file;
        let has_decoder = has_glob(&path, "decoder");
        let has_joiner  = has_glob(&path, "joiner");
        let has_tokens  = path.join("tokens.txt").exists() ||
                         has_glob(&path, "tokens") ||
                         has_glob(&path, ".model") ||
                         has_glob(&path, "vocab");
        let is_ctc = has_encoder && !has_decoder && !has_joiner;
        let size_bytes = dir_size(&path);

        models.push(OnnxModel {
            repo_id,
            path: path.to_string_lossy().into_owned(),
            size_bytes,
            has_encoder,
            has_decoder,
            has_joiner,
            has_tokens,
            is_ctc,
        });
    }

    models.sort_by(|a, b| a.repo_id.cmp(&b.repo_id));
    models
}

fn has_glob(dir: &PathBuf, pattern: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_lowercase();
        if matches!(pattern, "encoder" | "decoder" | "joiner" | "model") {
            if name.contains(pattern) && name.ends_with(".onnx") {
                return true;
            }
        } else {
            if name.contains(pattern) {
                return true;
            }
        }
    }
    false
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Delete a downloaded ONNX model by repo ID.
#[tauri::command]
pub fn onnx_model_delete(repo: String) -> Result<(), String> {
    let models_dir = onnx_models_dir();
    let repo_dir = models_dir.join(repo.replace('/', "__"));

    if !repo_dir.exists() {
        return Err(format!("Model not found: {}", repo));
    }

    std::fs::remove_dir_all(&repo_dir)
        .map_err(|e| format!("Failed to delete model: {}", e))?;

    info!("[OnnxEngine] Deleted model: {}", repo);
    Ok(())
}

// ── Platform helpers ──────────────────────────────────────────────────────────

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn find_system_python() -> String {
    let candidates = [
        "/opt/homebrew/bin/python3",
        "/opt/homebrew/bin/python3.12",
        "/opt/homebrew/bin/python3.11",
        "/opt/homebrew/bin/python3.10",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
    ];
    for p in &candidates {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    "python3".to_string()
}
