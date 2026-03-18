# Codebase Structure

**Analysis Date:** 2026-03-18

## Directory Layout

```
transkit-desktop/
├── src/                           # React frontend source
│   ├── main.jsx                   # App entry point (initializes store, theme, i18n)
│   ├── App.jsx                    # Root component (window router)
│   ├── style.css                  # Global styles
│   ├── i18n/                      # Internationalization
│   │   ├── index.jsx              # i18next configuration
│   │   └── locales/               # Language JSON files (en.json, etc.)
│   ├── components/                # Shared UI components
│   │   └── WindowControl/         # Window minimize/close/maximize buttons
│   ├── hooks/                     # Custom React hooks
│   │   ├── useConfig.jsx          # Persistent config state hook
│   │   ├── useVoice.jsx           # Audio playback hook
│   │   ├── useSyncAtom.jsx        # Sync Jotai atom with config
│   │   ├── useGetState.jsx        # Get current state without re-render
│   │   ├── useToastStyle.jsx      # Toast notification styling
│   │   └── index.jsx              # Barrel export
│   ├── utils/                     # Utility functions
│   │   ├── store.js               # Tauri Store wrapper (config persistence)
│   │   ├── env.js                 # OS/app metadata (osType, arch, version)
│   │   ├── index.js               # debounce() and helpers
│   │   ├── invoke_plugin.js       # Plugin loader via Tauri invoke
│   │   ├── lang_detect.js         # Language detection via backend
│   │   ├── service_instance.js    # Service key parsing utilities
│   │   └── generateSonioxContext.js # AI context generation for transcription
│   ├── services/                  # Modular service implementations
│   │   ├── translate/             # Translation providers (24+ services)
│   │   │   ├── index.jsx          # Barrel export (all translate services)
│   │   │   ├── deepl/             # DeepL service
│   │   │   │   ├── index.jsx      # Export translate(), info
│   │   │   │   ├── Config.jsx     # Settings component
│   │   │   │   ├── info.ts        # Service metadata
│   │   │   │   └── ...            # Implementation files
│   │   │   ├── google/
│   │   │   ├── openai/
│   │   │   └── ... (22 more)
│   │   ├── recognize/             # OCR/Image recognition (20+ services)
│   │   │   ├── index.jsx          # Barrel export
│   │   │   ├── system/            # System OCR
│   │   │   ├── tesseract/         # Client-side Tesseract.js
│   │   │   ├── baidu/             # Baidu OCR
│   │   │   └── ... (17 more)
│   │   ├── transcription/         # Real-time speech-to-text (3 services)
│   │   │   ├── index.jsx          # Barrel export
│   │   │   ├── soniox_stt/        # Soniox real-time transcription
│   │   │   │   ├── client.js      # WebSocket client
│   │   │   │   ├── index.jsx      # Export createClient()
│   │   │   │   ├── Config.jsx     # Settings UI
│   │   │   │   └── info.ts        # Metadata
│   │   │   ├── assemblyai_stt/    # AssemblyAI transcription
│   │   │   └── openai_whisper_stt/ # OpenAI Whisper
│   │   ├── tts/                   # Text-to-speech (6 services)
│   │   │   ├── index.jsx          # Barrel export
│   │   │   ├── edge_tts/          # Microsoft Edge TTS
│   │   │   ├── elevenlabs_tts/    # ElevenLabs
│   │   │   ├── google_tts/        # Google TTS
│   │   │   └── ... (3 more)
│   │   ├── collection/            # Word collection services (2 services)
│   │   │   ├── anki/              # Anki deck export
│   │   │   └── eudic/             # Eudic dictionary sync
│   │   └── ai/                    # AI context generation (5 services)
│   │       ├── openai_ai/
│   │       ├── gemini_ai/
│   │       ├── groq_ai/
│   │       ├── ollama_ai/
│   │       └── openai_compat_ai/
│   └── window/                    # Window modules (each is a separate window)
│       ├── Config/                # Settings/configuration window
│       │   ├── index.jsx          # Config layout + routing
│       │   ├── style.css          # Config-specific styles
│       │   ├── components/
│       │   │   └── SideBar/       # Navigation sidebar
│       │   ├── pages/             # Configuration pages
│       │   │   ├── General/       # Theme, language, appearance
│       │   │   ├── Recognize/     # OCR service config
│       │   │   ├── Translate/     # Translation service config
│       │   │   ├── AudioTranslate/ # Monitor/transcription config
│       │   │   ├── About/         # Version, credits
│       │   │   ├── History/       # Translation history
│       │   │   ├── Hotkey/        # Hotkey bindings
│       │   │   ├── Service/       # Service management (6 sub-pages)
│       │   │   │   ├── Recognize/
│       │   │   │   ├── Translate/
│       │   │   │   ├── Transcription/
│       │   │   │   ├── Tts/
│       │   │   │   ├── Collection/
│       │   │   │   ├── Ai/        # AI service config
│       │   │   │   ├── Audio/     # Audio input config
│       │   │   │   ├── PluginConfig/ # Plugin configuration
│       │   │   │   └── SelectPluginModal/ # Plugin discovery
│       │   └── routes/            # React Router route config (directory)
│       ├── Monitor/               # Real-time audio transcription window
│       │   ├── index.jsx          # Main component (900+ lines)
│       │   ├── tts.js             # TTS queue singleton
│       │   └── components/
│       │       ├── MonitorToolbar/ # Control buttons (start/stop, language, etc.)
│       │       ├── MonitorLog/     # Transcript display
│       │       └── ContextPanel/   # Soniox context (domains, terms, presets)
│       ├── Translate/             # Quick translation popup window
│       │   ├── index.jsx          # Main component (650+ lines)
│       │   └── components/
│       │       ├── SourceArea/     # Input text area
│       │       ├── TargetArea/     # Translation results
│       │       └── LanguageArea/   # Language selector
│       ├── Recognize/             # OCR/QR recognition window
│       │   ├── index.jsx          # Main component
│       │   └── components/
│       │       ├── ControlArea/    # Service and language selection
│       │       ├── ImageArea/      # Image upload and preview
│       │       └── TextArea/       # OCR result display
│       ├── Screenshot/            # Screenshot capture window
│       │   └── index.jsx
│       ├── Updater/               # App update window
│       │   └── index.jsx
│       └── Translate.jsx (duplicate?) # Alternative/legacy translate
├── src-tauri/                     # Rust backend
│   └── src/
│       ├── main.rs                # Tauri app setup, command registration
│       ├── cmd.rs                 # Command handlers
│       ├── audio_cmd.rs           # Audio capture commands
│       ├── edge_tts.rs            # TTS synthesis
│       ├── window.rs              # Window management
│       ├── tray.rs                # System tray menu
│       ├── hotkey.rs              # Hotkey registration
│       ├── screenshot.rs          # Screenshot capture
│       ├── audio/                 # Audio capture modules
│       ├── clipboard.rs
│       ├── config.rs
│       ├── error.rs
│       ├── lang_detect.rs
│       ├── server.rs
│       ├── system_ocr.rs
│       ├── backup.rs
│       └── updater.rs
├── public/                        # Static assets (icons, etc.)
├── asset/                         # Build/distribution assets
├── docs/                          # Documentation
├── .scripts/                      # Build scripts
├── index.html                     # Main window HTML
├── daemon.html                    # Daemon window HTML
├── vite.config.js                 # Vite build config
├── tailwind.config.cjs            # Tailwind CSS config
├── postcss.config.js              # PostCSS config
├── .prettierrc.json               # Code formatting
├── package.json                   # Dependencies
└── .tauri-build/                  # Tauri build output (generated)
```

