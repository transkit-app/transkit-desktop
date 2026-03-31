# Narration — Windows Implementation Guide

## Overview

The Narration feature (Spoken Translation) lets users speak in their language while Transkit
transcribes, translates, and reads back the result via a virtual microphone — so meeting
participants on Zoom/Teams hear the translated speech.

This document covers everything needed to run Narration on Windows.

---

## Virtual Audio Driver

Windows has no built-in loopback device. A third-party virtual audio driver must be installed
before Narration can be used.

### Recommended: VB-Cable (free)

| Property | Value |
|---|---|
| Download | https://vb-audio.com/Cable/ |
| Cost | Free (donationware) |
| Install | Run installer as Administrator, reboot |
| Output device name | `CABLE Input (VB-Audio Virtual Cable)` |
| Input device name (mic in Zoom) | `CABLE Output (VB-Audio Virtual Cable)` |

VB-Cable creates two devices:
- **CABLE Input** — we write TTS audio here (Transkit sees this as an output device)
- **CABLE Output** — Zoom/Teams uses this as the microphone input

### Alternative: Voicemeeter (free)

Many users already have Voicemeeter installed. Detection keywords already included:
- `VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)`
- `VoiceMeeter Aux Input`

### Other supported drivers

| Driver | Detection keyword |
|---|---|
| Virtual Audio Cable (VAC, paid) | `Virtual Audio Cable` |
| Synchronous Audio Router (SAR, open source) | `Synchronous Audio Router` |

---

## Architecture

The audio injection pipeline is identical across platforms — only the virtual device differs:

```
User speaks (VI)
    → Deepgram STT (narrationClient)
    → Google Translate → EN text
    → TTS engine (Edge TTS / ElevenLabs / Google TTS)
    → PCM16 audio buffer
    → narration_inject_audio (Rust Tauri command)
    → cpal output stream → CABLE Input
    → CABLE Output (internal Windows loopback)
    → Zoom/Teams picks up CABLE Output as microphone
```

The Rust audio pipeline (`virtual_mic.rs`) uses **cpal with WASAPI backend** on Windows.
No platform-specific code was needed beyond device detection.

---

## Implementation Status

| Component | Status | Notes |
|---|---|---|
| `virtual_mic.rs` — device detection | ✅ Implemented | Detects VB-Cable, Voicemeeter, VAC, SAR |
| `virtual_mic.rs` — audio stream | ✅ Works | cpal/WASAPI, no changes needed |
| `NarrationPanel` — Windows install hint | ✅ Implemented | Shows VB-Cable download link when no device found |
| `NarrationPanel` — OS detection | ✅ Fixed | Uses `osType` from Tauri API (was `navigator.userAgent`) |
| `narration_setup` command | ✅ Works | Validates device exists (same as macOS path) |
| Auto-create virtual device | ❌ Not possible | Windows requires manual driver install (unlike Linux pactl) |

---

## User Setup Flow (Windows)

1. Open Monitor → click the 🎙 Narration button in the toolbar
2. If no virtual device found → UI shows **"Install VB-Cable (free)"** link
3. User downloads and installs VB-Cable, then **reboots**
4. Reopen Monitor → Narration panel detects `CABLE Input (VB-Audio Virtual Cable)` automatically
5. Select the device in the dropdown
6. In Zoom/Teams: set microphone to **"CABLE Output (VB-Audio Virtual Cable)"**
7. Mute real microphone in Zoom
8. Set Monitor: Source = Vietnamese, Target = English
9. Narration mode: use PTT ("Hold to Speak") or enable Always-On (mic source mode)

---

## Known Limitations

### No programmatic driver installation
Unlike Linux (where Transkit auto-creates a PulseAudio null sink via `pactl`), Windows
requires the user to install VB-Cable manually. There is no silent installation path from
inside a Tauri app without admin elevation and UAC prompts.

**Future consideration:** Bundle a silent VB-Cable installer and invoke it with UAC elevation
(`runas`), showing a single install prompt. Requires VB-Audio license review.

### WASAPI exclusive mode
Some Windows audio configurations use WASAPI exclusive mode, which prevents multiple
apps from writing to the same device simultaneously. If audio injection fails silently,
the user should check that no other app has exclusive access to CABLE Input.

### Voicemeeter routing complexity
Voicemeeter users may need to configure internal routing manually. The Narration panel
device list shows all detected virtual devices — users should pick the correct one for
their Voicemeeter setup.

---

## Testing Checklist (Windows)

- [ ] Install VB-Cable → device appears in Narration panel after reboot
- [ ] Test tone button sends 440 Hz sine to CABLE Input (audible via CABLE Output monitor)
- [ ] PTT mode: hold button → speak Vietnamese → English TTS plays through CABLE Input
- [ ] Zoom: CABLE Output selected as mic → remote participant hears the TTS
- [ ] ElevenLabs TTS path works (different audio format, resampling path)
- [ ] Edge TTS path works
- [ ] Voicemeeter detected if installed

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/src/narration/virtual_mic.rs` | Added `KNOWN_VIRTUAL_DEVICES` for Windows; added `#[cfg(target_os = "windows")]` detection branch |
| `src/window/Monitor/components/NarrationPanel/index.jsx` | Fixed OS detection; added Windows install hint block; dynamic device name in checklist |
| `src/i18n/locales/en_US.json` | Added `narration_win_install_hint`, `narration_win_install_link`, `narration_win_zoom_hint` |
| `src/i18n/locales/vi_VN.json` | Same keys in Vietnamese |
