use crate::audio::microphone::MicCapture;
#[cfg(target_os = "macos")]
use crate::audio::system_audio::SystemAudioCapture;
use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{State, Window};

// ── Native TTS playback (in-process via rodio/cpal) ───────────────────────
//
// We play audio entirely inside the Tauri process so macOS sandbox/entitlement
// restrictions that apply to spawned subprocesses don't affect us.
// cpal is already a dependency; rodio gives us a high-level WAV decoder on top.
//
// Architecture: one long-lived audio thread owns the rodio OutputStream (which
// is !Send on macOS because cpal::Stream is !Send).  All play requests are sent
// to that thread via a channel.  Stopping is done via an AtomicBool flag.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

struct AudioRequest {
    data: Vec<u8>,
    reply: mpsc::SyncSender<Result<(), String>>,
}

static AUDIO_TX: Lazy<Mutex<Option<mpsc::Sender<AudioRequest>>>> =
    Lazy::new(|| Mutex::new(None));

static STOP_FLAG: Lazy<std::sync::Arc<AtomicBool>> =
    Lazy::new(|| std::sync::Arc::new(AtomicBool::new(false)));

fn get_audio_tx() -> Result<mpsc::Sender<AudioRequest>, String> {
    let mut guard = AUDIO_TX.lock().unwrap();

    if let Some(tx) = guard.as_ref() {
        return Ok(tx.clone());
    }

    // Spawn the dedicated audio thread
    let (tx, rx) = mpsc::channel::<AudioRequest>();
    let stop_flag = STOP_FLAG.clone();

    std::thread::Builder::new()
        .name("tts-audio".into())
        .spawn(move || {
            use rodio::{Decoder, OutputStream, Sink};
            use std::io::Cursor;

            let (_stream, stream_handle) = match OutputStream::try_default() {
                Ok(s) => s,
                Err(e) => {
                    log::error!("[TTS] Failed to open audio output: {}", e);
                    return;
                }
            };
            log::info!("[TTS] Audio thread started");

            for req in rx {
                stop_flag.store(false, Ordering::SeqCst);

                let sink = match Sink::try_new(&stream_handle) {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = req.reply.send(Err(e.to_string()));
                        continue;
                    }
                };

                let cursor = Cursor::new(req.data);
                match Decoder::new(cursor) {
                    Ok(source) => {
                        sink.append(source);
                        // Poll instead of sleep_until_end() so stop_flag is respected
                        while !sink.empty() {
                            if stop_flag.load(Ordering::SeqCst) {
                                sink.stop();
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(40));
                        }
                        let _ = req.reply.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = req.reply.send(Err(format!("Decode failed: {}", e)));
                    }
                }
            }

            log::info!("[TTS] Audio thread exiting");
        })
        .map_err(|e| e.to_string())?;

    *guard = Some(tx.clone());
    Ok(tx)
}

/// Wrap raw PCM bytes in a WAV header (16-bit, mono, 24 kHz by default).
fn ensure_wav(data: Vec<u8>) -> Vec<u8> {
    if data.len() >= 4 && &data[0..4] == b"RIFF" {
        return data; // already a WAV file
    }
    // Treat as raw 16-bit signed PCM, mono, 24000 Hz
    let channels: u16 = 1;
    let sample_rate: u32 = 24000;
    let bits: u16 = 32; // neural TTS outputs 32-bit float
    let byte_rate = sample_rate * channels as u32 * bits as u32 / 8;
    let block_align = channels * bits / 8;
    let data_size = data.len() as u32;
    let mut wav = Vec::with_capacity(44 + data.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&3u16.to_le_bytes()); // IEEE float (3)
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(&data);
    wav
}

/// Receive WAV (or raw PCM) bytes from JS and play in-process via rodio.
/// Blocks (on the Tauri async thread-pool) until playback finishes.
#[tauri::command]
pub async fn play_audio_bytes(data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let tx = get_audio_tx()?;
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        tx.send(AudioRequest { data: ensure_wav(data), reply: reply_tx })
            .map_err(|_| "Audio thread disconnected".to_string())?;
        reply_rx.recv().map_err(|_| "No reply from audio thread".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop the currently playing audio immediately.
#[tauri::command]
pub fn stop_audio_playback() {
    STOP_FLAG.store(true, Ordering::SeqCst);
}

pub struct AudioState {
    pub microphone: Mutex<MicCapture>,
    #[cfg(target_os = "macos")]
    pub system_audio: Mutex<SystemAudioCapture>,
    pub stop_flag: Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

#[derive(Serialize, Clone)]
pub struct AudioCapabilities {
    pub system_audio: bool,
    pub microphone: bool,
}

#[tauri::command]
pub fn get_audio_capabilities() -> AudioCapabilities {
    AudioCapabilities {
        #[cfg(target_os = "macos")]
        system_audio: true,
        #[cfg(not(target_os = "macos"))]
        system_audio: false,
        microphone: true,
    }
}

#[tauri::command]
pub fn start_audio_capture(
    source: String,
    window: Window,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    // Stop any existing capture first
    stop_capture_inner(&state);

    let receiver: mpsc::Receiver<Vec<u8>> = match source.as_str() {
        "microphone" => {
            let mut mic = state.microphone.lock().map_err(|e| e.to_string())?;
            mic.start()?
        }
        #[cfg(target_os = "macos")]
        "system" => {
            let sys = state.system_audio.lock().map_err(|e| e.to_string())?;
            sys.start()?
        }
        _ => {
            return Err(format!(
                "Unsupported audio source '{}'. System audio capture is only available on macOS.",
                source
            ))
        }
    };

    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    std::thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::with_capacity(32000); // ~1 sec at 16kHz s16le
        let batch_interval = std::time::Duration::from_millis(100);
        let mut last_flush = std::time::Instant::now();

        loop {
            if stop_flag_clone.load(std::sync::atomic::Ordering::SeqCst) {
                if !buffer.is_empty() {
                    let encoded = STANDARD.encode(&buffer);
                    let _ = window.emit("audio_chunk", encoded);
                }
                break;
            }

            match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                Ok(data) => {
                    buffer.extend_from_slice(&data);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !buffer.is_empty() {
                        let encoded = STANDARD.encode(&buffer);
                        let _ = window.emit("audio_chunk", encoded);
                    }
                    break;
                }
            }

            if last_flush.elapsed() >= batch_interval && !buffer.is_empty() {
                let encoded = STANDARD.encode(&buffer);
                if window.emit("audio_chunk", encoded).is_err() {
                    break;
                }
                buffer.clear();
                last_flush = std::time::Instant::now();
            }
        }
    });

    let mut flag_guard = state.stop_flag.lock().map_err(|e| e.to_string())?;
    *flag_guard = Some(stop_flag);

    Ok(())
}

#[tauri::command]
pub fn stop_audio_capture(state: State<'_, AudioState>) -> Result<(), String> {
    stop_capture_inner(&state);
    Ok(())
}

fn stop_capture_inner(state: &AudioState) {
    if let Ok(mut flag) = state.stop_flag.lock() {
        if let Some(f) = flag.take() {
            f.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(sys) = state.system_audio.lock() {
        sys.stop();
    }
    if let Ok(mut mic) = state.microphone.lock() {
        mic.stop();
    }
}