## Directory Purposes

**`src/`**
- Purpose: All React application source code
- Contains: Components, hooks, utilities, services, windows
- Key files: `main.jsx` (entry), `App.jsx` (router)

**`src/services/`**
- Purpose: Modular service provider implementations organized by feature type
- Contains: 50+ service implementations across translate, recognize, transcription, TTS, collection, AI
- Pattern: Each service lives in `{type}/{provider_name}/` with `index.jsx`, `Config.jsx`, `info.ts`, and client files
- Organization: Flat namespace—service keys are unique identifiers (e.g., `deepl`, `google`, `soniox_stt`)

**`src/window/`**
- Purpose: Separate React root components for each application window
- Contains: Config, Monitor, Translate, Recognize, Screenshot, Updater windows
- Pattern: Each window is self-contained with its own state, hooks, and event listeners
- Routing: Config window uses React Router for internal page navigation

**`src/hooks/`**
- Purpose: Custom React hooks for common patterns
- Key hooks: `useConfig()` (persistent state), `useVoice()` (playback), `useSyncAtom()` (Jotai sync)
- Export pattern: Barrel file `index.jsx` exports all hooks

**`src/utils/`**
- Purpose: Shared utility functions and wrappers
- Key utilities: `store.js` (Tauri Store wrapper), `env.js` (system metadata), `service_instance.js` (service key parsing)

**`src-tauri/src/`**
- Purpose: Rust backend implementing OS-level functionality
- Contains: Audio capture, system OCR, hotkeys, window management, tray, TTS, clipboard, config, language detection
- Entry: `main.rs` initializes Tauri builder, registers plugins, sets up app state

## Key File Locations

**Entry Points:**
- `src/main.jsx` - App initialization (store, i18n, theme setup)
- `src/App.jsx` - Window router dispatches to Config/Monitor/Translate/Recognize/Screenshot/Updater
- `index.html` - Main window HTML container
- `daemon.html` - Daemon window (currently unused)

**Configuration:**
- `src/utils/store.js` - Persistent config store wrapper
- `src/hooks/useConfig.jsx` - Reactive config hook with sync
- `vite.config.js` - Build configuration for both windows (index, daemon)
- `tailwind.config.cjs` - Styling system

**Core Logic:**
- `src/window/Monitor/index.jsx` - Audio transcription engine (900+ lines)
- `src/window/Translate/index.jsx` - Translation UI and service orchestration (650+ lines)
- `src/window/Config/index.jsx` - Settings window layout
- `src/services/{type}/index.jsx` - Service provider barrel exports

