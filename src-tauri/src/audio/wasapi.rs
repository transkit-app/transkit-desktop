//! WASAPI loopback audio capture for Transkit on Windows.
//!
//! Taps the system's default render endpoint (speakers / headphones) in
//! shared-mode loopback so Transkit can transcribe whatever audio is playing
//! without requiring any virtual audio driver or third-party software.
//!
//! Output format matches the rest of the Transkit audio pipeline:
//! PCM s16le, 16 kHz, mono — ready for Soniox.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};

use super::TARGET_SAMPLE_RATE;

// ── Public handle ─────────────────────────────────────────────────────────────

pub struct SystemAudioCapture {
    is_capturing: Arc<AtomicBool>,
}

impl SystemAudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Begin loopback capture.
    /// Returns a channel receiver that yields PCM s16le 16 kHz mono chunks.
    pub fn start(&self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        // swap returns the *old* value; if it was already true, bail out.
        if self.is_capturing.swap(true, Ordering::SeqCst) {
            return Err("Loopback capture is already running".to_string());
        }

        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let flag = self.is_capturing.clone();

        std::thread::Builder::new()
            .name("transkit-wasapi-loopback".into())
            .spawn(move || {
                if let Err(e) = run_capture_loop(tx, &flag) {
                    log::error!("[WasapiLoopback] Fatal error: {}", e);
                }
                // Always reset the flag so callers can restart cleanly.
                flag.store(false, Ordering::SeqCst);
                log::info!("[WasapiLoopback] Capture thread exiting.");
            })
            .map_err(|e| format!("Failed to spawn loopback thread: {}", e))?;

        Ok(rx)
    }

    pub fn stop(&self) {
        self.is_capturing.store(false, Ordering::SeqCst);
    }

    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::Relaxed)
    }
}

impl Default for SystemAudioCapture {
    fn default() -> Self {
        Self::new()
    }
}

// ── Capture loop ──────────────────────────────────────────────────────────────

/// Initialises COM, delegates to the unsafe inner loop, then cleans up.
fn run_capture_loop(tx: mpsc::Sender<Vec<u8>>, flag: &AtomicBool) -> Result<(), String> {
    use windows::Win32::System::Com::*;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let result = capture_inner(tx, flag);
        CoUninitialize();
        result
    }
}

/// Core WASAPI setup and packet loop.
/// Uses `?` throughout so each step fails fast with a clear message.
unsafe fn capture_inner(tx: mpsc::Sender<Vec<u8>>, flag: &AtomicBool) -> Result<(), String> {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    // ── Enumerate and open the default render endpoint ────────────────────
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator): {}", e))?;

    let endpoint = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|e| format!("GetDefaultAudioEndpoint: {}", e))?;

    let client: IAudioClient = endpoint
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("IAudioClient activate: {}", e))?;

    // ── Query native device format ────────────────────────────────────────
    let fmt_ptr = client
        .GetMixFormat()
        .map_err(|e| format!("GetMixFormat: {}", e))?;
    let fmt = &*fmt_ptr;

    let src_rate = fmt.nSamplesPerSec;
    let src_channels = fmt.nChannels as usize;
    let bits = fmt.wBitsPerSample;

    // ── Initialise in shared-mode loopback ────────────────────────────────
    // 200 ms buffer (2 000 000 × 100 ns units) — small enough for real-time
    // transcription latency, large enough to survive brief scheduler delays.
    client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            2_000_000,
            0,
            fmt_ptr,
            None,
        )
        .map_err(|e| format!("IAudioClient::Initialize (loopback): {}", e))?;

    let capture: IAudioCaptureClient = client
        .GetService()
        .map_err(|e| format!("IAudioClient::GetService: {}", e))?;

    client
        .Start()
        .map_err(|e| format!("IAudioClient::Start: {}", e))?;

    log::info!(
        "[WasapiLoopback] Loopback started — device format: {}Hz / {}ch / {}bit",
        src_rate, src_channels, bits
    );

    // ── Packet loop ───────────────────────────────────────────────────────
    loop {
        if !flag.load(Ordering::Relaxed) {
            break;
        }

        // Poll at 10 ms intervals; WASAPI accumulates frames between polls.
        std::thread::sleep(std::time::Duration::from_millis(10));

        let available = match capture.GetNextPacketSize() {
            Ok(0) => continue,
            Ok(n) => n,
            Err(_) => continue,
        };

        let mut buf_ptr = std::ptr::null_mut();
        let mut n_frames = 0u32;
        let mut flags = 0u32;

        if capture
            .GetBuffer(&mut buf_ptr, &mut n_frames, &mut flags, None, None)
            .is_err()
        {
            continue;
        }

        // Skip silent packets (e.g. system is idle) to avoid sending noise.
        let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;

        let pcm = if n_frames > 0 && !buf_ptr.is_null() && !is_silent {
            decode_and_convert(buf_ptr, n_frames, src_rate, src_channels, bits)
        } else {
            Vec::new()
        };

        let _ = capture.ReleaseBuffer(n_frames);
        let _ = available; // size was validated implicitly via GetBuffer

        if !pcm.is_empty() && tx.send(pcm).is_err() {
            log::debug!("[WasapiLoopback] Receiver dropped — stopping capture.");
            break;
        }
    }

    let _ = client.Stop();
    Ok(())
}

