pub mod microphone;
#[cfg(target_os = "macos")]
pub mod system_audio;

/// Target audio format for Soniox: PCM s16le, 16kHz, mono
pub const TARGET_SAMPLE_RATE: u32 = 16000;
#[allow(dead_code)]
pub const TARGET_CHANNELS: u16 = 1;
