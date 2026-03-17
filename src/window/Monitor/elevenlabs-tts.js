/**
 * ElevenLabsTTS — HTTP-based TTS via ElevenLabs REST API.
 *
 * Uses POST /v1/text-to-speech/{voice_id}/stream routed through Tauri's Rust
 * HTTP client (tauriFetch) instead of a native WebSocket.
 *
 * Why HTTP instead of WebSocket?
 *   On macOS WKWebView (Tauri), native WebSocket connections to external WSS
 *   hosts can fail with "Socket is not connected" (POSIX ENOTCONN) due to
 *   WKWebView's network stack limitations.  tauriFetch bypasses WKWebView and
 *   goes directly through the Rust/reqwest HTTP client, which is reliable.
 *
 * Public API (compatible with the old WS version used by TTSQueue):
 *   synthesize(text) → Promise<ArrayBuffer>   MP3 data for `text`
 *   connect()                                 no-op (HTTP is stateless)
 *   stop()                                    no-op
 *   updateConfig({ apiKey, voiceId, modelId })
 */
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';

const API_ENDPOINT  = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const DEFAULT_VOICE = 'FTYCiQT21H9XQvhRu0ch'; // MinhTrung (male Vietnamese)
const OUTPUT_FORMAT = 'mp3_44100_128';

export class ElevenLabsTTS {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey
     * @param {string} [opts.voiceId]
     * @param {string} [opts.modelId]
     */
    constructor({ apiKey, voiceId = DEFAULT_VOICE, modelId = DEFAULT_MODEL } = {}) {
        this.apiKey  = apiKey;
        this.voiceId = voiceId;
        this.modelId = modelId;
    }

    /** Update config (e.g. when user changes settings). */
    updateConfig({ apiKey, voiceId, modelId } = {}) {
        if (apiKey  !== undefined) this.apiKey  = apiKey;
        if (voiceId !== undefined) this.voiceId = voiceId;
        if (modelId !== undefined) this.modelId = modelId;
    }

    /** No-op — HTTP is stateless, no persistent connection needed. */
    connect() {}

    /**
     * Synthesize `text` and return a Promise<ArrayBuffer> with MP3 data.
     * Routed via Tauri's Rust HTTP client so it works on macOS WKWebView.
     *
     * @param {string} text
     * @returns {Promise<ArrayBuffer>}
     */
    async synthesize(text) {
        if (!text?.trim()) return new ArrayBuffer(0);
        if (!this.apiKey) throw new Error('ElevenLabs: no API key configured');

        const res = await tauriFetch(
            `${API_ENDPOINT}/${this.voiceId}/stream`,
            {
                method:       'POST',
                headers:      { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
                body:         Body.json({ text, model_id: this.modelId, output_format: OUTPUT_FORMAT }),
                responseType: ResponseType.Binary,
                timeout:      30,
            },
        );

        if (res.status >= 400) throw new Error(`ElevenLabs HTTP ${res.status}`);

        return new Uint8Array(res.data).buffer;
    }

    /** No-op — HTTP requests can't be cancelled mid-flight. */
    stop() {}
}
