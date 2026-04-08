# Local Sidecar — Design Document

**Status:** Draft  
**Target:** Transkit Desktop v3.x  

---

## Overview

Local Sidecar is an optional feature that runs a Python-based inference server as a managed subprocess (sidecar) inside Transkit. When enabled, it exposes a lightweight localhost API that any Transkit service layer (Translate, AI, TTS, STT) can connect to — without any cloud dependency, API key, or internet access.

The user chooses whether to install it. If they do, they get privacy-first, offline-capable inference powered by local models (MLX on Apple Silicon, with future Windows/Linux backends). All configuration lives under **Settings → Local Sidecar**, following the same UX pattern as Voice Input and Hotkeys.

---

## Goals

- Zero-friction optional feature: appears in Settings, off by default.
- One sidecar process serves all four service types (Translate, AI, TTS, STT).
- Each service layer connects to Local Sidecar through the existing service adapter interface — no special-casing in Monitor, VoiceAnywhere, or other windows.
- Model selection and capability management are transparent to the user.
- Designed to support Apple Silicon (MLX) now, with an extension point for Windows (GGUF/llama.cpp) later.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Transkit Frontend                     │
│                                                         │
│  Translate layer ──────────────────────────────────┐    │
│  AI layer ─────────────────────────────────────────┤    │
│  TTS layer ────────────────────────────────────────┤    │
│  STT layer (WebSocket) ────────────────────────────┘    │
│           │                                             │
│           │ HTTP / WebSocket → localhost:PORT           │
└───────────┼─────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────┐
│              Local Sidecar Server (Python)               │
│                                                         │
│  POST  /v1/translate   ← Translate service adapter      │
│  POST  /v1/chat        ← AI service adapter             │
│  POST  /v1/tts         ← TTS service adapter            │
│  WS    /v1/transcribe  ← STT service adapter            │
│  GET   /v1/health      ← startup / keepalive            │
│  GET   /v1/capabilities ← which endpoints are ready     │
│                                                         │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ LLM Engine │  │  ASR Engine  │  │   TTS Engine    │ │
│  │ (mlx-lm)  │  │(mlx-whisper) │  │  (kokoro-mlx)   │ │
│  └────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
            │
            │  managed by
            │
┌───────────▼─────────────────────────────────────────────┐
│              Tauri Rust Layer (local_sidecar.rs)         │
│                                                         │
│  local_sidecar_start()   — spawn sidecar, pick port     │
│  local_sidecar_stop()    — graceful shutdown            │
│  local_sidecar_status()  — running / stopped / error    │
│  local_sidecar_run_setup(channel) — install pipeline    │
│  local_sidecar_check_setup() — is env ready?            │
└─────────────────────────────────────────────────────────┘
```

---

## Settings Page: Local Sidecar

Route: `/local-sidecar`  
Sidebar position: between **Voice Input** and **Hotkey**

### Sections

#### 1. Environment Setup

Shown when the Python environment is not yet installed.

- **Status badge**: `Not installed` / `Installing…` / `Ready`
- **Requirements notice**: macOS Apple Silicon recommended · ~3 GB disk · Python 3.10+ via Homebrew
- **Install button**: runs `local_sidecar_run_setup` Tauri command, streams JSON progress to a progress bar
- **Progress log**: collapsible terminal-style output (like Xcode's build log)

Once installed, this section collapses into a compact status row.

#### 2. Startup

- **Enable Local Sidecar** toggle — starts sidecar at Transkit launch (default: off)
- **Port** — localhost port (default: `49152`, auto-selected if busy)
- **Status indicator** — `Running (PID 12345)` / `Stopped` / `Error`
- **[Start] / [Stop]** button (manual control)

#### 3. LLM — Language Model

Controls the model used for Translate and AI requests.

| Setting | Options |
|---|---|
| Model | Gemma 4B · Gemma 12B · Gemma 27B · Qwen2.5-3B · Qwen2.5-7B · Llama-3.2-3B · (custom HF repo) |
| Max context tokens | 2048 · 4096 · 8192 |
| Temperature | slider 0.0–1.0 (default 0.3) |
| System prompt override | textarea (optional) |

> **Gemma 4** (released April 2025): `mlx-community/gemma-3-4b-it-qat-4bit` and larger variants. Recommended default for Apple Silicon M2+.

#### 4. STT — Speech Recognition

Controls the Whisper model used when `local_sidecar_stt` is selected as a transcription service.

| Setting | Options |
|---|---|
| Model | Whisper Tiny · Whisper Base · Whisper Small · Whisper Large-v3-turbo |
| Default language | auto-detect · or fixed ISO code |
| Chunk size | 3s · 5s · 7s · 10s |
| Stride | 2s · 3s · 5s |

#### 5. TTS — Text to Speech

Controls the voice model used when `local_sidecar_tts` is selected as a TTS provider.

| Setting | Options |
|---|---|
| Engine | Kokoro (default) · (future: Piper) |
| Voice | af_heart · af_bella · am_adam · bf_emma · (lists from sidecar /v1/tts/voices) |
| Speed | 0.5×–2.0× |

#### 6. Advanced

- **Log level**: `info` / `debug`
- **GPU threads** (future): number of GPU threads for llama.cpp on Windows
- **[Open log file]** button
- **[Uninstall environment]** — removes the venv (keeps settings)

---

## Python Sidecar

### File layout

```
scripts/
  local_sidecar/
    server.py          ← entry point, FastAPI HTTP + WebSocket server
    llm.py             ← LLM engine (mlx-lm wrapper)
    asr.py             ← ASR engine (mlx-whisper wrapper)
    tts.py             ← TTS engine (kokoro-mlx wrapper)
    setup.py           ← environment setup script (called by Tauri)
    capabilities.py    ← probes installed packages, returns JSON
    utils.py           ← shared helpers
