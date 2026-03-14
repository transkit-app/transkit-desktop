use crate::audio::microphone::MicCapture;
#[cfg(target_os = "macos")]
use crate::audio::system_audio::SystemAudioCapture;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::sync::{mpsc, Mutex};
use tauri::{State, Window};

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
        let batch_interval = std::time::Duration::from_millis(200);
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
