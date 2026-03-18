/**
 * AssemblyAI Real-time WebSocket Client
 * Connects to wss://api.assemblyai.com/v2/realtime/ws
 *
 * Features:
 * - Temporary token auth (fetched via Tauri HTTP before WS connect)
 * - Partial and final transcript callbacks
 * - Auto-reconnect on transient errors
 *
 * Note: AssemblyAI real-time API does not support built-in translation.
 * The transcript text is emitted as both onOriginal and onTranslation.
 */

import { fetch, Body } from '@tauri-apps/api/http';

const ASSEMBLYAI_TOKEN_URL = 'https://api.assemblyai.com/v2/realtime/token';
const ASSEMBLYAI_WS_BASE = 'wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000';

const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

export class AssemblyAIClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this._config = null;
        this._token = null;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;

        // Callbacks
        this.onOriginal = null;       // (text, speaker) => {}
        this.onTranslation = null;    // (text) => {}
        this.onProvisional = null;    // (text) => {}
        this.onStatusChange = null;   // (status) => {}
        this.onError = null;          // (msg) => {}
        this.onReconnect = null;      // () => {}
    }

    async connect(config) {
        const { apiKey } = config;
        if (!apiKey) {
            this._setStatus('error');
            this.onError?.('API key is required. Please add it in Settings.');
            return;
        }

        this._config = config;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._setStatus('connecting');

        // Fetch a temporary token from AssemblyAI
        try {
            const res = await fetch(ASSEMBLYAI_TOKEN_URL, {
                method: 'POST',
                headers: { Authorization: apiKey },
                body: Body.json({ expires_in: 3600 }),
                timeout: 10,
            });
            if (!res.ok) {
                this._setStatus('error');
                this.onError?.(`AssemblyAI authentication failed (${res.status}). Check your API key.`);
                return;
            }
            this._token = res.data?.token;
            if (!this._token) {
                this._setStatus('error');
                this.onError?.('AssemblyAI returned an empty token. Please try again.');
                return;
            }
        } catch (err) {
            this._setStatus('error');
            this.onError?.(`Failed to authenticate with AssemblyAI: ${err.message}`);
            return;
        }

        this._doConnect(false);
    }

    _doConnect(isReconnect) {
        const ws = new WebSocket(`${ASSEMBLYAI_WS_BASE}&token=${this._token}`);

        ws.onopen = () => {
            this.ws = ws;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            console.log('[AssemblyAI] Connected');
            if (isReconnect) this.onReconnect?.();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this._handleResponse(data);
            } catch (err) {
                console.error('[AssemblyAI] Failed to parse response:', err);
            }
        };

        ws.onerror = () => {
            this.onError?.('AssemblyAI WebSocket error occurred');
        };

        ws.onclose = (event) => {
            this.isConnected = false;
            if (this.ws === ws) this.ws = null;

            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }

            if (event.code === 1000) {
                this._setStatus('disconnected');
            } else {
                this._tryReconnect(`Connection closed (code: ${event.code})`);
            }
        };
    }

    _handleResponse(data) {
        const type = data.message_type;
        const text = (data.text ?? '').trim();

        if (type === 'PartialTranscript') {
            if (text) this.onProvisional?.(text);
        } else if (type === 'FinalTranscript') {
            if (text) {
                this.onOriginal?.(text, null);
                // No built-in translation — emit transcript as the "translation" output
                this.onTranslation?.(text);
                this.onProvisional?.('');
            }
        } else if (type === 'SessionBegins') {
            console.log('[AssemblyAI] Session started, session_id:', data.session_id);
        } else if (type === 'SessionTerminated') {
            console.log('[AssemblyAI] Session terminated');
        } else if (data.error) {
            console.error('[AssemblyAI] API error:', data.error);
            this._setStatus('error');
            this.onError?.(data.error);
        }
    }

    /**
     * Send raw PCM audio data (16-bit, 16000 Hz, mono)
     * AssemblyAI expects base64-encoded audio in a JSON message
     */
    sendAudio(pcmData) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;

        const bytes = new Uint8Array(pcmData);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        this.ws.send(JSON.stringify({ audio_data: b64 }));
    }

    disconnect() {
        this._intentionalDisconnect = true;
        if (this.ws) {
            try {
                // Send terminate session message before closing
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ terminate_session: true }));
                }
                this.ws.close(1000, 'User disconnected');
            } catch (_) {}
            this.ws = null;
        }
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    async _tryReconnect(reason) {
        if (this._reconnectAttempts >= MAX_RECONNECT) {
            this._setStatus('error');
            this.onError?.(`${reason}. Reconnect failed after ${MAX_RECONNECT} attempts.`);
            return;
        }

        this._reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * this._reconnectAttempts;
        this._setStatus('connecting');
        this.onError?.(`${reason}. Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT})...`);

        setTimeout(async () => {
            if (this._intentionalDisconnect) return;
            // Refresh the token before reconnecting
            try {
                const res = await fetch(ASSEMBLYAI_TOKEN_URL, {
                    method: 'POST',
                    headers: { Authorization: this._config.apiKey },
                    body: Body.json({ expires_in: 3600 }),
                    timeout: 10,
                });
                if (res.ok && res.data?.token) {
                    this._token = res.data.token;
                    this._doConnect(true);
                } else {
                    this._setStatus('error');
                    this.onError?.('Failed to refresh authentication token.');
                }
            } catch (err) {
                this._setStatus('error');
                this.onError?.(`Reconnect failed: ${err.message}`);
            }
        }, delay);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