```

### Server startup

```bash
python3 server.py --port 49152 --llm-model mlx-community/gemma-3-4b-it-qat-4bit \
                  --asr-model mlx-community/whisper-large-v3-turbo \
                  --tts-engine kokoro --log-level info
```

The server emits a JSON startup event to stdout when ready:
```json
{"type": "ready", "port": 49152, "capabilities": ["translate", "chat", "tts", "transcribe"]}
```

Tauri reads this line, stores the port, and marks the sidecar as `running`.

### API Reference

#### `GET /v1/health`
```json
{"status": "ok", "uptime_s": 42}
```

#### `GET /v1/capabilities`
```json
{
  "llm": {"available": true, "model": "gemma-3-4b-it-qat-4bit", "loaded": true},
  "asr": {"available": true, "model": "whisper-large-v3-turbo", "loaded": false},
  "tts": {"available": true, "engine": "kokoro", "loaded": false}
}
```

#### `POST /v1/translate`
Request:
```json
{
  "text": "Hello world",
  "from": "en",
  "to": "vi",
  "context": "optional domain context",
  "stream": false
}
```
Response (non-streaming):
```json
{"translated": "Xin chào thế giới"}
```
Response (streaming, `"stream": true`): `text/event-stream` SSE with `data: {"delta": "..."}` chunks.

#### `POST /v1/chat`
OpenAI-compatible chat completions format:
```json
{
  "model": "local",
  "messages": [{"role": "user", "content": "Summarize: ..."}],
  "stream": false,
  "temperature": 0.3,
  "max_tokens": 512
}
```
Response: OpenAI-compatible JSON (`choices[0].message.content`).  
This makes the sidecar drop-in compatible with services already using the OpenAI adapter pattern (e.g., `openai_compat_ai`).

#### `POST /v1/tts`
Request:
```json
{
  "text": "Xin chào",
  "voice": "af_heart",
  "speed": 1.0,
  "format": "wav"
}
```
Response: `audio/wav` binary body.

#### `WS /v1/transcribe`
Initial config message (JSON, client → server):
```json
{
  "model": "whisper-large-v3-turbo",
  "language": "auto",
  "chunk_seconds": 7,
  "stride_seconds": 5
}
```
After sending config, client streams raw PCM bytes (s16le, 16 kHz, mono).

Server sends JSON events (server → client):
```json
{"type": "transcript", "text": "...", "is_final": false}   // provisional
{"type": "transcript", "text": "...", "is_final": true}    // confirmed segment
{"type": "status",     "message": "Loading Whisper..."}
{"type": "ready"}
{"type": "error",      "message": "..."}
```

---

## Service Adapters

Each Transkit service layer gets a `local_sidecar` adapter that connects to the sidecar's localhost API.

### Translate — `local_sidecar_translate`

`src/services/translate/local_sidecar/`

```
index.jsx
info.ts     { name: 'local_sidecar_translate' }
Config.jsx  (shows sidecar status, no API key needed)
```

`translate(text, from, to, options)`:
- Calls `POST http://localhost:{port}/v1/translate`
- Reads port from Tauri store key `local_sidecar_port`
- Falls back to error if sidecar is not running
- Supports `stream: true` for SSE streaming result

