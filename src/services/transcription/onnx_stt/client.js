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
        this._unlistenReady = null;
        this._unlistenStopped = null;

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
            // Check if engine is actually running or needs starting
            const status = await invoke('onnx_engine_status').catch(() => ({ running: false }));
            if (!status.running) {
                await this._autoStart();
            } else if (status.port) {
                // If it's running but we didn't have the port yet for some reason
                this._port = status.port;
                this._doConnect();
            }
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

        // Detect unexpected engine crash while connected / connecting.
        if (this._unlistenStopped) this._unlistenStopped();
        this._unlistenStopped = await listen('onnx-engine://stopped', () => {
            if (this._intentionalDisconnect) return;
            if (!this.isConnected) {
                // Engine died before a working connection was established.
                // This typically means the model is incompatible with sherpa-onnx.
                // Halt the reconnect/restart loop immediately.
                this._reconnectAttempts = MAX_RECONNECT;
                this._setStatus('error');
                this.onError?.(
                    'ONNX STT engine crashed. The model may be incompatible with sherpa-onnx. ' +
                    'Use a model from Settings → Offline STT (e.g. from the sherpa-onnx model list).'
                );
            }
            // If we were previously connected, let _tryReconnect handle restart gracefully.
        }).catch(() => null);
    }

    // ── Auto-start helper ───────────────────────────────────────────────────────

    async _autoStart() {
        console.log('[OnnxSTT] Engine not running, attempting auto-start...');
        this._setStatus('connecting');

        // Check setup first to provide a clear error if not installed.
        const setup = await invoke('onnx_engine_check_setup').catch(() => ({ ready: false }));
        if (!setup.ready) {
            this._setStatus('error');
            this.onError?.('ONNX STT engine is not installed. Go to Settings → Offline STT → Install Engine.');
            return;
        }

        // Start the engine. Don't await — it spawns a process and returns immediately.
        // The 'onnx-engine://ready' listener (set up after this call) handles the connection.
        invoke('onnx_engine_start', {
            config: {
                asr_model: this._config?.asrModel || undefined,
                asr_language: this._config?.sourceLanguage || 'auto',
            }
        }).catch(err => {
            this._setStatus('error');
            this.onError?.(`Failed to start ONNX engine: ${err}`);
        });
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
        if (this._unlistenStopped) { this._unlistenStopped(); this._unlistenStopped = null; }
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
            if (freshPort) {
                // Engine is running — connect to (possibly new) port.
                this._port = freshPort;
                this._doConnect();
            } else {
                // Engine not running. Check if we've already been halted (e.g. by stopped handler
                // detecting a model-incompatibility crash). If so, don't restart — error is shown.
                if (this._reconnectAttempts >= MAX_RECONNECT) return;
                // Otherwise try to restart. Don't count this as a reconnect attempt.
                console.log('[OnnxSTT] Engine gone during reconnect — attempting restart...');
                this._reconnectAttempts--; // cancel the increment above
                await this._autoStart().catch(() => {});
            }
        }, RECONNECT_DELAY_MS);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
