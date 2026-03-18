# Architecture

**Analysis Date:** 2026-03-18

## Pattern Overview

**Overall:** Multi-window Tauri desktop application using modular service architecture

**Key Characteristics:**
- Multi-window desktop app (Config, Monitor, Recognize, Screenshot, Translate, Updater)
- Pluggable service framework with built-in and plugin-based providers
- React frontend with NextUI components and Jotai state management
- Rust backend exposing Tauri commands for OS interactions
- Event-driven communication between frontend and backend
- Persistent configuration via Tauri Store plugin

## Layers

**Presentation Layer:**
- Purpose: React components rendering user interfaces across multiple windows
- Location: `src/window/*/` (window modules) and `src/components/` (shared components)
- Contains: Window root components (Monitor, Translate, Recognize, Config, Screenshot), page components, subcomponents
- Depends on: State management (Jotai atoms), hooks, services data
- Used by: End users via Tauri windows

**State Management Layer:**
- Purpose: Centralized state using Jotai atoms for cross-component communication
- Location: `src/window/*/` (atoms exported from index files), `src/hooks/`
- Contains: `atom()` declarations for reactive state (e.g., `pluginListAtom`, `textAtom`, `windowTypeAtom`)
- Depends on: React, Jotai library
- Used by: React components via `useAtom()` hooks

**Configuration & Data Persistence:**
- Purpose: Synchronize React state with disk storage
- Location: `src/utils/store.js`, `src/hooks/useConfig.jsx`
- Contains: Tauri Store wrapper, useConfig hook for reactive config syncing
- Depends on: Tauri Store plugin, event system
- Used by: All window modules accessing persistent settings

**Service Layer:**
- Purpose: Modular service implementations for translation, recognition, transcription, TTS, etc.
- Location: `src/services/{type}/{provider}/` (organize by feature type and provider name)
- Contains: Provider-specific clients, config components, metadata (info.ts)
- Depends on: External APIs, Tauri invoke commands
- Used by: Window components for performing translations, recognitions, etc.

**Tauri Bridge Layer:**
- Purpose: IPC between React frontend and Rust backend
- Location: `src/utils/invoke_plugin.js`, inline `invoke()` calls throughout components
- Contains: Tauri command invocations (screenshot, OCR, audio capture, hotkeys, etc.)
- Depends on: Tauri API (@tauri-apps/api)
- Used by: Components needing OS-level access

**Backend/Rust Layer:**
- Purpose: OS-level functionality and system integrations
- Location: `src-tauri/src/` (Rust modules)
- Contains: Audio capture, system OCR, hotkey registration, tray management, window control, TTS synthesis
- Depends on: OS libraries, external APIs
- Used by: Frontend via Tauri invoke commands

## Data Flow

**Translation Window Flow:**

1. User selects text or opens translation popup
2. Frontend component (`src/window/Translate/index.jsx`) receives text via drag-drop or selection
3. Component loads service instances from config (`useConfig('translate_service_list')`)
4. User selects target language and presses translate
5. TargetArea calls service.translate() from `src/services/translate/{provider}/`
6. Service makes HTTP request to external API
7. Result rendered and cached
8. Config changes persisted via `useConfig` → Tauri Store → disk

**Transcription/Monitor Window Flow:**

1. User starts audio monitoring (`Monitor` component)
2. Invokes Rust backend: `invoke('start_audio_capture', { source, batchIntervalMs })`
3. Backend captures audio and emits `audio_chunk` events
4. Frontend listens to audio_chunk and sends to transcription service client
5. Service client (WebSocket) sends audio to external API (e.g., Soniox)
6. Callbacks fire: `onOriginal`, `onTranslation`, `onProvisional`
7. Entries appended to MonitorLog, auto-saved to file if enabled
8. TTS queued if enabled

**Configuration Sync Flow:**

1. User modifies config in Config window
2. `useConfig(key, defaultValue)` setter called
3. Setter: debounced → store.set() + store.save() → emits `{key}_changed` event
4. Event listener in other windows receives change
5. All components using `useConfig(key)` re-render with new value
6. Config persisted to `~/.config/transkit/config.json` (via Tauri Store)

**State Management:**

- **Local React State:** UI-only state (open/closed dialogs, hover states)
- **Jotai Atoms:** Shared cross-window/cross-component state (plugin lists, current text selections)
- **useConfig Hook:** Configuration state that persists to disk and syncs across all windows
- **Backend State:** Rust-side state (audio capture session, window handles)

## Key Abstractions

**Window Module:**
- Purpose: Encapsulates a complete window's UI and logic
- Examples: `src/window/Monitor/index.jsx`, `src/window/Translate/index.jsx`, `src/window/Config/index.jsx`
- Pattern: Each window is a top-level React component that sets up its own atoms, hooks, and event listeners. Windows communicate via shared store and Tauri events.

