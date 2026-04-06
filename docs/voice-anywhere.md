# Voice Anywhere

A global voice input system that lets users dictate text into any field across
all Transkit windows — and optionally into any external application — using a
keyboard shortcut or a persistent floating microphone button.

---

## Status

Design — not yet implemented.

---

## Motivation

Transkit already captures microphone audio for the Audio Monitor and Narration
features. Voice Anywhere exposes that same capability as a general-purpose
input method. The goal is zero-friction dictation: press a key (or tap a
button), speak, and the transcribed text lands exactly where the cursor is.

---

## Feature Overview

```
User triggers (shortcut or FAB click)
        │
        ▼
Voice Anywhere window
  • Animated mic indicator (Siri-style)
  • Interim transcript tooltip
        │
        ▼
Audio capture (existing Rust cpal pipeline)
        │  PCM s16le 16kHz mono
        ▼
STT client (reuses existing transcription service layer)
  onProvisional → interim text (muted, animated)
  onOriginal    → final text
        │
        ▼
Context Detector
  ├── Transkit window focused → emit voice_inject event to that window
  └── External app focused   → clipboard + simulated paste
```

---

## Trigger Methods

### Global keyboard shortcut

Default: `Ctrl+Shift+Space` (Windows/Linux) / `Cmd+Shift+Space` (macOS).

Registered via the existing `GlobalShortcutManager` in `hotkey.rs`. The
shortcut is user-configurable in Settings → Hotkeys.

Behavior on trigger:
- If Voice Anywhere is **idle**: show FAB, begin recording immediately (no
  extra tap needed when triggered by keyboard).
- If Voice Anywhere is **recording**: stop recording and inject text.
- If Voice Anywhere is **hidden**: show and start recording.

### Floating Action Button (FAB)

A small always-on-top transparent window that sits in a screen corner. It
persists as long as the user wants it visible (toggled from Settings or tray
menu). Clicking the FAB toggles recording on/off.

The FAB window is separate from all other Transkit windows so it does not
interfere with window focus.

---

## FAB Design

### Visual states

| State | Appearance |
|---|---|
| `idle` | Mic icon · subtle slow pulse ring · semi-transparent dark pill |
| `listening` | 3–5 animated frequency bars (height driven by mic amplitude) · accent color glow |
| `processing` | Small spinner overlay · bars paused |
| `injecting` | Brief green checkmark flash · 400 ms · then returns to `idle` |
| `error` | Red tint · shake animation · tooltip with error message |

### Dimensions and positioning

Default size: `72 × 72 px` (pill shape, `border-radius: 50%`).

Default position: bottom-right corner, `20 px` from screen edges.

The FAB is **draggable**: the user can reposition it anywhere on screen by
dragging. Position is saved to the config store and restored on next launch.
Each monitor remembers its own position independently (saved by monitor index).

### Cross-platform transparency feasibility

| Platform | Transparent window | Notes |
|---|---|---|
| **macOS** | Full support | Tauri `transparent: true` + `decorations: false` + `macos-private-api` already in use in this project for the Monitor window. Works reliably. |
| **Windows 10/11** | Full support | Tauri `transparent: true` + `decorations: false`. The WinRT compositor (DWM) handles per-pixel alpha correctly. No extra dependencies. |
| **Linux (X11)** | Compositor-dependent | Works on compositors that support ARGB visuals (GNOME Mutter, KDE KWin, Picom). Fails gracefully on minimal WMs without compositing. |
| **Linux (Wayland)** | Partial support | Depends on the Wayland compositor protocol support in wlroots/KWin. The existing wry patch in this repo (`../patches/wry`) already addresses some webkit2gtk issues. Needs testing. |

**Fallback for Linux without compositor:** render the FAB with a solid dark
background instead of transparency. Show a one-time notice in Settings
explaining why transparency is unavailable.

Detection:
```rust
// src-tauri/src/voice_anywhere.rs
#[cfg(target_os = "linux")]
fn compositor_supports_transparency() -> bool {
    // Check DISPLAY vs WAYLAND_DISPLAY env vars
    // Attempt to create a test 1x1 transparent window; observe result
    // Return false if creation fails or if --no-compositor flag is set
}
```

### Draggable implementation

