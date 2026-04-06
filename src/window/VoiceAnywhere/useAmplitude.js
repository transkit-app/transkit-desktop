import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * Listens for `audio_chunk` events emitted by the Rust audio capture pipeline
 * and computes a normalised RMS amplitude (0 – 1).
 *
 * Returns `amplitude` (number 0–1) for driving the FAB frequency-bar animation.
 * Only active while `active` is true so we don't waste CPU when not recording.
 */
export function useAmplitude(active) {
    const [amplitude, setAmplitude] = useState(0);
    const unlistenRef = useRef(null);

    useEffect(() => {
        if (!active) {
            setAmplitude(0);
            return;
        }

        let mounted = true;

        listen('audio_chunk', ({ payload }) => {
            if (!mounted) return;
            try {
                // payload is base64-encoded PCM s16le
                const binary = atob(payload);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                // Interpret as Int16 samples
                const samples = new Int16Array(bytes.buffer);
                let sum = 0;
                for (let i = 0; i < samples.length; i++) {
                    sum += samples[i] * samples[i];
                }
                const rms = Math.sqrt(sum / (samples.length || 1));
                // 8000 is a practical peak for speech at 16kHz, clamp to [0, 1]
                setAmplitude(Math.min(1, rms / 8000));
            } catch {
                // ignore decode errors
            }
        }).then((fn) => {
            unlistenRef.current = fn;
        });

        return () => {
            mounted = false;
            unlistenRef.current?.();
            unlistenRef.current = null;
            setAmplitude(0);
        };
    }, [active]);

    return amplitude;
}