### AI — `local_sidecar_ai`

`src/services/ai/local_sidecar_ai/`

```
index.jsx
info.ts     { name: 'local_sidecar_ai' }
Config.jsx
```

`summarize(text, options)`:
- Calls `POST http://localhost:{port}/v1/chat` with OpenAI-compatible body
- Re-uses existing `callOpenAIChat` base helper with `requestPath` pointed to sidecar

### TTS — `local_sidecar_tts`

`src/services/tts/local_sidecar_tts/`

```
index.jsx
info.ts     { name: 'local_sidecar_tts' }
Config.jsx
```

`tts(text, lang, options)`:
- Calls `POST http://localhost:{port}/v1/tts`
- Returns binary WAV data (same contract as `openai_tts`)

### STT — `local_sidecar_stt`

`src/services/transcription/local_sidecar_stt/`

```
client.js   LocalSidecarSTTClient
info.ts     { name: 'local_sidecar_stt' }
Config.jsx
index.jsx
```

`LocalSidecarSTTClient` implements the same interface as all other STT clients:
- `connect(config)` — opens WebSocket to `ws://localhost:{port}/v1/transcribe`, sends config frame
- `sendAudio(pcmData)` — writes PCM bytes to the WebSocket
- `disconnect()` — closes WebSocket
- Callbacks: `onOriginal`, `onProvisional`, `onStatusChange`, `onError`, `onReconnect`

The existing Monitor window, Voice Anywhere, and Narration features need **zero changes** — they already accept any STT client.

---

## Rust Backend (`src-tauri/src/local_sidecar.rs`)

### State

```rust
pub struct LocalSidecarState {
    pub process: Mutex<Option<Child>>,
    pub port:    Mutex<u16>,
}
```

### Commands

| Command | Description |
|---|---|
| `local_sidecar_start(config)` | Spawn sidecar process, wait for `ready` event, store port |
| `local_sidecar_stop()` | Send SIGTERM, wait, kill if needed |
| `local_sidecar_status()` | Returns `{running: bool, port: u16, pid: u32}` |
| `local_sidecar_check_setup()` | Returns `{ready: bool, python: String, version: String}` |
| `local_sidecar_run_setup(channel)` | Runs `setup.py`, streams JSON progress via `Channel<String>` |

### Port selection

Tauri picks an available port in the range `49152–65535` at startup using a simple TCP bind-and-release probe. The selected port is stored in the Tauri store under `local_sidecar_port` so the frontend can read it without an extra IPC call.

### Process lifecycle

1. **App launch**: if `local_sidecar_autostart` is `true`, `local_sidecar_start` is called from `setup()`.
2. **Stdout reader thread**: reads JSON lines, looks for `{"type": "ready"}`, sets the `port` in state, emits a Tauri event `local-sidecar://ready` to the frontend.
3. **Stderr**: piped to Tauri log (`log::info!`).
4. **App exit**: sidecar is killed in the `RunEvent::Exit` handler.

### Script paths

```rust
let candidates = vec![
    // development
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/local_sidecar/server.py"),
    // production bundle
    current_exe()?.parent()?.join("../Resources/scripts/local_sidecar/server.py"),
];
```

---

