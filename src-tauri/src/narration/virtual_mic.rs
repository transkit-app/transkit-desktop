/// virtual_mic.rs — Virtual microphone management for Narration feature
///
/// Platform strategy:
///   macOS  — user installs BlackHole; we detect it via cpal device enumeration
///   Linux  — we create a PulseAudio null sink via `pactl` and output to it via cpal
///   Windows — not implemented yet (returns error)
///
/// Architecture:
///   VirtualMicHandle stores a cpal output stream (cpal::Stream is !Send).
///   It is held behind a Mutex<Option<VirtualMicHandle>> in NarrationState,
///   and all commands run on the main thread via Tauri — same pattern as MicCapture.
///
///   Audio injection is done via an Arc<Mutex<VecDeque<f32>>> shared between:
///     - narration_inject_audio command (pushes resampled f32 samples)
///     - cpal output callback (drains samples, writes silence when empty)
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

static NARRATION_INJECT_SEQ: AtomicU64 = AtomicU64::new(0);

/// Known virtual audio device names to auto-detect (macOS)
#[cfg(target_os = "macos")]
const KNOWN_VIRTUAL_DEVICES: &[&str] = &[
    "BlackHole 2ch",
    "BlackHole 16ch",
    "BlackHole",
    "Loopback Audio",
    "CABLE Input",
    "VB-Cable",
];

/// Name used when auto-creating the virtual sink on Linux
#[cfg(target_os = "linux")]
pub const LINUX_SINK_NAME: &str = "TranskitNarration";

pub struct VirtualMicHandle {
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    /// Shared audio buffer between inject API and cpal callback
    pub audio_buf: Arc<Mutex<VecDeque<f32>>>,
    /// Holds the cpal stream alive (dropping this stops audio)
    _stream: cpal::Stream,
    /// Linux: PulseAudio module index for cleanup on stop
    #[cfg(target_os = "linux")]
    pub pulse_module_index: Option<u32>,
}

// SAFETY: VirtualMicHandle is only accessed through Mutex in NarrationState.
// The cpal::Stream is created and dropped on the Tauri command thread.
// Same safety contract as MicCapture in audio/microphone.rs.
unsafe impl Send for VirtualMicHandle {}

// ── Device listing ────────────────────────────────────────────────────────────