Tauri v1 supports window dragging via `data-tauri-drag-region` attribute (CSS
drag region) or programmatic `appWindow.startDragging()`.

The entire FAB surface is a drag region when the user long-presses (> 300 ms)
or when the mouse moves more than 4 px while holding the button. Short clicks
remain as record toggles.

```jsx
// Distinguish drag from tap
onPointerDown={(e) => {
    dragTimer.current = setTimeout(() => setDragging(true), 300);
    startPos.current = { x: e.clientX, y: e.clientY };
}}
onPointerMove={(e) => {
    const dist = Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y);
    if (dist > 4) { clearTimeout(dragTimer.current); appWindow.startDragging(); }
}}
onPointerUp={() => {
    clearTimeout(dragTimer.current);
    if (!dragging) toggleRecording();
    setDragging(false);
    savePosition(); // persist to store
}}
```

---

## Audio Pipeline

Voice Anywhere reuses the existing audio infrastructure without modification.

```
invoke('start_audio_capture', { source: 'microphone', batchIntervalMs: 100 })
    │
    ▼  Tauri event: "audio_chunk"  (base64 PCM s16le 16kHz mono)
    │
    ▼
STT client.sendAudio(pcmBuffer)
    │
    ├── onProvisional(text) → interim display
    └── onOriginal(text)    → final text → context inject
```

**Conflict with Audio Monitor:** The two features cannot share audio capture
simultaneously. The resolution policy depends on which was started first.

**Case A — Voice Anywhere starts while Monitor is active:**
Voice Anywhere suspends Monitor's audio capture immediately (stops `cpal`
stream, keeps STT WebSocket alive). When Voice Anywhere finishes (final text
injected or user cancels), Monitor's capture resumes automatically — the STT
session reconnects if needed. Monitor UI shows a "Paused — Voice Input active"
status badge during the suspension.

**Case B — Monitor is opened or started while Voice Anywhere is recording:**
Monitor's start-capture action checks for an active Voice Anywhere session. If
found, a modal confirmation is shown:

> "Voice Input is currently recording. Starting Audio Monitor will stop the
> current voice recording. Continue?"
>
> [Cancel] [Stop Voice Input & Start Monitor]

If the user confirms, Voice Anywhere discards the in-progress transcript (no
injection), stops capture, and Monitor starts normally. If the user cancels,
Monitor does not start and Voice Anywhere continues.

---

## STT Integration

### Service selection

Voice Anywhere uses a dedicated config key `voice_anywhere_stt_service`.

Default: inherit the same service selected in Audio Monitor settings. If no
Monitor service is configured, fallback to **Web Speech API** (browser
built-in, no API key required, works offline on supported platforms).

```
Priority:
1. voice_anywhere_stt_service (if explicitly set)
2. audio_monitor service (if configured)
3. Web Speech API (browser fallback)
```

### Language pre-configuration

Config key: `voice_anywhere_language` (default `"auto"`).

When `"auto"`:
1. Check `source_language` from Monitor config.
2. Check OS locale.
3. Pass resolved language code to the STT client as the `language` hint.

Pre-setting language reduces STT error rate significantly (especially for
Deepgram and Soniox which use language-specific acoustic models).

### Streaming vs batch

Prefer streaming (WebSocket) STT services for real-time interim results. If
the selected service is batch-only (e.g. OpenAI Whisper), synthesize interim
behavior by showing a "listening…" placeholder and only injecting on final.

---

## Interim Transcription UX

Inspired by iOS dictation and Google Assistant. Text appears progressively
while the user is still speaking.

### Transcript tooltip

Rendered as an absolute-positioned tooltip above the FAB:

```
┌─────────────────────────────┐
│ this is what i'm saying ri… │  ← interim (opacity 0.5, italic)
│ This is what I'm saying.    │  ← final (opacity 1.0, normal)
└─────────────────────────────┘
         ▲
       [FAB]
```

- Max width: `320 px`, wraps text, truncates to 3 lines with fade-out bottom.
- Interim text color: `text-default-400` (muted).
- Final text color: `text-foreground`.
- Transition: when a final result arrives, interim text fades out (150 ms) and
  final text fades in at the same position (100 ms delay).
- Tooltip auto-hides 1.5 s after injection completes.

### Amplitude visualization

