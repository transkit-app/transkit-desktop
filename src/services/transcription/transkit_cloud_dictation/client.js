/**
 * DictationClient
 *
 * Connects directly to the Transkit Cloud `proxy-dictation` Edge Function WebSocket.
 * Designed for short, sporadic STT sessions (Voice Anywhere dictation, Narration PTT).
 *
 * Unlike TranskitCloudSTTClient, there is no intermediate credential exchange —
 * the JWT is sent as the first message on the WebSocket, and the Edge Function
 * proxies audio to the configured provider and post-debits usage on close.
 *
 * Protocol:
 *   1. Open WS to `${SUPABASE_WS_URL}/functions/v1/proxy-dictation`
 *   2. On open: send `{"type":"dictation_connect","token":"<jwt>","source_language":...}`
 *   3. Send binary PCM frames while recording
 *   4. On PTT release: send `{"type":"dictation_end"}` → provider finalizes
 *   5. Receive `{"type":"final","text":"...","seconds_remaining":N}` → onOriginal fires
 *   6. On abort: send `{"type":"dictation_abort"}` + close
 *
 * Callbacks match the standard STT client interface so VoiceAnywhere and Monitor
 * can use this client without any special-casing beyond the factory.
 */

import { getSession, CLOUD_ENABLED } from '../../../lib/transkit-cloud';

const _supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

function _getDictationWsUrl() {
    if (!_supabaseUrl) return null;
    return _supabaseUrl.replace('https://', 'wss://') + '/functions/v1/proxy-dictation';
}

export class DictationClient {
    constructor() {
        this._ws = null;
        this._config = null;
        this._intentionalDisconnect = false;
        this._finished = false;

        // Set to true once the WebSocket is open and the dictation_connect handshake is sent.
        // Used by Monitor's waitNarrationClientConnected() poll.
        this.isConnected = false;

        // Standard STT client callbacks
        this.onOriginal = null;      // (text) => {}
        this.onProvisional = null;   // (text) => {}
        this.onStatusChange = null;  // (status: 'connecting'|'recording'|'processing'|'done'|'error'|'disconnected') => {}
        this.onError = null;         // (msg, meta?) => {}

        // Dictation-specific callback — fired alongside onOriginal with quota info
        this.onDictationSession = null; // ({ seconds_remaining }) => {}
    }

    /**
     * Open a dictation session.
     * config: { sourceLanguage, targetLanguage } — no apiKey needed.
     */
    connect(config) {
        if (!CLOUD_ENABLED) {
            this._setStatus('error');
            this.onError?.('Transkit Cloud is not available in this build.', { code: 'cloud_disabled' });
            return;
        }

        // Abort any previous in-flight connect
        this._intentionalDisconnect = false;
        this._finished = false;
        if (this._ws) {
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onerror = null;
            this._ws.onclose = null;
            try { this._ws.close(); } catch (_) {}
            this._ws = null;
        }

        this._config = config;
        this._doConnect(config);
    }

    async _doConnect(config) {
        this._setStatus('connecting');

        let session;
        try {
            session = await getSession();
        } catch (err) {
            if (this._intentionalDisconnect) return;
            this._setStatus('error');
            this.onError?.('Authentication error. Please sign in again.', { code: 'auth_error' });
            return;
        }

        if (this._intentionalDisconnect) return;

        if (!session?.access_token) {
            this._setStatus('error');
            this.onError?.(
                'Sign in to your Transkit account to use Cloud Dictation.',
                { code: 'unauthorized' }
            );
            return;
        }

        const wsUrl = _getDictationWsUrl();
        if (!wsUrl) {
            this._setStatus('error');
            this.onError?.('Transkit Cloud is not configured.', { code: 'cloud_disabled' });
            return;
        }

        let ws;
        try {
            ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';
        } catch (err) {
            if (this._intentionalDisconnect) return;
            this._setStatus('error');
            this.onError?.('Failed to open dictation connection.', { code: 'ws_error' });
            return;
        }

        this._ws = ws;
        const token = session.access_token;

        ws.onopen = () => {
            if (this._intentionalDisconnect) { ws.close(); return; }
            // Auth handshake — first message must be dictation_connect
            ws.send(JSON.stringify({
                type: 'dictation_connect',
                token,
                source_language: config.sourceLanguage ?? null,
                target_language: config.targetLanguage ?? null,
            }));
            this.isConnected = true;
            this._setStatus('recording');
        };

        ws.onmessage = (event) => {
            if (typeof event.data !== 'string') return;
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            this._handleMessage(msg);
        };

        ws.onerror = () => {
            if (this._intentionalDisconnect) return;
            this.isConnected = false;
            this._setStatus('error');
            this.onError?.('Dictation connection error. Please try again.', { code: 'ws_error' });
        };

        ws.onclose = () => {
            this.isConnected = false;
            if (this._intentionalDisconnect) return;
            this._setStatus('disconnected');
        };
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'interim':
                if (this._finished) return;
                this.onProvisional?.(msg.text ?? '');
                break;

            case 'final':
                if (this._finished) return;
                this._finished = true;
                this.onOriginal?.(msg.text ?? '');
                if (msg.seconds_remaining !== undefined) {
                    this.onDictationSession?.({ seconds_remaining: msg.seconds_remaining });
                }
                this._setStatus('done');
                break;

            case 'error': {
                this._finished = true;
                const meta = { code: msg.code ?? 'server_error' };
                if (msg.used !== undefined) meta.used = msg.used;
                if (msg.limit !== undefined) meta.limit = msg.limit;
                this._setStatus('error');
                this.onError?.(msg.code ?? 'server_error', meta);
                break;
            }

            default:
                break;
        }
    }

    /** Send a raw PCM audio buffer to the Edge Function proxy. */
    sendAudio(pcmBuffer) {
        if (this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(pcmBuffer);
        }
    }

    /**
     * Signal end of speech — the Edge Function flushes the provider buffer and
     * returns the final transcript. Call on PTT release / hotkey up.
     */
    finalize() {
        if (this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: 'dictation_end' }));
            this._setStatus('processing');
        }
    }

    /**
     * Abort the session without waiting for a transcript.
     * Usage is still post-debited by the server for audio already processed.
     */
    disconnect() {
        this._intentionalDisconnect = true;
        this.isConnected = false;
        if (this._ws) {
            if (this._ws.readyState === WebSocket.OPEN) {
                try { this._ws.send(JSON.stringify({ type: 'dictation_abort' })); } catch (_) {}
            }
            try { this._ws.close(); } catch (_) {}
            this._ws = null;
        }
        this._setStatus('disconnected');
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