## Setup Script (`scripts/local_sidecar/setup.py`)

Creates a virtual environment at:
```
~/Library/Application Support/com.transkit.desktop/sidecar-env/
```

Installs:
```
mlx-lm          # LLM inference (Apple Silicon)
mlx-whisper     # ASR (Apple Silicon)
kokoro-mlx      # TTS (Apple Silicon)
numpy
fastapi
uvicorn[standard]
websockets
```

Progress events (JSON to stdout):
```json
{"type": "progress", "step": "venv",     "message": "Creating Python environment...", "percent": 5}
{"type": "progress", "step": "packages", "message": "Installing mlx-lm...",            "percent": 30}
{"type": "progress", "step": "packages", "message": "Installing mlx-whisper...",       "percent": 55}
{"type": "progress", "step": "packages", "message": "Installing kokoro-mlx...",        "percent": 75}
{"type": "progress", "step": "verify",   "message": "Verifying installation...",       "percent": 95}
{"type": "done",     "ready": true,      "python": "/path/to/python3"}
```

Marker file: `sidecar-env/.setup_complete` (JSON with version + installed packages list). Bumping the version triggers re-installation on next launch.

---

## Model Catalogue

### LLM (Translate · AI)

| Display name | HuggingFace repo | VRAM (approx) | Notes |
|---|---|---|---|
| Gemma 4B (recommended) | `mlx-community/gemma-3-4b-it-qat-4bit` | ~3 GB | Best quality/speed on M-series |
| Gemma 12B | `mlx-community/gemma-3-12b-it-4bit` | ~7 GB | M2 Pro+ |
| Gemma 27B | `mlx-community/gemma-3-27b-it-4bit` | ~15 GB | M2 Max/Ultra |
| Qwen2.5 3B | `mlx-community/Qwen2.5-3B-Instruct-4bit` | ~2 GB | Lightweight option |
| Qwen2.5 7B | `mlx-community/Qwen2.5-7B-Instruct-4bit` | ~4 GB | — |
| Llama 3.2 3B | `mlx-community/Llama-3.2-3B-Instruct-4bit` | ~2 GB | — |
| Custom | user-provided HF repo | — | Power users |

> **Gemma 4** models are queued for addition once the MLX community publishes quantized weights. The settings UI lists them as `Available soon` until then.

### ASR (STT)

| Display name | HuggingFace repo | Size | Speed |
|---|---|---|---|
| Whisper Tiny | `mlx-community/whisper-tiny` | 39 MB | Very fast |
| Whisper Base | `mlx-community/whisper-base` | 74 MB | Fast |
| Whisper Small | `mlx-community/whisper-small` | 244 MB | Balanced |
| Whisper Large-v3-turbo | `mlx-community/whisper-large-v3-turbo` | 809 MB | Best accuracy |

### TTS

| Display name | Engine | Voices |
|---|---|---|
| Kokoro | `kokoro-mlx` | af_heart, af_bella, am_adam, bf_emma, and others |

---

## Platform Strategy

| Platform | LLM | ASR | TTS | Status |
|---|---|---|---|---|
| macOS Apple Silicon | mlx-lm | mlx-whisper | kokoro-mlx | **v3.x target** |
| macOS Intel | llama.cpp (future) | whisper.cpp (future) | piper (future) | v4.x |
| Windows | llama.cpp (future) | whisper.cpp (future) | piper (future) | v4.x |
| Linux | llama.cpp (future) | whisper.cpp (future) | piper (future) | v4.x |

The Settings page detects `os.platform()` and shows a `Not supported on this platform yet` badge for non-Apple-Silicon targets rather than hiding the feature entirely. This keeps user expectations clear and the UX path consistent for when support ships.

---

## Implementation Phases

### Phase 1 — Rust backbone + setup flow
- `src-tauri/src/local_sidecar.rs` — state, 5 commands
- `scripts/local_sidecar/setup.py` — venv creation + package install
- Settings page stub: **Local Sidecar** section (setup wizard only)
- Tauri store keys: `local_sidecar_enabled`, `local_sidecar_port`, `local_sidecar_autostart`, `local_sidecar_llm_model`, `local_sidecar_asr_model`, `local_sidecar_tts_engine`

