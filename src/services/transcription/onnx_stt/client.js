/**
 * ONNX STT Client
 *
 * Connects to the ONNX STT engine's WebSocket transcription endpoint
 * at ws://127.0.0.1:{port}/v1/transcribe.
 *
 * Implements the same callback interface as all other Transkit STT clients
 * (onOriginal, onProvisional, onStatusChange, onError, onReconnect) so it works
 * transparently in Monitor, Voice Anywhere, and Narration without any changes.
 *
 * The ONNX engine is offline — no internet required after model download.
 * Audio protocol: raw PCM s16le, 16 kHz, mono — same as cloud STT providers.
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT = 5;

export class OnnxSTTClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this._config = null;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._port = 0;

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

        // Read the port directly from Rust state — always accurate, no stale values.
        this._port = await invoke('onnx_engine_get_port').catch(() => 0) || 0;
        if (!this._port) {
            this._setStatus('error');
            this.onError?.('ONNX STT engine is not running. Enable it in Settings → Offline STT.');
        } else {
            this._doConnect();
        }

        // When the ONNX engine (re)starts on a new port, reconnect automatically.
        if (this._unlistenReady) this._unlistenReady();
        this._unlistenReady = await listen('onnx-engine://ready', async (e) => {
            const newPort = e.payload?.port ?? 0;
            if (!newPort || this._intentionalDisconnect) return;
            console.log('[OnnxSTT] Engine ready on port', newPort, '— reconnecting');
            this._port = newPort;
            this._reconnectAttempts = 0;
            if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
            this.isConnected = false;
            this._doConnect();
        }).catch(() => null);
    }

    _doConnect() {
        const port = this._port;
        const url  = `ws://127.0.0.1:${port}/v1/transcribe`;

        this._setStatus('connecting');
        console.log('[OnnxSTT] Connecting to', url);

        let ws;
        try {
            ws = new WebSocket(url);
        } catch (err) {
            this._setStatus('error');
            this.onError?.(`Failed to connect to ONNX STT engine: ${err.message}`);
            return;
        }

        ws.onopen = () => {
            const wasReconnect = this._reconnectAttempts > 0;
            console.log('[OnnxSTT] WebSocket open' + (wasReconnect ? ' (reconnect)' : ''));

            // Send initial config frame — repo slug is passed as-is; server handles path translation
            const model = this._config?.asrModel?.trim() || undefined;
            const cfg = {
                model,
                language: this._config?.sourceLanguage ?? 'auto',
                // task is always 'transcribe' for ONNX (no translate task)
            };
            console.log('[OnnxSTT] Config frame →', JSON.stringify(cfg));
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
                        // ONNX is STT-only — pass transcript directly as translation
                        this.onTranslation?.(msg.text ?? '');
                    } else {
                        this.onProvisional?.(msg.text ?? '');
                    }
                    break;

                case 'status':
                    console.log('[OnnxSTT] status:', msg.message);
                    if (!this.isConnected && msg.message) {
                        this.onProvisional?.(msg.message, { isStatus: true });
                    }
                    break;

                case 'error':
                    this._setStatus('error');
                    this.onError?.(msg.message ?? 'ONNX STT error');
                    break;

                default:
                    break;
            }
        };

        ws.onerror = (err) => {
            console.error('[OnnxSTT] WebSocket error', err);
        };

        ws.onclose = (event) => {
            this.isConnected = false;
            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }
            console.warn('[OnnxSTT] Connection closed unexpectedly', event.code);
            this._tryReconnect();
        };

        this.ws = ws;
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
            this.onError?.(`ONNX STT connection lost. Reconnect failed after ${MAX_RECONNECT} attempts.`);
            return;
        }
        this._reconnectAttempts++;
        this._setStatus('connecting');
        console.log(`[OnnxSTT] Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT})...`);
        setTimeout(async () => {
            if (this._intentionalDisconnect) return;
            const freshPort = await invoke('onnx_engine_get_port').catch(() => 0) || 0;
            if (freshPort) this._port = freshPort;
            this._doConnect();
        }, RECONNECT_DELAY_MS);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
