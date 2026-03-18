# Technology Stack

**Analysis Date:** 2026-03-18

## Languages

**Primary:**
- TypeScript 5.6.3 - React components, service clients, type definitions
- JavaScript (ES modules) - Service implementations, utilities, configuration
- Rust 2021 edition - Desktop backend (Tauri application)

**Secondary:**
- JSON - Configuration and localization files

## Runtime

**Environment:**
- Node.js v22.22.1 (from `package.json` scripts)
- Tauri 1.8 - Cross-platform desktop framework

**Package Manager:**
- pnpm (inferred from `tauri.conf.json` build scripts)
- Lockfile: Present (implied by lock usage)

## Frameworks

**Core:**
- React 18.3.1 - UI framework
- React Router DOM 6.27.0 - Client-side routing
- NextUI 2.4.8 - React component library
- Tauri 1.8 - Desktop app framework with Rust backend

**UI Components & Styling:**
- Tailwind CSS 3.4.14 - Utility-first CSS framework
- Framer Motion 11.11.10 - Animation library
- React Spring 9.7.5 - Spring physics animations
- React Hot Toast 2.4.1 - Toast notifications
- React Icons 5.3.0 - Icon library
- React Spinners 0.14.1 - Loading spinners
- Hello Pangea DND 18.0.1 - Drag-and-drop
- React Use Measure 2.1.1 - Measure component sizes

**State Management:**
- Jotai 2.10.1 - Primitive atom-based state management

**Theming & Internationalization:**
- Next Themes 0.3.0 - Dark mode/theme management
- i18next 23.16.4 - Internationalization framework
- React i18next 15.1.0 - React integration for i18next
- 18+ locale JSON files in `src/i18n/locales/`

**Build/Dev:**
- Vite 5.4.10 - Frontend build tool and dev server
- Vitejs Plugin React 4.3.3 - React support for Vite
- PostCSS 8.4.47 - CSS transformation
- Autoprefixer 10.4.20 - Vendor prefix handling

**Testing:**
- No test framework detected

## Key Dependencies

**Critical:**
- @tauri-apps/api 1.6.0 - Core Tauri IPC API
- tauri-plugin-store-api (v1 from GitHub) - Persistent configuration storage
- tauri-plugin-sql-api (v1 with SQLite feature) - Database access
- tauri-plugin-fs-watch-api (v1) - File system watching
- tauri-plugin-log-api (v1) - Logging capabilities
- tauri-plugin-autostart-api (v1) - System autostart integration

**Audio & Media:**
- edge-tts-universal 1.4.0 - Edge TTS integration
- tesseract.js 5.1.1 - OCR (Optical Character Recognition)
- jsqr 1.4.0 - QR code detection
- Ollama 0.5.9 - Local LLM client

**Cryptography & Security:**
- crypto-js 4.2.0 - JavaScript cryptography
- jose 5.9.6 - JWT/JWE handling
- md5 2.3.0 - MD5 hashing
- uuid 11.0.2 - UUID generation
- nanoid 5.0.8 - Unique ID generation

**Markdown & Content:**
- react-markdown 9.0.1 - Markdown rendering in React

**Utilities:**
- flag-icons 7.2.3 - Flag icons for locales

## Configuration

**Environment:**
- Vite environment variables with `VITE_` and `TAURI_` prefix
- Production detection: `import.meta.env.PROD`
- Configuration file: `src/utils/store.js` uses tauri-plugin-store
- Config file location: `~/.config/com.transkit.desktop/config.json`

**Build:**
- `vite.config.js` - Vite configuration with React plugin
- `tsconfig.json` - TypeScript configuration (does not exist in root)
- Dual entry points: `index.html` (main UI), `daemon.html` (background service)

**Prettier Formatting:**
- Print width: 120 characters
- Tab width: 4 spaces
- Single quotes for JSX and regular strings
- Trailing commas: ES5 style
- Arrow function parentheses: always

## Platform Requirements

**Development:**
- macOS (primary with Accessibility API), Windows, Linux support
- Git and standard build tools
- Rust toolchain for Tauri compilation

**Production:**
- Desktop application bunled as:
  - `.app` for macOS (with entitlements support)
  - `.exe` for Windows (MSI installer support)
  - `.deb` and `.rpm` for Linux (with tesseract-ocr, libxdo-dev, libxcb1, libxrandr2 system dependencies)

**Platform-Specific Dependencies:**
- macOS: `macos-accessibility-client 0.0.1`, `screencapturekit 1.5`, `window-shadows 0.2`, `objc 0.2`
- Windows: `windows 0.58.0` (Win32 UI, Graphics, Media OCR, Foundation APIs), `window-shadows 0.2`
- Linux: OpenSSL (noted but no package specified)

## Updater

**Auto-update System:**
- Active: Yes
- Endpoints:
  - `https://transkit.app/transkit-desktop/updater/update.json`
  - `https://github.com/transkit-app/transkit-desktop/releases/download/updater/update.json`
- Public key configured for signature verification
- Dialog disabled (updates in background)

## Backend Dependencies (Rust)

**Core:**
- serde 1.0 + serde_json 1.0 - JSON serialization
- tokio-tungstenite 0.23 - WebSocket support
- reqwest 0.12 - HTTP client
- reqwest_dav 0.1.5 - WebDAV support

**Audio Processing:**
- cpal 0.15 - Cross-platform audio API
- rodio 0.17 - Audio playback (WAV support)
- arboard 3.4 - Clipboard access
- screenshots 0.7.2 - Screenshot capture

**Language & Encoding:**
- lingua 1.6.2 - Language detection (30+ languages supported)
- base64 0.22 - Base64 encoding

**Utilities:**
- log 0.4 + tauri-plugin-log - Logging
- tiny_http 0.12 - Local HTTP server for IPC
- zip 2.2.0 - ZIP handling
- walkdir 2.5 - Directory traversal
- font-kit 0.14.2 - Font handling
- image 0.25.4 - Image processing
- uuid 1.10 - UUID generation
- sha2 0.10 - SHA2 hashing
- selection 1.2.0 - System selection/clipboard
- mouse_position 0.1.4 - Mouse position tracking
- dirs 5.0.1 - Platform directories
- once_cell 1.19.0 - Lazy statics

---

*Stack analysis: 2026-03-18*
