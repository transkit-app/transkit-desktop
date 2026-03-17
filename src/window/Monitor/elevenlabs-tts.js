/**
 * ElevenLabsTTS — supports two connection modes:
 *
 *   'wss'  — persistent WebSocket (stream-input API)
 *            Best for v2 models (eleven_flash_v2_5, eleven_multilingual_v2).
 *            Low latency: BOS sent once, text sent immediately per request.
 *
 *   'http' — HTTP POST per request via Tauri Rust client (tauriFetch)
 *            Required for v3 models (eleven_v3) and as a reliable fallback.
 *            Higher latency: full round-trip per sentence.
 *
 * Public API (same regardless of mode):
 *   synthesize(text) → Promise<ArrayBuffer>   MP3 bytes
 *   connect()                                 pre-warm WS (wss mode only)
 *   stop()                                    cancel in-flight, close WS
 *   updateConfig({ apiKey, voiceId, modelId, mode })
 */
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';

const DEFAULT_VOICE   = 'FTYCiQT21H9XQvhRu0ch';
const DEFAULT_MODEL   = 'eleven_flash_v2_5';
const OUTPUT_FORMAT   = 'mp3_44100_128';
const WSS_BASE        = 'wss://api.elevenlabs.io/v1/text-to-speech';
const HTTP_BASE       = 'https://api.elevenlabs.io/v1/text-to-speech';
const RECONNECT_DELAY = 1000;
const IDLE_TIMEOUT_MS = 350; // resolve after this many ms of silence post-last-chunk

export class ElevenLabsTTS {
    constructor({ apiKey, voiceId = DEFAULT_VOICE, modelId = DEFAULT_MODEL, mode = 'wss' } = {}) {
        this.apiKey  = apiKey;
        this.voiceId = voiceId;
        this.modelId = modelId;
        this.mode    = mode; // 'wss' | 'http'

        // ── WebSocket state (wss mode) ──────────────────────────────────────
        this._ws        = null;
        this._connected = false;
        this._session   = 0;   // incremented on every _openWS() to invalidate stale callbacks
        this._queue     = [];  // { text, resolve, reject, chunks, idleTimer }
        this._active    = null;
    }

    updateConfig({ apiKey, voiceId, modelId, mode } = {}) {
        const credChanged =
            (apiKey  !== undefined && apiKey  !== this.apiKey)  ||
            (voiceId !== undefined && voiceId !== this.voiceId) ||
            (modelId !== undefined && modelId !== this.modelId) ||
            (mode    !== undefined && mode    !== this.mode);

        if (apiKey  !== undefined) this.apiKey  = apiKey;
        if (voiceId !== undefined) this.voiceId = voiceId;
        if (modelId !== undefined) this.modelId = modelId;
        if (mode    !== undefined) this.mode    = mode;

        if (credChanged) this._closeWS();
    }

    /** No-op — lazy connection on first synthesize(). */
    connect() {}

    /**
     * Synthesize text → Promise<ArrayBuffer> (MP3).
     * Routes to HTTP or WebSocket based on this.mode.
     */
    synthesize(text) {
        if (!text?.trim()) return Promise.resolve(new ArrayBuffer(0));
        if (!this.apiKey)  return Promise.reject(new Error('ElevenLabs: no API key'));

        if (this.mode === 'http') return this._synthesizeHTTP(text.trim());
        return this._synthesizeWS(text.trim());
    }

    stop() {
        this._queue.forEach(item => {
            this._clearIdleTimer(item);
            item.reject(new Error('stopped'));
        });
        this._queue = [];

        if (this._active) {
            this._clearIdleTimer(this._active);
            this._active.reject(new Error('stopped'));
            this._active = null;
        }

        this._closeWS();
    }

    // ── HTTP mode ───────────────────────────────────────────────────────────

    async _synthesizeHTTP(text) {
        const res = await tauriFetch(
            `${HTTP_BASE}/${this.voiceId}/stream`,
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

    // ── WebSocket mode ──────────────────────────────────────────────────────

    _synthesizeWS(text) {
        return new Promise((resolve, reject) => {
            this._queue.push({ text, resolve, reject, chunks: [], idleTimer: null });
            if (!this._connected) {
                this._openWS();
            } else {
                this._flush();
            }
        });
    }

    _openWS() {
        if (!this.apiKey || !this.voiceId) return;
        if (this._ws && this._ws.readyState <= WebSocket.OPEN) return;

        const session = ++this._session;
        const url = `${WSS_BASE}/${this.voiceId}/stream-input`
            + `?model_id=${this.modelId}`
            + `&output_format=${OUTPUT_FORMAT}`;

        const ws = new WebSocket(url);
        this._ws = ws;

        ws.onopen = () => {
            if (session !== this._session) { ws.close(); return; }
            this._connected = true;
            ws.send(JSON.stringify({
                text: ' ',
                voice_settings: { stability: 0.8, similarity_boost: 0.8 },
                generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
                xi_api_key: this.apiKey,
            }));
            this._flush();
        };

        ws.onmessage = ({ data }) => {
            if (session !== this._session) return;
            let msg;
            try { msg = JSON.parse(data); } catch { return; }

            if (msg.error) {
                if (this._active) {
                    this._clearIdleTimer(this._active);
                    this._active.reject(new Error(`ElevenLabs: ${msg.error}`));
                    this._active = null;
                }
                this._closeWS();
                return;
            }

            if (msg.audio && this._active) {
                this._active.chunks.push(msg.audio);
                this._resetIdleTimer();
            }

            // Fast path: some models/configs do send isFinal:true
            if (msg.isFinal === true) {
                this._clearIdleTimer(this._active);
                this._resolveActive();
            }
        };

        ws.onerror = () => {
            if (session !== this._session) return;
        };

        ws.onclose = ({ code }) => {
            if (session !== this._session) return;
            this._connected = false;
            this._ws        = null;

            if (this._active) {
                this._clearIdleTimer(this._active);
                this._active.reject(new Error(`ElevenLabs WS closed (code=${code})`));
                this._active = null;
            }

            if (this._queue.length > 0) {
                setTimeout(() => {
                    if (session === this._session) this._openWS();
                }, RECONNECT_DELAY);
            }
        };
    }

    _flush() {
        if (this._active) return;
        if (this._queue.length === 0) return;
        if (!this._connected || this._ws?.readyState !== WebSocket.OPEN) return;

        this._active = this._queue.shift();
        this._ws.send(JSON.stringify({
            text: this._active.text + ' ',
            flush: true,
        }));
    }

    _resetIdleTimer() {
        if (!this._active) return;
        if (this._active.idleTimer) clearTimeout(this._active.idleTimer);
        this._active.idleTimer = setTimeout(() => {
            this._resolveActive();
        }, IDLE_TIMEOUT_MS);
    }

    _clearIdleTimer(item) {
        if (item?.idleTimer) {
            clearTimeout(item.idleTimer);
            item.idleTimer = null;
        }
    }

    _resolveActive() {
        if (!this._active) return;
        this._clearIdleTimer(this._active);

        const { chunks, resolve } = this._active;
        this._active = null;

        const arrays = chunks.map(b64 => {
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
        });
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const out   = new Uint8Array(total);
        let off = 0;
        for (const a of arrays) { out.set(a, off); off += a.length; }

        resolve(out.buffer);
        this._flush();
    }

    _closeWS() {
        this._session++;
        const ws        = this._ws;
        this._ws        = null;
        this._connected = false;

        if (ws) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ text: '' })); } catch (_) {}
            }
            try { ws.close(); } catch (_) {}
        }
    }
}