The FAB's animated bars are driven by the actual mic amplitude, computed from
each PCM chunk:

```js
// In voice_anywhere/useVoiceAnywhere.js
listen("audio_chunk", ({ payload }) => {
    const pcm = base64ToInt16Array(payload);
    const rms = Math.sqrt(pcm.reduce((s, v) => s + v * v, 0) / pcm.length);
    setAmplitude(Math.min(1, rms / 8000)); // normalize 0–1
});
```

The 5 bars animate their heights proportionally to `amplitude` with slight
random jitter per bar to avoid a robotic look.

---

## Context Detection and Text Injection

### Step 1: Capture focused window before showing FAB

When the global shortcut fires, the Rust handler records which Tauri window was
focused at that moment (before `voice_anywhere` window becomes visible):

```rust
// hotkey.rs
"hotkey_voice_anywhere" => {
    let focused = app_handle.windows()
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone());
    // Store in app state
    *app_handle.state::<VoiceAnywhereState>().focused_window.lock().unwrap()
        = focused;
    voice_anywhere_window(&app_handle);
}
```

### Step 2: Injection routing

When the final transcript is ready, the `voice_anywhere` window emits an event
back to Rust, which routes it:

| Previous focused window | Injection method |
|---|---|
| `translate` | `emit("voice_inject", { label: "translate", text, mode })` |
| `monitor` | `emit("voice_inject", { label: "monitor", text, mode })` |
| `config` | `emit("voice_inject", { label: "config", text, mode })` |
| `recognize` | No text input — show transcript in FAB tooltip only |
| `none` / external app | Clipboard + simulated paste (see below) |

`mode` is `"replace"` or `"append"` (user-configurable).

### Step 3: Each Transkit window handles `voice_inject`

Each window adds a listener at mount time:

```js
// Translate/index.jsx
useEffect(() => {
    const unlisten = listen("voice_inject", ({ payload }) => {
        if (payload.label !== appWindow.label) return;
        if (payload.mode === "replace") setSourceText(payload.text);
        else setSourceText(prev => prev + (prev ? " " : "") + payload.text);
    });
    return () => unlisten.then(f => f());
}, []);
```

### Step 4: External application injection

When no Transkit window was focused, inject into whatever the OS-level focused
app is.

**Method: clipboard + paste simulation**

This is the most reliable cross-platform approach and the one used in existing
production tools (e.g. Whisper Transcription for macOS, Espanso).

```
1. Save current clipboard content
2. Write transcript to clipboard (arboard — already in Cargo.toml)
3. Simulate Cmd+V / Ctrl+V keystroke
4. Restore original clipboard after 500 ms
```

Platform implementation:

| Platform | Paste simulation | Crate / API |
|---|---|---|
| **macOS** | `CGEventPost` with `kVK_ANSI_V` + `kCGEventFlagMaskCommand` | `objc` (already in deps), CoreGraphics |
| **Windows** | `SendInput` with `VK_V` + `VK_CONTROL` | `windows-rs` (already in deps, `Win32_UI_WindowsAndMessaging`) |
| **Linux X11** | `XSendEvent` or `xdotool key ctrl+v` | `x11` crate or shell command fallback |
| **Linux Wayland** | `ydotool key 29:1 47:1 47:0 29:0` | shell command fallback, requires `ydotool` daemon |

**Linux caveat:** `xdotool` and `ydotool` are optional external dependencies.
If not present, Voice Anywhere falls back to "clipboard-only" mode and shows a
notification: "Text copied to clipboard — paste with Ctrl+V".

**macOS permission:** Accessibility permission is required for `CGEventPost` to
work in other applications. The app already uses `macos-accessibility-client`
and will prompt for this permission if not yet granted.

---

## New Files

```
src/window/VoiceAnywhere/
    index.jsx                  ← Root component, window entry point
    VoiceFab.jsx               ← Animated mic button (5 states)
    AmplitudeBars.jsx          ← Frequency bar animation component
    TranscriptTooltip.jsx      ← Interim + final text display
    useVoiceAnywhere.js        ← Core hook: audio capture, STT, inject
    useAmplitude.js            ← RMS amplitude from audio_chunk events
    fabPosition.js             ← Save/restore position per monitor

src-tauri/src/
    voice_anywhere.rs          ← Window creation, position, inject routing
    voice_inject.rs            ← Platform-specific paste simulation
```

