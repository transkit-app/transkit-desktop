# External Integrations

**Analysis Date:** 2026-03-18

## APIs & External Services

**Transcription (Real-time Speech-to-Text):**
- Soniox STT - Real-time audio transcription with WebSocket
  - Client: `src/services/transcription/soniox_stt/client.js`
  - Endpoint: `wss://stt-rt.soniox.com/transcribe-websocket`
  - Auth: API key (configured in settings)
  - Features: Speaker diarization, translation context, seamless session reset (3-minute intervals)

- OpenAI Whisper STT - Batch transcription API
  - Client: `src/services/transcription/openai_whisper_stt/client.js`
  - Endpoint: `https://api.openai.com/v1/audio/transcriptions` (or custom `serverUrl`)
  - Auth: Bearer token (API key)
  - Implementation: Chunks audio every 5000ms (configurable)

- AssemblyAI STT
  - Client: `src/services/transcription/assemblyai_stt/client.js`
  - Auth: API key (configured in settings)

**Translation Services:**
- Google Translate
  - Service: `src/services/translate/google/info.ts`
  - Supports 30+ languages with auto-detection

- OpenAI Chat Completions
  - Client: `src/services/ai/_base.js` → `callOpenAIChat()`
  - Endpoint: `https://api.openai.com/v1/chat/completions` (or configurable `requestPath`)
  - Auth: Bearer token (API key)
  - Model: `gpt-4o-mini` (default, configurable)
  - Default prompt: Translation synthesis assistant

- Groq AI
  - Service: `src/services/translate/groq/`

- Gemini Pro
  - Service: `src/services/translate/geminipro/`

- OpenRouter
  - Service: `src/services/translate/openrouter/`

- Baidu Translate
  - Service: `src/services/translate/baidu/`

- Alibaba Translate
  - Service: `src/services/translate/alibaba/`

- Tencent Translate
  - Service: `src/services/translate/tencent/`

- Volcengine Translate
  - Service: `src/services/translate/volcengine/`

- Caiyun Translate
  - Service: `src/services/translate/caiyun/`

- Niutrans
  - Service: `src/services/translate/niutrans/`

- DeepL Translate
  - Service: `src/services/translate/deepl/`

- Bing Translate
  - Service: `src/services/translate/bing/`

- Yandex Translate
  - Service: `src/services/translate/yandex/`

- Youdao Translate
  - Service: `src/services/translate/youdao/`

- Lingva (Privacy-focused Google Translate proxy)
  - Service: `src/services/translate/lingva/`

- ChatGLM
  - Service: `src/services/translate/chatglm/`

- Transmart
  - Service: `src/services/translate/transmart/`

**OCR (Optical Character Recognition):**
- Tesseract OCR (Local)
  - Library: `tesseract.js` v5.1.1
  - Service: `src/services/recognize/tesseract/`

- System OCR (Platform-native)
  - macOS: Built-in accessibility APIs
  - Windows: Media.Ocr API
  - Implementation: `src-tauri/src/system_ocr.rs`
  - Service: `src/services/recognize/system/`

- Baidu OCR
  - Services: `src/services/recognize/baidu/`, `baidu_accurate/`, `baidu_img/`

- Tencent OCR
  - Services: `src/services/recognize/tencent/`, `tencent_accurate/`, `tencent_img/`

- IFlytek OCR
  - Services: `src/services/recognize/iflytek/`, `iflytek_intsig/`, `iflytek_latex/`

- Volcengine OCR
  - Services: `src/services/recognize/volcengine/`, `volcengine_multi_lang/`

- QR Code Recognition
  - Library: `jsqr` v1.4.0
  - Service: `src/services/recognize/qrcode/`

- LaTeX OCR
  - Services: `src/services/recognize/simple_latex/`

**Text-to-Speech (TTS):**
- OpenAI TTS
  - Service: `src/services/tts/openai_tts/`
  - Endpoint: `https://api.openai.com/v1/audio/speech`
  - Auth: Bearer token (API key)

- ElevenLabs TTS
  - Service: `src/services/tts/elevenlabs_tts/`
  - Auth: API key
  - Integration: `src/window/Monitor/elevenlabs-tts.js`

- Google TTS
  - Service: `src/services/tts/google_tts/`

- Edge TTS (Microsoft)
  - Library: `edge-tts-universal` v1.4.0
  - Service: `src/services/tts/edge_tts/`
  - Backend integration: `src-tauri/src/edge_tts.rs`

- Lingva TTS (Privacy-focused)
  - Service: `src/services/tts/lingva/`

- Vieneu TTS
  - Service: `src/services/tts/vieneu_tts/`

**AI Services:**
- Ollama (Local LLM)
  - Library: `ollama` v0.5.9
  - Service: `src/services/ai/ollama_ai/`
  - Purpose: Local AI model inference

