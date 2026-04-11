# ONNX Offline Engine — Design Document

**Status:** Draft  
**Target:** Transkit Desktop v3.x / v4.x  
**Scope:** Offline STT (Phase 1), Offline LLM + TTS (Phase 2)

---

## Overview

The existing Local Sidecar runs on Python + MLX, which is ideal for macOS Apple Silicon but requires Python installation and is impractical on Windows. This document describes a second offline inference backend — the **ONNX Engine** — embedded directly in the Tauri Rust binary.

Key properties:
- **Zero-dependency install**: no Python, no Visual C++ Redistributables, no extra setup. Works on first launch.
- **Cross-platform**: Windows x64, macOS (both Intel and Apple Silicon), Linux x64.
- **Transparent client**: the frontend service layer calls the same interface regardless of backend engine.
- **Auto-routing**: platform auto-selects the best engine; user can override in Settings.

---

## Technology Stack

### STT — sherpa-onnx (runtime-downloaded native library)

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (k2-fsa / Next-Gen Kaldi) is the reference framework for production offline ASR. The Rust community binding is [**`sherpa-rs`**](https://github.com/thewh1teagle/sherpa-rs) (`crates.io/crates/sherpa-rs`).

| Property | Details |
|---|---|
| Native library source | `k2-fsa/sherpa-onnx` GitHub Releases + `csukuangfj/sherpa-onnx-libs` HuggingFace |
| Download trigger | First time user enables ONNX Engine in Settings |
| Platforms | Windows x64, macOS arm64/x64, Linux x64/aarch64 |
| Library size | ~10–20 MB total (libsherpa-onnx ~2–4 MB + libonnxruntime ~5–17 MB) |
| **Installer size increase** | **0 MB** — not bundled |
| Model support | Zipformer CTC, Zipformer RNNT (transducer), Paraformer, Conformer |
| Streaming | Full real-time streaming — partial results + final commits |

> **Note on `sherpa-rs` build behavior**: Unlike some Rust crates, `sherpa-rs`'s `build.rs` does NOT auto-download the native library. It expects `libsherpa_onnx` to be linked at build time. This is exactly why we use `libloading` (dynamic loading at runtime) instead of the `sherpa-rs` crate directly — it gives us on-demand download without modifying the build pipeline.

**Why sherpa-onnx over raw `ort` (ONNX Runtime Rust)?**

| | sherpa-onnx | ort crate |
|---|---|---|
| Audio pipeline (VAD, chunking) | Built-in | Manual |
| Streaming ASR logic | Built-in | Manual |
| Zipformer ONNX support | Native | Needs custom graph code |
| Vietnamese model ecosystem | Direct HuggingFace repos | No ready models |
| Pre-built binaries for all platforms | Yes — GitHub Releases | Partial |
| Effort to integrate via libloading | Medium (C API is stable) | Very high |

### Integration strategy — libloading (dynamic load)

Thay vì link `sherpa-rs` vào Tauri binary lúc build time (làm phình installer và yêu cầu native lib khi build), Transkit sử dụng **dynamic loading**:

1. Installer KHÔNG chứa sherpa-onnx native library.
2. Khi user enable ONNX Engine, app tải `libsherpa-onnx-c.{dll/dylib/so}` + `libonnxruntime.{dll/dylib/so}` từ GitHub Releases về `{app_data}/onnx-engine/`.
3. Rust dùng crate `libloading` để load C API symbols tại runtime.
4. Tất cả inference gọi qua các C function pointers đã load.

```toml
# Cargo.toml — thêm vào
libloading = "0.8"  # ~50KB, không kéo theo native library nào
```

Không cần recompile app — `libloading` là Rust code thuần, rất nhỏ.

### LLM (Phase 2) — llama.cpp via `llama-cpp2` crate

GGUF format, supports quantized models (Q4_K_M, Q5_K_M), runs on CPU + GPU (Metal on macOS, CUDA/DirectML on Windows). Approach tương tự: download llama.cpp shared library on-demand, load via libloading.

### TTS (Phase 2) — sherpa-onnx TTS

The same sherpa-onnx native library includes a TTS engine (Piper voices, VITS, KOKORO). No additional download needed for TTS once sherpa-onnx library is installed. Voices are ONNX-format `.onnx` + `.onnx.json` pairs downloadable from HuggingFace separately.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Transkit Frontend                        │
│                                                            │
│  Translate/AI layer ──────────────────────────────────┐   │
│  TTS layer ───────────────────────────────────────────┤   │
│  STT layer (OnnxSTTClient) ───────────────────────────┘   │
│           │                                               │
│           │  Tauri invoke() / listen()  [no WS needed]   │
└───────────┼───────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────┐
│            Tauri Rust Layer — onnx_engine.rs               │
│                                                            │
│  onnx_stt_start(config)    ← begin session                │
│  onnx_stt_feed(audio_b64)  ← feed PCM chunk               │
│  onnx_stt_stop()           ← end session, drain buffer    │
│  onnx_stt_status()         ← engine state + loaded model  │
│  onnx_model_download(repo) ← download model from HF       │
│  onnx_model_list()         ← locally available models     │
│                                                            │
│  Tauri events emitted:                                     │
│  "onnx-stt://transcript"   { text, is_final, language }   │
│  "onnx-stt://status"       { message }                    │
│  "onnx-stt://error"        { message }                    │
│  "onnx-stt://ready"                                       │
│  "onnx-model://progress"   { step, percent, message }     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │    sherpa-onnx C API (libloading, runtime-loaded)     │ │
│  │    libsherpa-onnx-c.{dll/dylib/so}                    │ │
│  │    downloaded to {app_data}/onnx-engine/ on demand    │ │
│  │    OnlineRecognizer — Zipformer RNNT / CTC            │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
            │
            │  also manages
            │
┌───────────▼───────────────────────────────────────────────┐
│         Python Sidecar (existing, MLX)                     │
│         unchanged — macOS Apple Silicon path               │
└────────────────────────────────────────────────────────────┘
```

**Why Tauri invoke/events instead of a WebSocket server in Rust?**

The Python sidecar uses WebSocket because it's an external process. For code running inside the Tauri binary, the native IPC (`invoke` + `emit`) is simpler, lower-latency, and doesn't require managing an extra port. The frontend adapter presents the same interface regardless.

---

## Platform Routing

| Platform | Default STT Engine | Can Switch To | Notes |
|---|---|---|---|
| macOS Apple Silicon (M1+) | MLX (Python sidecar) | ONNX | MLX is faster on Apple GPU |
| macOS Intel (x86_64) | ONNX | — | MLX not supported |
| Windows | ONNX | — | No Python assumption |
| Linux | ONNX | — | No Python assumption |

### Detection logic (Rust)

```rust
fn default_stt_engine() -> SttEngine {
    #[cfg(target_os = "macos")]
    {
        // Check for Apple Silicon at runtime
        if is_apple_silicon() { SttEngine::Mlx } else { SttEngine::Onnx }
    }
    #[cfg(not(target_os = "macos"))]
    { SttEngine::Onnx }
}
```

### Settings UI behavior

- **macOS Apple Silicon**: shows `Engine: MLX (recommended) / ONNX` toggle. Selecting ONNX shows a banner: _"MLX uses Apple Neural Engine and runs 2–3× faster on M-series Macs. Switch to ONNX only if needed."_
- **macOS Intel / Windows / Linux**: shows engine as `ONNX` with no toggle (only one option available).
- Both paths share the same model picker UI.

---

## STT Engine — sherpa-onnx Details

### Model format: Zipformer RNNT (Transducer)

Required files in the HuggingFace repo:

```
encoder-epoch-XX-avg-Y.int8.onnx    ← encoder (int8 quantized, smaller)
decoder-epoch-XX-avg-Y.onnx         ← predictor network
joiner-epoch-XX-avg-Y.int8.onnx     ← joiner network
tokens.txt                           ← vocabulary (one token per line)
```

Optional (used if present):
```
config.json       ← sample_rate, feature_dim, model metadata
README.md         ← model description
```

Example: `hynt/Zipformer-30M-RNNT-6000h` (Vietnamese, 30M params, trained on 6000h)

### Rust integration sketch

```rust
use sherpa_onnx::{
    OnlineRecognizer, OnlineRecognizerConfig,
    OnlineTransducerModelConfig, OnlineCtcFstDecoderConfig,
    FeatureConfig, EndpointConfig,
};

fn build_recognizer(model_dir: &Path, language: Option<&str>) -> OnlineRecognizer {
    let model_dir = model_dir.to_str().unwrap();
    
    OnlineRecognizer::new_from_transducer(OnlineRecognizerConfig {
        model: OnlineTransducerModelConfig {
            encoder: format!("{}/encoder.int8.onnx", model_dir),
            decoder: format!("{}/decoder.onnx", model_dir),
            joiner:  format!("{}/joiner.int8.onnx", model_dir),
            tokens:  format!("{}/tokens.txt", model_dir),
            num_threads: 2,
            ..Default::default()
        },
        feat_config: FeatureConfig {
            sample_rate: 16000,
            feature_dim: 80,
        },
        endpoint_config: EndpointConfig {
            rule1: EndpointRule { min_trailing_silence: 2.4, must_contain_nonsilence: false, min_utterance_length: 0.0 },
            rule2: EndpointRule { min_trailing_silence: 1.2, must_contain_nonsilence: true,  min_utterance_length: 0.0 },
            rule3: EndpointRule { min_trailing_silence: 0.0, must_contain_nonsilence: false, min_utterance_length: 20.0 },
        },
        enable_endpoint: true,
        max_active_paths: 4,
        ..Default::default()
    })
}
```

### Streaming session lifecycle

```
onnx_stt_start({model: "hynt/Zipformer-30M-RNNT-6000h", language: "vi"})
  → loads model (if not already loaded), creates Stream
  → emits "onnx-stt://ready"

onnx_stt_feed({audio: "<base64 PCM s16le 16kHz mono>"})
  → decodes b64, converts s16 → f32, feeds stream.accept_waveform()
  → recognizer.decode()
  → if recognizer.is_endpoint() → emit final transcript, reset stream
  → else → emit provisional transcript (debounced every 400ms)

onnx_stt_stop()
  → drain remaining audio → emit final transcript
  → keep model in memory for next session (LRU cache, 1 model)
```

### VAD and commit strategy

sherpa-onnx's built-in endpoint detection (`enable_endpoint: true`) fires when:
- `rule1`: 2.4s silence (utterance may be empty — catches long pauses)
- `rule2`: 1.2s silence after non-silence (normal sentence end)
- `rule3`: utterance reaches 20s regardless

This mirrors the two-tier commit strategy in the existing `asr.py`.

---

## Model Management

### Storage location

```
# macOS
~/Library/Application Support/com.transkit.desktop/onnx-models/
  └── hynt__Zipformer-30M-RNNT-6000h/
        encoder.int8.onnx
        decoder.onnx
        joiner.int8.onnx
        tokens.txt
        .manifest.json    ← { repo, downloaded_at, file_hashes }

# Windows
%APPDATA%\com.transkit.desktop\onnx-models\

# Linux
~/.local/share/com.transkit.desktop/onnx-models/
```

Folder name = HuggingFace repo slug with `/` → `__`.

### Download flow (Tauri command)

```rust
#[tauri::command]
async fn onnx_model_download(
    repo: String,       // e.g. "hynt/Zipformer-30M-RNNT-6000h"
    window: Window,
) -> Result<(), String> {
    // 1. Query HF API: GET https://huggingface.co/api/models/{repo}
    //    → parse siblings[] to find .onnx and tokens.txt files
    // 2. For each required file, GET https://huggingface.co/{repo}/resolve/main/{file}
    //    → stream to disk, emit "onnx-model://progress" per file
    // 3. Write .manifest.json when all files downloaded
}
```

Progress events:
```json
{"step": "fetch_manifest", "percent": 5,  "message": "Fetching model info..."}
{"step": "download",       "percent": 20, "message": "Downloading encoder.int8.onnx (45 MB)..."}
{"step": "download",       "percent": 60, "message": "Downloading decoder.onnx (2 MB)..."}
{"step": "download",       "percent": 80, "message": "Downloading joiner.int8.onnx (3 MB)..."}
{"step": "done",           "percent": 100,"message": "Model ready"}
```

### File auto-detection

Because different repos name their files differently (e.g. `encoder-epoch-99-avg-1.int8.onnx` vs `encoder.int8.onnx`), the loader scans the model directory:

```rust
fn find_model_files(dir: &Path) -> ModelFiles {
    ModelFiles {
        encoder: glob_first(dir, "*encoder*.int8.onnx")
                   .or(glob_first(dir, "*encoder*.onnx")),
        decoder: glob_first(dir, "*decoder*.onnx"),
        joiner:  glob_first(dir, "*joiner*.int8.onnx")
                   .or(glob_first(dir, "*joiner*.onnx")),
        tokens:  dir.join("tokens.txt"),
    }
}
```

---

## Size Impact

### Installer (no change)

| Component | Added to installer | Notes |
|---|---|---|
| `libloading` Rust crate | ~50 KB | Pure Rust, no native deps |
| Rust glue code (onnx_engine.rs) | ~100 KB compiled | Thin dynamic-dispatch wrappers |
| **Installer size increase** | **~0 MB** | Native library is NOT bundled |

### After user enables ONNX Engine (one-time download)

| Component | Download size | Stored at |
|---|---|---|
| `libsherpa-onnx-c` (CPU, platform native) | ~15–20 MB compressed | `{app_data}/onnx-engine/` |
| ONNX Runtime (bundled inside above) | included | — |
| **STT model** (e.g. Zipformer 30M VI) | ~60 MB | `{app_data}/onnx-models/` |

Users who never enable ONNX mode: **zero impact** on installer or disk.

### ONNX Engine Setup wizard

A one-time flow, shown when the user first toggles ONNX Engine on:

```
┌─────────────────────────────────────────────────────┐
│  ONNX Engine Setup                                  │
│                                                     │
│  Downloading inference engine...                    │
│  ████████████████░░░░░░  68%  sherpa-onnx (~20MB)   │
│                                                     │
│  This is a one-time download. The engine is stored  │
│  locally and works fully offline after this.        │
│                                              [Cancel]│
└─────────────────────────────────────────────────────┘
```

New Tauri command: `onnx_engine_install(window)` — downloads the correct platform binary from `github.com/k2-fsa/sherpa-onnx/releases`, verifies SHA256 checksum, extracts to `{app_data}/onnx-engine/`.

---

## Settings Page Changes

### New section: ONNX Engine (in Settings → Local Sidecar)

Appears below the existing MLX section. On platforms where ONNX is not the default, it's collapsed under "Advanced".

#### Model picker
- Text input: `HuggingFace repo` (e.g. `hynt/Zipformer-30M-RNNT-6000h`)
- [Download] button → triggers `onnx_model_download`, shows progress bar
- Downloaded models list with [Delete] option
- Active model selector (dropdown of downloaded models)

#### Engine selector (macOS Apple Silicon only)
```
STT Engine:  ● MLX (recommended)  ○ ONNX
             ↑ Uses Apple Neural Engine for best performance
```

#### Status indicator
- `ONNX Engine: Ready — hynt/Zipformer-30M-RNNT-6000h`
- `ONNX Engine: No model — download a model above`
- `ONNX Engine: Loading model…`

---

## Frontend Service Adapter

New file: `src/services/transcription/onnx_stt/`

```
client.js    OnnxSTTClient
info.ts      { name: 'onnx_stt' }
Config.jsx   (shows model status, download UI)
index.jsx
```

`OnnxSTTClient` implements the same interface as `LocalSidecarSTTClient`:

```js
class OnnxSTTClient {
  connect(config) {
    // invoke('onnx_stt_start', { model, language, task })
    // listen('onnx-stt://transcript') → onOriginal / onProvisional
    // listen('onnx-stt://status')     → onStatusChange
    // listen('onnx-stt://error')      → onError
    // listen('onnx-stt://ready')      → resolve
  }

  sendAudio(pcmBuffer) {
    // invoke('onnx_stt_feed', { audio: base64(pcmBuffer) })
  }

  disconnect() {
    // invoke('onnx_stt_stop')
    // unlisten all events
  }
}
```

**Zero changes needed** in Monitor window, Voice Anywhere, or Narration — they accept any STT client.

### Auto-routing (optional, Phase 2)

A thin `offline_stt` adapter can automatically pick the right client:

```js
// src/services/transcription/offline_stt/client.js
import { platform } from '@tauri-apps/api/os';

async function createOfflineClient() {
  const os = await platform();
  const enginePref = await getStore('offline_stt_engine'); // 'auto' | 'mlx' | 'onnx'

  if (enginePref === 'mlx' || (enginePref === 'auto' && os === 'darwin' && isAppleSilicon())) {
    return new LocalSidecarSTTClient();
  }
  return new OnnxSTTClient();
}
```

This makes the service layer 100% transparent — one service called `offline_stt`, backend decides engine.

---

## Phase 2 — LLM + TTS via ONNX

Once STT is stable, the same infrastructure extends to LLM and TTS.

### LLM — llama.cpp (`llama-cpp2` Rust crate)

- **Format**: GGUF (quantized, e.g. Q4_K_M)
- **Model source**: HuggingFace repos like `bartowski/Llama-3.2-3B-Instruct-GGUF`
- **API**: exposes same `/v1/translate` and `/v1/chat` logic but via Tauri invoke
- **Tauri commands**: `llama_translate`, `llama_chat_stream`
- **Why llama.cpp over ONNX GenAI**: more model support, better quantization, mature ecosystem

### TTS — sherpa-onnx TTS (same crate)

- **Format**: VITS `.onnx` + `.onnx.json` pairs (Piper voices)
- **Model source**: HuggingFace, e.g. `rhasspy/piper-voices`
- **Vietnamese TTS**: `vi_VN-vivos-x_low` (Piper voice pack)
- **API**: `onnx_tts_synthesize({ text, voice })` → returns WAV bytes via Tauri

### Service coverage comparison

| Service | macOS Apple Silicon | macOS Intel | Windows | Linux |
|---|---|---|---|---|
| STT | MLX (default) / ONNX | ONNX | ONNX | ONNX |
| LLM/Translate | MLX (default) / llama.cpp | llama.cpp | llama.cpp | llama.cpp |
| TTS | kokoro-mlx (default) / ONNX | ONNX | ONNX | ONNX |

---

## Implementation Phases

### Phase 1 — ONNX STT (current target)

1. **`src-tauri/src/onnx_engine.rs`** — Rust module
   - `OnnxEngineState`: tracks library load status + active recognizer
   - `SherpaBindings`: C function pointers loaded at runtime via `libloading`
   - Tauri commands: `onnx_engine_install`, `onnx_engine_status`
   - Tauri commands: `onnx_stt_start`, `onnx_stt_feed`, `onnx_stt_stop`, `onnx_stt_status`
   - Tauri commands: `onnx_model_download`, `onnx_model_list`
   - Audio worker thread: feeds PCM → C API → emits Tauri events

2. **`src-tauri/Cargo.toml`** — add `libloading = "0.8"` only (no native deps)

3. **`src/services/transcription/onnx_stt/`** — frontend adapter

4. **Settings UI** — ONNX Engine setup wizard + model picker in Local Sidecar page

5. **`docs/onnx-offline-engine.md`** (this document)

### Phase 2 — ONNX LLM + TTS

6. **`src-tauri/src/llama_engine.rs`** — llama.cpp LLM
7. **`src-tauri/src/onnx_tts.rs`** — sherpa-onnx TTS
8. **Service adapters**: `onnx_translate`, `onnx_ai`, `onnx_tts`
9. **`offline_stt` unified adapter** — auto-routes MLX vs ONNX

---

## Model Catalogue — STT (Vietnamese focus)

| Display name | HuggingFace repo | Size | Language | Notes |
|---|---|---|---|---|
| Zipformer 30M Vietnamese | `hynt/Zipformer-30M-RNNT-6000h` | ~60 MB | VI | Recommended for Vietnamese |
| Whisper Tiny (ONNX) | `onnx-community/whisper-tiny` | ~45 MB | Multilingual | Fast, lower accuracy |
| Whisper Large-v3 (ONNX) | `onnx-community/whisper-large-v3` | ~1.5 GB | Multilingual | High accuracy |
| (custom) | user-entered HF repo | — | Any | Power user option |

> **Note:** For Vietnamese, the Zipformer model significantly outperforms Whisper on Vietnamese speech due to training on 6000h VI data.

---

## Security & Privacy

- All model inference is **local-only** — no audio ever leaves the device.
- Model downloads go directly from HuggingFace to local disk via HTTPS; no Transkit server intermediary.
- The sherpa-onnx native library binds **no network ports** — it's a pure in-process library.
- Audio data passed to `onnx_stt_feed` is never written to disk; processed in-memory only.

---

## Open Questions

1. **libloading C API coverage**: The sherpa-onnx C API (`SherpaOnnxCreateOnlineRecognizer`, etc.) covers all the functionality needed for streaming RNNT. Verify that the exact function signatures in the latest GitHub Release match what the Rust wrapper expects — the C API is stable but patch versions may add parameters.

2. **Model file naming variance**: Different HuggingFace repos name their ONNX files differently. The auto-detection glob approach covers most cases; a `model_config.json` override per repo would handle edge cases.

3. **GPU acceleration on Windows**: sherpa-onnx supports DirectML (Windows GPU) and CUDA. Phase 1 uses CPU only. GPU acceleration can be enabled in a later phase via build feature flags.

4. **Concurrent sessions**: Phase 1 supports one active STT session at a time (consistent with existing sidecar behavior). Multi-session support (e.g., two windows simultaneously) is deferred.