---

## Modified Files

| File | Change |
|---|---|
| `src-tauri/tauri.conf.json` | Add `voice_anywhere` window declaration |
| `src-tauri/src/hotkey.rs` | Add `hotkey_voice_anywhere` shortcut handler |
| `src-tauri/src/main.rs` | Register new Tauri commands, init `VoiceAnywhereState` |
| `src-tauri/src/audio_cmd.rs` | Add `AudioCaptureManager` arbitration |
| `src-tauri/Cargo.toml` | Add `enigo` or platform-specific input simulation crates |
| `src/App.jsx` | Add `voice_anywhere` to `windowMap` |
| `src/window/Translate/index.jsx` | Add `voice_inject` listener |
| `src/window/Monitor/index.jsx` | Add `voice_inject` listener |
| `src/window/Config/pages/Hotkey/index.jsx` | Add voice shortcut row |
| `src/window/Config/routes/index.jsx` | Add `/voice` settings route |

---

## Settings

A new **Voice Input** section is added under Settings (Config window).

### Settings → Hotkeys

| Setting | Key | Default |
|---|---|---|
| Voice input shortcut | `hotkey_voice_anywhere` | `CmdOrCtrl+Shift+Space` |

### Settings → Voice Input (new page)

#### General

| Setting | Key | Default | Notes |
|---|---|---|---|
| STT service | `voice_anywhere_stt_service` | `"inherit"` | Dropdown: Inherit from Monitor \| Deepgram \| Soniox \| AssemblyAI \| Gladia \| Web Speech API |
| Language | `voice_anywhere_language` | `"auto"` | Dropdown: Auto-detect \| English \| Vietnamese \| + all supported languages |
| Injection mode | `voice_anywhere_inject_mode` | `"replace"` | Radio: Replace existing text / Append to end |
| External app behavior | `voice_anywhere_external_mode` | `"paste"` | Radio: Auto-paste \| Clipboard only |

#### Floating Button

| Setting | Key | Default | Notes |
|---|---|---|---|
| Show floating button | `voice_anywhere_fab_visible` | `true` | Toggle |
| Button size | `voice_anywhere_fab_size` | `72` | Slider: 48 – 96 px |
| Screen corner | `voice_anywhere_fab_corner` | `"bottom-right"` | Dropdown: Bottom-right \| Bottom-left \| Top-right \| Top-left \| Custom (drag to set) |
| Transparency | `voice_anywhere_fab_opacity` | `0.85` | Slider: 0.4 – 1.0 |

#### Behavior

| Setting | Key | Default | Notes |
|---|---|---|---|
| Start recording on shortcut | `voice_anywhere_autostart` | `true` | If false, shortcut shows FAB but waits for tap to record |
| Auto-stop silence (seconds) | `voice_anywhere_silence_timeout` | `3` | Slider: 1 – 10 s. 0 = manual stop only |
| Show interim transcript | `voice_anywhere_show_interim` | `true` | Toggle |
| Restore clipboard after paste | `voice_anywhere_restore_clipboard` | `true` | Toggle (external mode only) |

---

## Window Declaration (`tauri.conf.json`)

```json
{
  "label": "voice_anywhere",
  "url": "index.html",
  "title": "Voice Input",
  "width": 72,
  "height": 72,
  "minWidth": 48,
  "minHeight": 48,
  "resizable": false,
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "visible": false,
  "skipTaskbar": true,
  "focus": false,
  "center": false
}
```

The window is never centered — it is positioned programmatically at the
configured corner offset after creation.

---

## Cross-Platform Compatibility Matrix

| Capability | macOS | Windows | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Transparent FAB window | ✅ | ✅ | ✅ (compositor required) | ⚠️ (compositor dependent) |
| Draggable window | ✅ | ✅ | ✅ | ✅ |
| Global shortcut | ✅ | ✅ | ✅ | ⚠️ (some WMs block) |
| Mic audio capture (cpal) | ✅ | ✅ | ✅ | ✅ |
| STT via WebSocket | ✅ | ✅ | ✅ | ✅ |
| Inject to Transkit windows | ✅ | ✅ | ✅ | ✅ |
| Active window detection | ✅ | ✅ | ✅ (X11) | ❌ (no standard API) |
| Paste simulation (external) | ✅ (needs Accessibility) | ✅ | ✅ (xdotool) | ⚠️ (ydotool optional) |
| Clipboard fallback | ✅ | ✅ | ✅ | ✅ |

