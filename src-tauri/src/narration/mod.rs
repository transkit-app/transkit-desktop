/// narration/mod.rs — Tauri state and commands for Narration / Spoken Translation
///
/// Tauri commands exposed:
///   narration_list_devices()      → Vec<String>  (all output devices)
///   narration_detect_devices()    → Vec<String>  (known virtual devices only)
///   narration_setup(device_name)  → ()           (Linux: auto-creates PA sink)
///   narration_start(device_name)  → ()           (opens cpal output stream)
///   narration_inject_audio(...)   → ()           (pushes PCM16 to stream)
///   narration_stop()              → ()           (stops stream + cleanup)
///   narration_get_status()        → NarrationStatus
mod virtual_mic;

use serde::Serialize;
#[cfg(target_os = "linux")]
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::State;
use virtual_mic::{
    detect_virtual_devices, inject_pcm16, list_output_devices, start_virtual_mic_stream,
    VirtualMicHandle,
};

// ── State ────────────────────────────────────────────────────────────────────

/// Managed state for the narration feature.
/// Held behind a Mutex; all commands acquire and release quickly.
pub struct NarrationState {
    pub handle: Mutex<Option<VirtualMicHandle>>,
}

impl NarrationState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

// ── Return types ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct NarrationStatus {
    pub active: bool,
    pub device_name: Option<String>,
    pub sample_rate: Option<u32>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// List all audio output devices on this system.
#[tauri::command]
pub fn narration_list_devices() -> Vec<String> {
    list_output_devices()
}

/// List known virtual audio devices (BlackHole, PulseAudio null sink, etc.)
#[tauri::command]
pub fn narration_detect_devices() -> Vec<String> {
    detect_virtual_devices()
}

/// Setup the virtual microphone.
///
/// macOS: validates that the device exists (user must have BlackHole installed).
/// Linux: auto-creates a PulseAudio null sink named "TranskitNarration" if not
///        already present, then refreshes the device list.
/// Both: returns the device name to use in narration_start().
#[tauri::command]
pub fn narration_setup(_state: State<'_, NarrationState>, device_name: String) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        if device_name.is_empty() {
            // Auto-create the PA null sink
            let module_index = virtual_mic::create_linux_virtual_sink()?;
            // Give PulseAudio a moment to register the device with ALSA
            std::thread::sleep(std::time::Duration::from_millis(500));

            // Find the new device in the device list
            let devices = list_output_devices();
            log::info!("[Narration] Available output devices after PA sink creation: {:?}", devices);
            let found = devices
                .into_iter()
                .find(|d| {
                    d.to_lowercase().contains("transkit")
                        || d.to_lowercase().contains("null")
                })
                .ok_or("PulseAudio sink created but not visible to cpal yet. Try again.")?;

            // Store module index for cleanup
            let mut guard = state.handle.lock().unwrap();
            if let Some(ref mut h) = *guard {
                #[cfg(target_os = "linux")]
                {
                    h.pulse_module_index = Some(module_index);
                }
            } else {
                // Create a minimal placeholder handle just to store the module index
                // The actual stream starts on narration_start
                drop(guard);
                // We store module_index separately in Linux via a global or re-creating on start
                // For simplicity: store as a thread-local side-channel
                LINUX_MODULE_INDEX.store(module_index, Ordering::SeqCst);
            }

            return Ok(found);
        }
    }

    // macOS / Windows / named device on Linux: just verify the device exists
    let devices = list_output_devices();
    if !devices.contains(&device_name) {
        return Err(format!(
            "Device '{}' not found. Available: {:?}",
            device_name, devices
        ));
    }
    Ok(device_name)
}

/// Linux only: stores the PA module index so we can clean it up later
#[cfg(target_os = "linux")]
static LINUX_MODULE_INDEX: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(u32::MAX);

/// Start the virtual mic audio stream.
/// Must be called after narration_setup().
/// Calling while already active is a no-op (returns Ok).
#[tauri::command]
pub fn narration_start(
    state: State<'_, NarrationState>,
    device_name: String,
) -> Result<(), String> {
    let mut guard = state.handle.lock().unwrap();

    if guard.is_some() {
        // Already running — stop old stream first
        drop_handle(guard.take());
    }

    let mut handle = start_virtual_mic_stream(&device_name)?;

    #[cfg(target_os = "linux")]
    {
        let idx = LINUX_MODULE_INDEX.load(Ordering::SeqCst);
        if idx != u32::MAX {
            handle.pulse_module_index = Some(idx);
        }
    }

    log::info!(
        "[Narration] Started on '{}' @ {}Hz {}ch",
        handle.device_name, handle.sample_rate, handle.channels
    );

    *guard = Some(handle);
    Ok(())
}

/// Inject a chunk of PCM16 audio into the virtual mic stream.
/// pcm16_base64: base64-encoded signed 16-bit little-endian PCM, mono
/// sample_rate: sample rate of the encoded audio (e.g. 24000 for edge_tts)
#[tauri::command]
pub fn narration_inject_audio(
    state: State<'_, NarrationState>,
    pcm16_base64: String,
    sample_rate: u32,
) -> Result<(), String> {
    log::info!(
        "[NarrationDebug] inject request: sample_rate={}Hz, base64_len={}",
        sample_rate,
        pcm16_base64.len()
    );
    let guard = state.handle.lock().unwrap();
    match guard.as_ref() {
        Some(handle) => {
            let result = inject_pcm16(handle, &pcm16_base64, sample_rate);
            if let Err(err) = &result {
                log::warn!("[NarrationDebug] inject failed: {}", err);
            }
            result
        }
        None => {
            log::warn!("[NarrationDebug] inject dropped: narration not started");
            Err("Narration not started".into())
        }
    }
}

/// Stop the virtual mic audio stream and clean up resources.
#[tauri::command]
pub fn narration_stop(state: State<'_, NarrationState>) -> Result<(), String> {
    let mut guard = state.handle.lock().unwrap();
    drop_handle(guard.take());
    log::info!("[Narration] Stopped");
    Ok(())
}

/// Get current narration status.
#[tauri::command]
pub fn narration_get_status(state: State<'_, NarrationState>) -> NarrationStatus {
    let guard = state.handle.lock().unwrap();
    match guard.as_ref() {
        Some(h) => NarrationStatus {
            active: true,
            device_name: Some(h.device_name.clone()),
            sample_rate: Some(h.sample_rate),
        },
        None => NarrationStatus {
            active: false,
            device_name: None,
            sample_rate: None,
        },
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn drop_handle(handle: Option<VirtualMicHandle>) {
    if let Some(h) = handle {
        // Dropping VirtualMicHandle drops _stream, which stops the cpal stream
        // Linux: clean up the PulseAudio null sink
        #[cfg(target_os = "linux")]
        if let Some(idx) = h.pulse_module_index {
            virtual_mic::destroy_linux_virtual_sink(idx);
            LINUX_MODULE_INDEX.store(u32::MAX, Ordering::SeqCst);
        }
        drop(h);
    }
}