// ── Audio conversion helpers ──────────────────────────────────────────────────

/// Decode a raw WASAPI frame buffer and convert to PCM s16le 16 kHz mono.
///
/// Handles both formats that WASAPI commonly delivers:
///   • 32-bit IEEE float  (most devices in shared mode)
///   • 16-bit signed int  (some USB audio / virtual devices)
unsafe fn decode_and_convert(
    buf: *mut u8,
    n_frames: u32,
    src_rate: u32,
    src_channels: usize,
    bits: u16,
) -> Vec<u8> {
    let total_samples = n_frames as usize * src_channels;

    let mono: Vec<f32> = match bits {
        32 => {
            let slice = std::slice::from_raw_parts(buf as *const f32, total_samples);
            mix_to_mono(slice, src_channels)
        }
        16 => {
            let slice = std::slice::from_raw_parts(buf as *const i16, total_samples);
            let as_f32: Vec<f32> = slice.iter().map(|&s| s as f32 / 32_768.0).collect();
            mix_to_mono(&as_f32, src_channels)
        }
        other => {
            log::warn!("[WasapiLoopback] Unhandled bit depth {}; skipping packet", other);
            return Vec::new();
        }
    };

    resample_to_s16le(&mono, src_rate, TARGET_SAMPLE_RATE)
}

/// Downmix an interleaved multi-channel buffer to mono by averaging all channels.
/// This preserves energy better than dropping channels, which matters when the
/// content being transcribed is panned or comes from a surround stream.
fn mix_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Resample a mono f32 stream to `to_hz` and encode as little-endian s16 bytes.
/// Linear interpolation gives adequate quality for speech-band audio (≤ 8 kHz).
fn resample_to_s16le(mono: &[f32], from_hz: u32, to_hz: u32) -> Vec<u8> {
    if mono.is_empty() {
        return Vec::new();
    }

    if from_hz == to_hz {
        return mono
            .iter()
            .flat_map(|&s| ((s.clamp(-1.0, 1.0) * 32_767.0) as i16).to_le_bytes())
            .collect();
    }

    let ratio = from_hz as f64 / to_hz as f64;
    let out_frames = (mono.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_frames * 2);

    for i in 0..out_frames {
        let pos = i as f64 * ratio;
        let idx = pos as usize;
        let frac = pos - idx as f64;

        let s = if idx + 1 < mono.len() {
            mono[idx] as f64 * (1.0 - frac) + mono[idx + 1] as f64 * frac
        } else if idx < mono.len() {
            mono[idx] as f64
        } else {
            break;
        };

        let s16 = (s.clamp(-1.0, 1.0) * 32_767.0) as i16;
        out.extend_from_slice(&s16.to_le_bytes());
    }

    out
}