**Service Instance:**
- Purpose: A configured instance of a service provider (translate, recognize, TTS, etc.)
- Examples: `deepl_stt`, `soniox_stt`, `edge_tts`, `google_translate`
- Pattern: Services identified by key stored in config. Config pages map service keys to UI components. `src/services/{type}/index.jsx` exports all providers for a type.

**Service Provider:**
- Purpose: Implementation of a translation/recognition/TTS API
- Examples: `src/services/translate/deepl/`, `src/services/transcription/soniox_stt/`, `src/services/tts/edge_tts/`
- Pattern: Each provider is a directory with `index.jsx` (exports), `Config.jsx` (settings UI), `info.ts` (metadata), and service client files.

**Plugin System:**
- Purpose: Load service implementations as external binaries
- Examples: External translation/OCR plugins managed in `~/.config/transkit/plugins/{type}/{plugin_name}/`
- Pattern: Plugins discovered via filesystem scan, loaded on demand via `invoke_plugin()`. UI distinguishes plugin vs. built-in via `whetherPluginService()` utility.

**useConfig Hook:**
- Purpose: Reactive persistent state for individual config keys
- Pattern: `const [value, setValue, getValue] = useConfig(key, defaultValue, { sync: true })`
  - Syncs state ↔ Tauri Store (on change)
  - Emits events when external windows change config
  - Debounced persist to disk
  - Used everywhere for app settings (themes, language, service configurations, etc.)

**Tauri Command:**
- Purpose: Bridge between React and Rust for OS-level operations
- Examples: `screenshot`, `start_audio_capture`, `synthesize_edge_tts`, `open_devtools`
- Pattern: Async function invoked from JS via `invoke(commandName, args)` → Tauri routes to Rust handler → result returned to JS

## Entry Points

**Main Window (index.html):**
- Location: `index.html` → `src/main.jsx` → `src/App.jsx`
- Triggers: App startup
- Responsibilities: Initialize i18n, theme, config store. Render window based on `appWindow.label`. Set up global keyboard listeners (dev mode, Escape to close). Handle theme/language changes.

**Config Window (config page):**
- Location: `src/window/Config/index.jsx`
- Triggers: User opens config or first run
- Responsibilities: Navigation sidebar, page routing, settings management. Coordinated via React Router.

**Monitor Window (audio transcription):**
- Location: `src/window/Monitor/index.jsx`
- Triggers: User starts audio monitoring from tray or hotkey
- Responsibilities: Audio capture lifecycle, transcription client management, TTS queue, auto-save to markdown. Heavy component with 900+ lines.

**Translate Window (quick popup):**
- Location: `src/window/Translate/index.jsx`
- Triggers: User selects text and presses hotkey
- Responsibilities: Dynamic window sizing, provider tabs, translation service calls. Handles blur/focus for drag operations.

**Recognize Window (OCR/QR):**
- Location: `src/window/Recognize/index.jsx`
- Triggers: User captures screen region
- Responsibilities: Image upload, plugin/service selection, recognition service calls.

**Daemon (daemon.html):**
- Location: `daemon.html` → no React component
- Triggers: Background window (not visible)
- Responsibilities: Background tasks (currently placeholder)

## Error Handling

**Strategy:** Localized error display + optional logging

**Patterns:**
- **Network Errors:** Service clients catch and emit via `onError` callback. Monitor/Translate display inline error messages with auto-hide (5 seconds).
- **Missing Config:** Check `if (!config.apiKey)` before invoking service. Display i18n error message: `t('monitor.no_api_key')`.
- **Async Failures:** Try-catch in async effects, log to console and Tauri log, update UI state with error message.
- **Plugin Load Errors:** Caught in `loadPluginList()`, plugin silently skipped if parse fails.
- **Rust Backend Errors:** Returned via Tauri command error channel, caught in `.catch()` handler on frontend.

## Cross-Cutting Concerns

**Logging:**
- Frontend: `console.log()` for development, no production logging by default
- Backend: `tauri-plugin-log` to `~/.config/transkit/logs/`
- Used for: Debugging connections, recognizing state transitions

**Validation:**
- Frontend: Minimal validation (check for empty text, valid URLs)
- Backend: Rust type system enforces validation on command inputs
- Service clients: Validate API responses and throw descriptive errors

**Authentication:**
- API keys stored in `useConfig()` (persisted to store)
- Encrypted at rest via platform keychain integration (via Tauri Store)
- Not explicitly handled in frontend—assumed secure on disk

**Internationalization (i18n):**
- `src/i18n/index.jsx` initializes i18next with language locales
- Locale files at `src/i18n/locales/{lang}.json`
- Access via `useTranslation()` hook: `t('key.nested.path')`
- Language preference persisted via `useConfig('app_language')`

**Theme & UI:**
- NextUI for component library
- next-themes for dark/light mode
- Theme preference persisted via `useConfig('app_theme')`
- CSS overrides in `src/window/*/style.css`

**Platform Awareness:**
- `osType` from `src/utils/env.js` determines macOS/Windows/Linux specific UI
- Drag regions, window controls, borders conditionally rendered based on OS
- Example: macOS hides window buttons, Linux adds rounded borders