**Testing:**
- No dedicated test files currently in codebase
- Service implementations are stateless or use simple client classes

## Naming Conventions

**Files:**
- React components: PascalCase in directories, `index.jsx` for default export (e.g., `src/window/Monitor/index.jsx`)
- Utilities: camelCase (e.g., `debounce`, `invoke_plugin`, `service_instance`)
- Config/styles: lowercase with underscore (e.g., `routes`, `style.css`)
- TypeScript metadata: `info.ts` for service info objects

**Directories:**
- Feature types (window modules): PascalCase (e.g., `Monitor`, `Translate`, `Config`)
- Service types: snake_case (e.g., `translate`, `recognize`, `transcription`, `tts`)
- Service providers: snake_case matching service key (e.g., `deepl`, `soniox_stt`, `edge_tts`)
- Sub-components: PascalCase (e.g., `MonitorToolbar`, `SourceArea`, `ContextPanel`)

**Variables & Functions:**
- Component props: camelCase (e.g., `isRunning`, `setFontSize`, `onToggleRun`)
- Hooks: camelCase starting with `use` (e.g., `useConfig`, `useVoice`)
- Atoms: camelCase ending with `Atom` (e.g., `pluginListAtom`, `textAtom`, `windowTypeAtom`)
- Service keys: lowercase with underscores (e.g., `deepl`, `soniox_stt`, `edge_tts`, `google_translate`)
- Config keys: snake_case with dots for nesting (e.g., `monitor_context`, `tts_playback_rate`, `app_theme`)

**Tauri Commands:**
- snake_case in Rust, snake_case in invoke calls (e.g., `start_audio_capture`, `synthesize_edge_tts`, `get_audio_capabilities`)

## Where to Add New Code

**New Translation Service:**
- Primary code: `src/services/translate/{provider_name}/`
  - Create `index.jsx` exporting `info` object and `translate(config, text)` function
  - Create `Config.jsx` component for API key/settings input
  - Create `info.ts` with service metadata (name, icon, languages)
- Tests: No existing test structure; add integration tests if needed
- Export: Add to `src/services/translate/index.jsx` barrel export

**New Window Type:**
- Implementation: `src/window/{WindowName}/index.jsx` (default export as React component)
- Sub-components: `src/window/{WindowName}/components/{Component}/index.jsx`
- Routing: For multi-page windows, use React Router with routes in `src/window/{WindowName}/routes/`
- Integration: Add window map entry in `src/App.jsx`: `windowMap.{label} = <WindowName />`

**New Configuration Page:**
- Implementation: `src/window/Config/pages/{PageName}/index.jsx`
- Routing: Add to `src/window/Config/routes/` route config
- Navigation: Add link in `src/window/Config/components/SideBar/index.jsx`

**New UI Component:**
- Shared components: `src/components/{ComponentName}/index.jsx`
- Window-specific: `src/window/{WindowName}/components/{ComponentName}/index.jsx`
- Pattern: Use NextUI components as building blocks

**New Hook:**
- Location: `src/hooks/{hookName}.jsx`
- Export: Add to `src/hooks/index.jsx` barrel file
- Pattern: Follow `useConfig` pattern for state, return tuple `[value, setValue, getterFn]`

**New Utility Function:**
- Simple utility: `src/utils/index.js` (if reusable across windows)
- Specific utility: Create new file in `src/utils/{domain}.js` and export
- Pattern: Named exports, functional style

**New Rust Command:**
- Implementation: Add function in `src-tauri/src/{domain}.rs` with `#[tauri::command]` attribute
- Registration: Add to command list in `src-tauri/src/main.rs`
- Frontend usage: Call via `invoke(commandName, args)` from React

**New Service Type (not provider, but category):**
- Create `src/services/{new_type}/` directory
- Add providers: `src/services/{new_type}/{provider_name}/`
- Barrel export: `src/services/{new_type}/index.jsx` exports all providers
- Config UI: Add service management page in `src/window/Config/pages/Service/{NewType}/`

## Special Directories

**`src/i18n/locales/`**
- Purpose: Language translation files
- Generated: No (manually maintained)
- Committed: Yes
- Format: JSON with nested keys (e.g., `{ "config.general.title": "General Settings" }`)
- How to add: Create new file for language, use same key structure

**`.planning/codebase/`**
- Purpose: Codebase documentation (this directory)
- Generated: Manually by development team
- Committed: Yes

**`dist/`**
- Purpose: Built output from Vite
- Generated: Yes (via `npm run build`)
- Committed: No

**`src-tauri/target/`**
- Purpose: Rust compilation artifacts
- Generated: Yes (via `tauri build`)
- Committed: No

**`node_modules/`**
- Purpose: npm dependencies
- Generated: Yes (via `npm install`)
- Committed: No (via .gitignore)

**`~/.config/transkit/`** (user's system)
- Purpose: Runtime config and plugin directory
- Contains: `config.json` (app settings), `plugins/{type}/{name}/` (external service plugins)
- Generated: At runtime on first app launch
