/**
 * Local Model STT Client
 *
 * Connects to the Transkit Local Model's WebSocket transcription endpoint
 * at ws://127.0.0.1:{port}/v1/transcribe.
 *
 * Implements the same callback interface as all other Transkit STT clients
 * (onOriginal, onProvisional, onStatusChange, onError, onReconnect) so it works
 * transparently in Monitor, Voice Anywhere, and Narration without any changes.
 *
 * Audio protocol: raw PCM s16le, 16 kHz, mono — same as cloud STT providers.
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT = 5;

export class LocalSidecarSTTClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this._config = null;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._port = 0;

        this._translationQueue = Promise.resolve();

        // Callbacks — same interface as all other STT clients
        this.onOriginal      = null; // (text, speaker) => {}
        this.onTranslation   = null; // (text) => {}
        this.onProvisional   = null; // (text) => {}
        this.onStatusChange  = null; // (status) => {}
        this.onError         = null; // (message) => {}
        this.onReconnect     = null; // () => {}
    }

    async connect(config) {
        this._config = config;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._translationQueue = Promise.resolve();

        // Read the port directly from Rust state — always accurate, no stale store values.
        this._port = await invoke('local_sidecar_get_port').catch(() => 0) || 0;
        if (!this._port) {
            this._setStatus('error');
            this.onError?.('Local Model is not running. Enable it in Settings → Local Model.');
        } else {
            this._doConnect();
        }

        // When the sidecar (re)starts on a new port, reconnect automatically.
        // Unlisten is stored so disconnect() can clean it up.
        if (this._unlistenReady) this._unlistenReady();
        this._unlistenReady = await listen('local-sidecar://ready', async (e) => {
            const newPort = e.payload?.port ?? 0;
            if (!newPort || this._intentionalDisconnect) return;
            console.log('[LocalSidecarSTT] Sidecar ready on port', newPort, '— reconnecting');
            this._port = newPort;
            this._reconnectAttempts = 0;
            // Close stale connection if any, then reconnect
            if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
            this.isConnected = false;
            this._doConnect();
        }).catch(() => null);
    }

    _doConnect() {
        const port = this._port;
        const url  = `ws://127.0.0.1:${port}/v1/transcribe`;

        this._setStatus('connecting');
        console.log('[LocalSidecarSTT] Connecting to', url);

        let ws;
        try {
            ws = new WebSocket(url);
        } catch (err) {
            this._setStatus('error');
            this.onError?.(`Failed to connect to Local Model: ${err.message}`);
            return;
        }

        ws.onopen = () => {
            const wasReconnect = this._reconnectAttempts > 0;
            console.log('[LocalSidecarSTT] WebSocket open' + (wasReconnect ? ' (reconnect)' : ''));

            // Send initial config frame
            const model = this._config?.asrModel?.trim() || undefined;
            const cfg = {
                model,
                language:       this._config?.sourceLanguage ?? 'auto',
                task:           this._config?.task           ?? 'transcribe',
                chunk_seconds:  this._config?.chunkSeconds  ?? undefined,
                stride_seconds: this._config?.strideSeconds ?? undefined,
            };
            console.log('[LocalSidecarSTT] Config frame →', JSON.stringify(cfg));
            ws.send(JSON.stringify(cfg));

            if (wasReconnect) {
                this.onReconnect?.();
            }
        };

        ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            switch (msg.type) {
                case 'ready':
                    this.isConnected = true;
                    this._reconnectAttempts = 0;
                    this._setStatus('connected');
                    break;

                case 'transcript':
                    if (msg.is_final) {
                        this.onOriginal?.(msg.text ?? '', null);
                        this.onProvisional?.('');
                        this._translateAndEmit(msg.text ?? '');
                    } else {
                        this.onProvisional?.(msg.text ?? '');
                    }
                    break;

                case 'status':
                    console.log('[LocalSidecarSTT] status:', msg.message);
                    // Show loading message as provisional text so user knows what's happening
                    if (!this.isConnected && msg.message) {
                        this.onProvisional?.(msg.message);
                    }
                    break;

                case 'error':
                    this._setStatus('error');
                    this.onError?.(msg.message ?? 'Sidecar ASR error');
                    break;

                default:
                    break;
            }
        };

        ws.onerror = (err) => {
            console.error('[LocalSidecarSTT] WebSocket error', err);
        };

        ws.onclose = (event) => {
            this.isConnected = false;
            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }
            console.warn('[LocalSidecarSTT] Connection closed unexpectedly', event.code);
            this._tryReconnect();
        };

        this.ws = ws;
    }

    // ── Translation ────────────────────────────────────────────────────────────

    _translateAndEmit(text) {
        const { sourceLanguage, targetLanguage } = this._config ?? {};

        // Whisper task="translate" already outputs English at the ASR level —
        // no extra call needed. Also skip if source == target or no target set.
        const whisperDidTranslate = this._config?.task === 'translate';
        const needsTranslate = targetLanguage
            && targetLanguage !== (sourceLanguage || 'auto')
            && !whisperDidTranslate;

        if (!needsTranslate) {
            this.onTranslation?.(text);
            return;
        }

        this._translationQueue = this._translationQueue.then(async () => {
            if (this._intentionalDisconnect) return;
            try {
                const translated = await this._sidecarTranslate(text, sourceLanguage, targetLanguage);
                this.onTranslation?.(translated);
            } catch (err) {
                console.warn('[LocalSidecarSTT] Translation failed, using original:', err.message);
                this.onTranslation?.(text);
                this.onError?.(`Translation error: ${err.message}`);
            }
        });
    }

    async _sidecarTranslate(text, from, to) {
        let res;
        try {
            res = await fetch(`http://127.0.0.1:${this._port}/v1/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, from: from || 'auto', to }),
            });
        } catch (netErr) {
            // Connection-level failure (server crashed / port changed)
            throw new Error('Local Model server unreachable. Check Settings → Local Model.');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.detail ?? `Sidecar translate error: ${res.status}`);
        }
        const data = await res.json();
        return data.translated ?? text;
    }

    sendAudio(pcmData) {
        if (!this.isConnected || this._intentionalDisconnect) return;
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(pcmData instanceof Uint8Array ? pcmData : new Uint8Array(pcmData));
        }
    }

    disconnect() {
        this._intentionalDisconnect = true;
        if (this._unlistenReady) { this._unlistenReady(); this._unlistenReady = null; }
        if (this.ws) {
            try {
                this.ws.send(JSON.stringify({ type: 'stop' }));
            } catch { /* ignore */ }
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    _tryReconnect() {
        if (this._reconnectAttempts >= MAX_RECONNECT) {
            this._setStatus('error');
            this.onError?.(`Local Model connection lost. Reconnect failed after ${MAX_RECONNECT} attempts.`);
            return;
        }
        this._reconnectAttempts++;
        this._setStatus('connecting');
        console.log(`[LocalSidecarSTT] Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT})...`);
        setTimeout(async () => {
            if (this._intentionalDisconnect) return;
            // Always re-read port — sidecar may have restarted on a different port
            const freshPort = await invoke('local_sidecar_get_port').catch(() => 0) || 0;
            if (freshPort) this._port = freshPort;
            this._doConnect();
        }, RECONNECT_DELAY_MS);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