**Legend:** ✅ Full support · ⚠️ Partial / conditional · ❌ Not available

### Linux-specific notes

- **Compositor check at startup:** On Linux, the app checks for compositor
  support once at launch and sets a `linux_compositor_available` flag. If
  false, transparent window mode is disabled and the FAB uses an opaque
  rounded dark background.

- **Wayland active window:** Since there is no standard protocol for getting
  the focused window in Wayland, external paste is downgraded to clipboard-only
  mode on Wayland. The user is informed via a one-time Settings notice.

- **Global shortcuts on Wayland:** Some Wayland compositors block global
  shortcuts from non-privileged apps. If shortcut registration fails, the app
  logs a warning and suggests using the FAB button instead.

---

## Implementation Phases

### Phase 1 — Window shell and FAB

- Add `voice_anywhere` window to `tauri.conf.json`
- Add `voice_anywhere_window()` to `window.rs` (create, show/hide, corner positioning)
- Wire `hotkey_voice_anywhere` in `hotkey.rs`
- Implement `VoiceFab.jsx` with 5 visual states (idle, listening, processing, injecting, error)
- Implement drag-to-reposition with position persistence
- Add `voice_anywhere` to `App.jsx` windowMap

Deliverable: FAB appears at shortcut press, animates, can be dragged. No audio yet.

### Phase 2 — Audio capture and STT

- Implement `useVoiceAnywhere.js` hook connecting `start_audio_capture` →
  STT client → `onProvisional` / `onOriginal`
- Implement `useAmplitude.js` for RMS-driven bar animation
- Implement `TranscriptTooltip.jsx` with interim/final fade transitions
- Add audio capture arbitration with Monitor window

Deliverable: Shortcut → record → see transcript in FAB tooltip.

### Phase 3 — Text injection (Transkit windows)

- Capture focused window label in `hotkey.rs` before showing FAB
- Implement `voice_inject` Tauri event routing in `voice_anywhere.rs`
- Add `voice_inject` listener to Translate, Monitor, Config windows
- Test replace vs append modes

Deliverable: Dictated text lands in Transkit windows correctly.

### Phase 4 — External application injection

- Implement `voice_inject.rs` with platform-specific paste simulation
  (macOS: CoreGraphics, Windows: SendInput, Linux: xdotool fallback)
- Clipboard save/restore around paste
- Accessibility permission prompt on macOS (first use)
- Degraded clipboard-only mode when simulation unavailable

Deliverable: Dictation works in any application.

### Phase 5 — Settings UI

- Add `/voice` route to Config
- Implement all settings rows (STT service, language, FAB appearance, behavior)
- Add `hotkey_voice_anywhere` to Hotkeys page
- Test settings round-trip (change → persist → apply live)

Deliverable: Full feature configuration without code changes.

---

## Known Limitations

1. **Wayland active window detection is not possible** without compositor
   protocol extensions (e.g. `ext-foreign-toplevel-list` from wlroots).
   External paste degrades to clipboard-only on Wayland. A one-time warning is
   shown in Settings on first use: "Auto-paste is not available on Wayland.
   Text will be copied to clipboard — press Ctrl+V to paste." Linux user base
   is small; this is low-priority and will not block the initial release.

2. **macOS Accessibility permission** must be granted by the user for
   auto-paste into external apps. The app cannot grant this itself. A
   permission prompt is triggered on first use of external paste.

3. **Audio conflict** with an active Monitor session is resolved by the
   suspend/confirmation policy described in the Audio Pipeline section above.
   There is no configurable fallback — the two-case policy is fixed.

4. **Web Speech API on Linux** is disabled in WebKit (GTK port) by default.
   Users on Linux who have no STT service configured will see a setup prompt
   rather than a working fallback.

5. **Multi-monitor position** is stored per monitor index. If the monitor
   configuration changes (monitor added/removed, resolution change), the saved
   position may be out of bounds. The app clamps the saved position to the
   nearest valid corner on next launch.
