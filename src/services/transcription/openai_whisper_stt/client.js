/**
 * OpenAI Whisper STT Client (stub)
 *
 * Note: Whisper is a batch transcription API and does not natively support
 * real-time streaming. This client accumulates audio and sends it in chunks,
 * which introduces latency but works for near-real-time use cases.
 *
 * Chunk interval is controlled by `chunkIntervalMs` in config (default 5000ms).
 */

import { fetch, Body, ResponseType } from '@tauri-apps/api/http';

const DEFAULT_CHUNK_INTERVAL_MS = 5000;

export class OpenAIWhisperClient {
    constructor() {
        this._config = null;
        this._audioBuffer = [];
        this._chunkTimer = null;
        this._intentionalDisconnect = false;
        this.isConnected = false;

        // Callbacks
        this.onOriginal = null;
        this.onTranslation = null;
        this.onProvisional = null;
        this.onStatusChange = null;
        this.onError = null;
        this.onReconnect = null;
    }

    connect(config) {
        const { apiKey, serverUrl } = config;
        if (!apiKey && !serverUrl) {
            this._setStatus('error');
            this.onError?.('API key is required. Please add it in Settings.');
            return;
        }

        this._config = config;
        this._intentionalDisconnect = false;
        this._audioBuffer = [];
        this.isConnected = true;
        this._setStatus('connected');

        const interval = config.chunkIntervalMs ?? DEFAULT_CHUNK_INTERVAL_MS;
        this._chunkTimer = setInterval(() => this._flushBuffer(), interval);
    }

    sendAudio(pcmData) {
        if (!this.isConnected || this._intentionalDisconnect) return;
        // Accumulate PCM chunks
        this._audioBuffer.push(new Uint8Array(pcmData));
    }

    async _flushBuffer() {
        if (this._audioBuffer.length === 0 || this._intentionalDisconnect) return;

        const chunks = this._audioBuffer.splice(0);
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        this.onProvisional?.('…');

        try {
            const { apiKey, serverUrl, model } = this._config;
            const baseUrl = (serverUrl ?? 'https://api.openai.com').replace(/\/+$/, '');

            // Build WAV header for 16-bit PCM, 16000 Hz, mono
            const wavData = this._buildWav(combined);
            const b64 = this._toBase64(wavData);

            const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
                body: Body.form({
                    file: {
                        file: b64,
                        mime: 'audio/wav',
                        fileName: 'audio.wav',
                    },
                    model: model ?? 'whisper-1',
                    response_format: 'json',
                }),
                responseType: ResponseType.JSON,
                timeout: 30,
            });

            if (res.ok && res.data?.text?.trim()) {
                const text = res.data.text.trim();
                this.onOriginal?.(text, null);
                this.onTranslation?.(text);
                this.onProvisional?.('');
            } else if (!res.ok) {
                this.onError?.(`Whisper API error: ${res.status}`);
                this.onProvisional?.('');
            }
        } catch (err) {
            console.error('[Whisper] Flush error:', err);
            this.onError?.(`Whisper error: ${err.message}`);
            this.onProvisional?.('');
        }
    }

    disconnect() {
        this._intentionalDisconnect = true;
        if (this._chunkTimer) {
            clearInterval(this._chunkTimer);
            this._chunkTimer = null;
        }
        this._audioBuffer = [];
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    finalize() {
        this._flushBuffer();
    }

    /** Build a minimal WAV header around raw PCM s16le data */
    _buildWav(pcmBytes) {
        const sampleRate = 16000;
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcmBytes.length;
        const headerSize = 44;
        const wav = new Uint8Array(headerSize + dataSize);
        const view = new DataView(wav.buffer);

        // RIFF chunk
        wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
        view.setUint32(4, 36 + dataSize, true);
        wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
        // fmt sub-chunk
        wav.set([0x66, 0x6D, 0x74, 0x20], 12); // "fmt "
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        // data sub-chunk
        wav.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
        view.setUint32(40, dataSize, true);
        wav.set(pcmBytes, 44);

        return wav;
    }

    _toBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