### Phase 2 — Sidecar server (LLM only)
- `scripts/local_sidecar/server.py` — FastAPI server skeleton
- `scripts/local_sidecar/llm.py` — mlx-lm wrapper, `/v1/translate` + `/v1/chat`
- Settings page: full LLM section (model picker, temperature, context tokens)
- Service adapter: `local_sidecar_translate`
- Service adapter: `local_sidecar_ai`

### Phase 3 — ASR (STT)
- `scripts/local_sidecar/asr.py` — mlx-whisper wrapper, `WS /v1/transcribe`
- Service adapter: `local_sidecar_stt`
- Settings page: STT section (model, chunk size)

### Phase 4 — TTS
- `scripts/local_sidecar/tts.py` — kokoro-mlx wrapper, `/v1/tts`
- Service adapter: `local_sidecar_tts`
- Settings page: TTS section (engine, voice, speed)
- `/v1/tts/voices` endpoint + voice picker in Config.jsx

### Phase 5 — Polish
- `GET /v1/capabilities` — dynamic capability detection (graceful degradation if a package is missing)
- Auto-restart sidecar on crash
- Model pre-download progress UI (downloading model weights on first use)
- Windows/Intel placeholder UI in settings

---

## i18n Keys

```json
"config.local_sidecar.title": "Local Sidecar",
"config.local_sidecar.subtitle": "Run AI models locally, no internet required",
"config.local_sidecar.setup.not_installed": "Not installed",
"config.local_sidecar.setup.install_button": "Install Local Environment",
"config.local_sidecar.setup.installing": "Installing...",
"config.local_sidecar.setup.ready": "Environment ready",
"config.local_sidecar.setup.requirements": "Requires macOS Apple Silicon · ~3 GB disk · Python 3.10+",
"config.local_sidecar.startup.enable": "Enable Local Sidecar",
"config.local_sidecar.startup.port": "Port",
"config.local_sidecar.startup.status_running": "Running",
"config.local_sidecar.startup.status_stopped": "Stopped",
"config.local_sidecar.llm.section": "Language Model",
"config.local_sidecar.llm.model": "Model",
"config.local_sidecar.llm.temperature": "Temperature",
"config.local_sidecar.llm.context_tokens": "Max context",
"config.local_sidecar.asr.section": "Speech Recognition",
"config.local_sidecar.asr.model": "Whisper model",
"config.local_sidecar.asr.language": "Language",
"config.local_sidecar.asr.chunk_seconds": "Chunk size",
"config.local_sidecar.tts.section": "Text to Speech",
"config.local_sidecar.tts.engine": "Engine",
"config.local_sidecar.tts.voice": "Voice",
"config.local_sidecar.tts.speed": "Speed",
"services.transcription.local_sidecar_stt.title": "Local Sidecar STT",
"services.translate.local_sidecar_translate.title": "Local Sidecar",
"services.ai.local_sidecar_ai.title": "Local Sidecar AI",
"services.tts.local_sidecar_tts.title": "Local Sidecar TTS"
```

---

## Security & Privacy

- The sidecar binds **only to `127.0.0.1`**, never `0.0.0.0`. No external network exposure.
- No telemetry, no usage data. All inference is local.
- Model weights are downloaded directly from HuggingFace by the Python setup script; no Transkit server is involved.
- The Tauri `shell-all` permission (already granted) covers spawning the sidecar subprocess.

---

## Open Questions

1. **Model downloads on first use vs. pre-download during setup?** Current plan: lazy (first use triggers download with a loading UI). Pre-download option available via a Settings button.
2. **Port conflict handling**: if the configured port is busy, auto-increment and update the stored key, then notify the frontend via `local-sidecar://port-changed` event.
3. **Gemma 4 weights**: pending `mlx-community` publish. Catalogue entry shows `Available soon` until confirmed.
4. **Multi-instance safety**: only one sidecar process is allowed. `local_sidecar_start` is a no-op if already running (checked via `LocalSidecarState`).
