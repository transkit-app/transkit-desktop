use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use super::TARGET_SAMPLE_RATE;

/// System audio capture on Linux via PulseAudio/PipeWire monitor source.
///
/// PulseAudio and PipeWire expose a virtual "monitor" input device for each
/// audio output sink (e.g. "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor").
/// Capturing from this device yields all system audio currently being played.
///
/// Requirements:
///   - PulseAudio or PipeWire must be running.
///   - The cpal backend must be built with the `alsa` or `jack` feature.
pub struct SystemAudioCapture {
    is_capturing: Arc<AtomicBool>,
}

impl SystemAudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start capturing system audio via the PulseAudio/PipeWire monitor source.
    /// Returns a receiver that yields PCM s16le 16kHz mono audio chunks.
    pub fn start(&self) -> Result<mpsc::Receiver<Vec<u8>>, String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err("Already capturing".to_string());
        }

        // Enumerate input devices and find a ".monitor" source.
        let host = cpal::default_host();
        let input_devices: Vec<_> = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate audio devices: {}", e))?
            .collect();

        let device_names: Vec<String> = input_devices
            .iter()
            .filter_map(|d| d.name().ok())
            .collect();
        println!("[SystemAudio/Linux] Available input devices: {:?}", device_names);

        let device = input_devices
            .into_iter()
            .find(|d| d.name().map(|n| n.contains(".monitor")).unwrap_or(false))
            .ok_or_else(|| {
                "No PulseAudio/PipeWire monitor source found. \
                 Ensure PulseAudio or PipeWire is running. \
                 Available devices: ".to_string()
                    + &device_names.join(", ")
            })?;

        println!(
            "[SystemAudio/Linux] Using monitor device: {:?}",
            device.name().unwrap_or_default()
        );

        let default_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get device config: {}", e))?;

        let source_rate = default_config.sample_rate().0;
        let source_channels = default_config.channels() as usize;
        let sample_format = default_config.sample_format();

        println!(
            "[SystemAudio/Linux] Config: rate={}, channels={}, format={:?}",
            source_rate, source_channels, sample_format
        );

        let stream_config = cpal::StreamConfig {
            channels: default_config.channels(),
            sample_rate: default_config.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        let is_capturing = self.is_capturing.clone();
        is_capturing.store(true, Ordering::SeqCst);

        // Spawn a dedicated thread to own the cpal::Stream (which is !Send).
        // The stream is created and lives entirely within this thread.
        std::thread::spawn(move || {
            // Clone sender/is_capturing for each match arm before they are moved.
            let sender_f32 = sender.clone();
            let is_cap_f32 = is_capturing.clone();
            let sender_i16 = sender;
            let is_cap_i16 = is_capturing.clone();

            let stream_result = match sample_format {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_cap_f32.load(Ordering::SeqCst) {
                            return;
                        }
                        let pcm = convert_f32_to_pcm_s16le(
                            data,
                            source_channels,
                            source_rate,
                            TARGET_SAMPLE_RATE,
                        );
                        if !pcm.is_empty() {
                            let _ = sender_f32.send(pcm);
                        }
                    },
                    |err| eprintln!("[SystemAudio/Linux] Stream error: {}", err),
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !is_cap_i16.load(Ordering::SeqCst) {
                            return;
                        }
                        let pcm = convert_i16_to_pcm_s16le(
                            data,
                            source_channels,
                            source_rate,
                            TARGET_SAMPLE_RATE,
                        );
                        if !pcm.is_empty() {
                            let _ = sender_i16.send(pcm);
                        }
                    },
                    |err| eprintln!("[SystemAudio/Linux] Stream error: {}", err),
                    None,
                ),
                format => {
                    eprintln!("[SystemAudio/Linux] Unsupported sample format: {:?}", format);
                    is_capturing.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let stream = match stream_result {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[SystemAudio/Linux] Failed to build audio stream: {}", e);
                    is_capturing.store(false, Ordering::SeqCst);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                eprintln!("[SystemAudio/Linux] Failed to start audio stream: {}", e);
                is_capturing.store(false, Ordering::SeqCst);
                return;
            }

            println!("[SystemAudio/Linux] Monitor capture started.");

            // Keep the thread (and stream) alive while capturing.
            while is_capturing.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            // stream is dropped here, stopping capture
            println!("[SystemAudio/Linux] Monitor capture stopped.");
        });

        Ok(receiver)
    }

    pub fn stop(&self) {
        self.is_capturing.store(false, Ordering::SeqCst);
    }

    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }
}

impl Default for SystemAudioCapture {
    fn default() -> Self {
        Self::new()
    }
}

fn convert_f32_to_pcm_s16le(
    data: &[f32],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Vec<u8> {
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    let resampled = if source_rate != target_rate {
        simple_resample(&mono, source_rate, target_rate)
    } else {
        mono
    };

    resampled
        .iter()
        .flat_map(|&s| {
            let s16 = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            s16.to_le_bytes()
        })
        .collect()
}

fn convert_i16_to_pcm_s16le(
    data: &[i16],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Vec<u8> {
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| {
                let sum: f32 = frame.iter().map(|&s| s as f32).sum();
                sum / (channels as f32 * 32768.0)
            })
            .collect()
    } else {
        data.iter().map(|&s| s as f32 / 32768.0).collect()
    };

    let resampled = if source_rate != target_rate {
        simple_resample(&mono, source_rate, target_rate)
    } else {
        mono
    };

    resampled
        .iter()
        .flat_map(|&s| {
            let s16 = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            s16.to_le_bytes()
        })
        .collect()
}

fn simple_resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;

        if src_idx + 1 < samples.len() {
            let s = samples[src_idx] as f64 * (1.0 - frac)
                + samples[src_idx + 1] as f64 * frac;
            output.push(s as f32);
        } else if src_idx < samples.len() {
            output.push(samples[src_idx]);
        }
    }

    output
}