pub fn list_output_devices() -> Vec<String> {
    cpal::default_host()
        .output_devices()
        .map(|devs| devs.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

pub fn detect_virtual_devices() -> Vec<String> {
    let all = list_output_devices();

    #[cfg(target_os = "macos")]
    return all
        .into_iter()
        .filter(|name| {
            KNOWN_VIRTUAL_DEVICES
                .iter()
                .any(|k| name.to_lowercase().contains(&k.to_lowercase()))
        })
        .collect();

    #[cfg(target_os = "linux")]
    return all
        .into_iter()
        .filter(|name| {
            name.to_lowercase().contains("transkit")
                || name.to_lowercase().contains("null")
                || name.to_lowercase().contains("virtual")
        })
        .collect();

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    vec![]
}

// ── Linux: PulseAudio virtual sink ───────────────────────────────────────────

#[cfg(target_os = "linux")]
pub fn create_linux_virtual_sink() -> Result<u32, String> {
    use std::process::Command;

    let output = Command::new("pactl")
        .args([
            "load-module",
            "module-null-sink",
            &format!("sink_name={LINUX_SINK_NAME}"),
            "sink_properties=device.description=Transkit\\ Narration\\ Mic",
        ])
        .output()
        .map_err(|e| format!("pactl not available: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pactl load-module failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let index: u32 = stdout
        .trim()
        .parse()
        .map_err(|_| format!("Failed to parse module index: {stdout}"))?;

    log::info!("[Narration] Linux: created PA null sink, module index={index}");
    Ok(index)
}

#[cfg(target_os = "linux")]
pub fn destroy_linux_virtual_sink(module_index: u32) {
    use std::process::Command;
    let _ = Command::new("pactl")
        .args(["unload-module", &module_index.to_string()])
        .output();
    log::info!("[Narration] Linux: unloaded PA module {module_index}");
}

// ── Audio stream ──────────────────────────────────────────────────────────────

/// Linear interpolation resampling — sufficient for speech
fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = ((input.len() as f64) / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let pos = i as f64 * ratio;
        let idx = pos as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(0.0);
        output.push(a + (b - a) * frac);
    }
    output
}

/// Duplicate mono samples to fill stereo channels
fn expand_channels(mono: Vec<f32>, channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return mono;
    }
    mono.iter()
        .flat_map(|&s| std::iter::repeat(s).take(channels as usize))
        .collect()
}

/// Open a cpal output stream on the named device and return a handle for injection.
pub fn start_virtual_mic_stream(device_name: &str) -> Result<VirtualMicHandle, String> {
    let host = cpal::default_host();

    let device = host
        .output_devices()
        .map_err(|e| format!("Failed to enumerate devices: {e}"))?
        .find(|d| d.name().ok().as_deref() == Some(device_name))
        .ok_or_else(|| format!("Output device '{}' not found", device_name))?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get output config: {e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    log::info!(
        "[Narration] Opening output stream on '{}': {}Hz {}ch {:?}",
        device_name,
        sample_rate,
        channels,
        config.sample_format()
    );

    let audio_buf: Arc<Mutex<VecDeque<f32>>> =
        Arc::new(Mutex::new(VecDeque::with_capacity(sample_rate as usize * 2)));

    let err_fn = |err| log::error!("[Narration] cpal output error: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let buf = audio_buf.clone();
            device
                .build_output_stream(
                    &config.into(),
                    move |data: &mut [f32], _| {
                        let mut b = buf.lock().unwrap();
                        for s in data.iter_mut() {
                            *s = b.pop_front().unwrap_or(0.0);
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("build_output_stream F32: {e}"))?
        }
        cpal::SampleFormat::I16 => {
            let buf = audio_buf.clone();
            device
                .build_output_stream(
                    &config.into(),
                    move |data: &mut [i16], _| {
                        let mut b = buf.lock().unwrap();
                        for s in data.iter_mut() {
                            let f = b.pop_front().unwrap_or(0.0);
                            *s = (f * 32767.0).clamp(-32768.0, 32767.0) as i16;
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("build_output_stream I16: {e}"))?
        }
        fmt => return Err(format!("Unsupported output sample format: {:?}", fmt)),
    };

    stream.play().map_err(|e| format!("stream.play(): {e}"))?;

    #[cfg(target_os = "linux")]
    return Ok(VirtualMicHandle {
        device_name: device_name.to_string(),
        sample_rate,
        channels,
        audio_buf,
        _stream: stream,
        pulse_module_index: None,
    });

    #[cfg(not(target_os = "linux"))]
    Ok(VirtualMicHandle {
        device_name: device_name.to_string(),
        sample_rate,
        channels,
        audio_buf,
        _stream: stream,
    })
}

/// Inject base64-encoded PCM16 mono audio into the virtual mic stream.
pub fn inject_pcm16(
    handle: &VirtualMicHandle,
    pcm16_base64: &str,
    source_sample_rate: u32,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let bytes = STANDARD
        .decode(pcm16_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;

    if bytes.len() % 2 != 0 {
        return Err("PCM16 byte length must be even".into());
    }

    // PCM16 LE bytes → f32
    let mut float_samples: Vec<f32> = bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();

    // Resample to device native rate
    float_samples = resample_linear(&float_samples, source_sample_rate, handle.sample_rate);

    // Expand mono → device channel count
    float_samples = expand_channels(float_samples, handle.channels);

    // Push to shared buffer (bounded to ~2s to avoid unbounded growth)
    let max = (handle.sample_rate as usize * 2) * handle.channels as usize;
    let mut buf = handle.audio_buf.lock().unwrap();
    if buf.len() < max {
        let injected_samples = float_samples.len();
        buf.extend(float_samples);
        let seq = NARRATION_INJECT_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        if seq <= 3 || seq % 10 == 0 {
            log::info!(
                "[NarrationDebug] inject ok #{}: in_rate={}Hz, out_rate={}Hz, pushed_samples={}, buffer_samples={}",
                seq,
                source_sample_rate,
                handle.sample_rate,
                injected_samples,
                buf.len()
            );
        }
    } else {
        log::warn!("[Narration] Audio buffer full ({} samples), dropping chunk", buf.len());
    }

    Ok(())
}