- Groq AI
  - Service: `src/services/ai/groq_ai/`

- Gemini AI
  - Service: `src/services/ai/gemini_ai/`

- OpenAI Compatible
  - Service: `src/services/ai/openai_compat_ai/`

- OpenAI AI
  - Service: `src/services/ai/openai_ai/`

**Dictionary & Reference:**
- ECDICT (Chinese dictionary)
  - Service: `src/services/translate/ecdict/`

- Bing Dictionary
  - Service: `src/services/translate/bing_dict/`

- Cambridge Dictionary
  - Service: `src/services/translate/cambridge_dict/`

**Collection/Learning:**
- Anki (Flashcard system)
  - Service: `src/services/collection/anki/`

- Eudic (Dictionary app)
  - Service: `src/services/collection/eudic/`

## Data Storage

**Configuration:**
- Persistent store: `tauri-plugin-store-api` (v1)
- Location: `~/.config/com.transkit.desktop/config.json`
- Access: `src/utils/store.js` exports `store` singleton with `load()` method
- File watching: `tauri-plugin-fs-watch-api` watches config changes and reloads

**Database:**
- SQLite via `tauri-plugin-sql-api` (v1 with SQLite feature)
- Usage: Not extensively documented in explored files, but initialized in `src-tauri/src/main.rs`

**Local Files:**
- Screenshots: `src-tauri/src/screenshot.rs`
- Clipboard history: `src-tauri/src/clipboard.rs`
- Scoped filesystem access:
  - `$APPCONFIG/**` - Application configuration
  - `$APPCACHE/**` - Temporary cache
  - `$DOCUMENT/**` - User documents

## Authentication & Identity

**Auth Pattern:**
- API Key-based authentication (no OAuth/SSO)
- Keys stored in configuration JSON (user responsibility for security)
- No centralized identity provider

**API Key Environments:**
- Each service stores API key in settings/configuration
- Passed to client instances at runtime
- Bearer token format for OpenAI-compatible APIs
- Custom auth headers for service-specific APIs

## Monitoring & Observability

**Logging:**
- Framework: `tauri-plugin-log-api` (v1)
- Log targets: LogDir + Stdout
- Rust side: `log` crate (v0.4) with `info!()`, `warn!()`, `error!()` macros
- Console logging in JavaScript clients

**Error Tracking:**
- Service-specific error handlers in each client (e.g., Soniox error codes 4001, 4002, 4003, 4029, 408)
- Custom error messages propagated to UI via callbacks
- No centralized error tracking service detected

## CI/CD & Deployment

**Hosting:**
- GitHub (source and release distribution)
- Custom update endpoint: `https://transkit.app/transkit-desktop/updater/update.json`

**Auto-Update:**
- Active updater with signature verification
- Dialog disabled (silent updates)
- Falls back to GitHub releases if primary endpoint unavailable

**Build Targets:**
- macOS (Safari 11+ support)
- Windows (Chrome 105+ support)
- Linux (deb + rpm packages)

## Webhooks & Callbacks

**Outgoing Webhooks:**
- None detected

**Incoming Callbacks:**
- Local HTTP server on `127.0.0.1:{port}` (default 60828)
- Endpoints: `src-tauri/src/server.rs`
  - `GET /` - Translate
  - `GET /config` - Open config window
  - `GET /translate` - Translate text
  - `GET /selection_translate` - Translate selection
  - `GET /input_translate` - Translate input
  - `GET /ocr_recognize` - Recognize via OCR (optional screenshot)
  - `GET /ocr_translate` - OCR and translate (optional screenshot)
- Implementation: `tiny_http` crate for HTTP handling

## Network & WebSocket

**WebSocket Connections:**
- Soniox: `wss://stt-rt.soniox.com/transcribe-websocket` (TLS required)
- Configuration in `src-tauri/src/edge_tts.rs`, `src/services/transcription/soniox_stt/client.js`
- Tokio-tungstenite for Rust WebSocket support

**HTTP Configuration:**
- Tauri allowlist enables:
  - `http.all` - All HTTP requests
  - `http.request` - Request method
  - Scope: `http://**` and `https://**` (all domains)
- User agents: Configurable per service
- Timeouts: Service-specific (e.g., OpenAI: 30 seconds)

## Environment Configuration

**Required env vars:**
- Service API keys (not environment variables, but configuration settings):
  - Soniox API key
  - OpenAI API key
  - AssemblyAI API key
  - ElevenLabs API key
  - Individual translation service keys

**Secrets location:**
- Configuration JSON file (`~/.config/com.transkit.desktop/config.json`)
- User is responsible for protecting this file

**Vite Environment:**
- Prefix: `VITE_`, `TAURI_`
- Production detection: `import.meta.env.PROD`
- Build optimization: Source maps in debug, esbuild minification in production

---

*Integration audit: 2026-03-18*
