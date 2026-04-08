/**
 * Soniox WebSocket Client
 * Connects directly to wss://stt-rt.soniox.com/transcribe-websocket
 *
 * Features:
 * - Auto-reconnect on transient errors
 * - Seamless session reset every SESSION_DURATION_MS (make-before-break)
 * - Context carryover: recent translations sent as domain context
 * - Speaker diarization
 */

const SONIOX_ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';

// Reconnect settings
const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

// Session reset: 3 minutes
const SESSION_DURATION_MS = 3 * 60 * 1000;

// Keep last N chars of translations for context carryover
const CONTEXT_HISTORY_CHARS = 500;

export class SonioxClient {
    constructor() {
        this.ws = null;
        this.apiKey = '';
        this.isConnected = false;
        this._reconnectAttempts = 0;
        this._config = null;
        this._intentionalDisconnect = false;
        this._sessionTimer = null;
        this._recentTranslations = []; // Rolling buffer of recent translations
        this._finalizeTimer = null;

        // Callbacks
        this.onOriginal = null;       // (text, speaker) => {}
        this.onTranslation = null;    // (text) => {}
        this.onProvisional = null;    // (text, speaker) => {}
        this.onStatusChange = null;   // (status) => {}
        this.onError = null;          // (error) => {}
        this.onReconnect = null;      // () => {} — fired when reconnect (not initial connect) succeeds
    }

    /**
     * Connect to Soniox WebSocket
     */
    connect(config) {
        const { apiKey } = config;
        this.apiKey = apiKey;
        this._config = config;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._recentTranslations = [];

        if (!apiKey) {
            this._setStatus('error');
            this.onError?.('API key is required. Please add it in Settings.');
            return;
        }

        this._doConnect(config);
    }

    _doConnect(config, carryoverContext = null) {
        const { apiKey, sourceLanguage, targetLanguage, customContext, endpointDelayMs, speakerDiarization } = config;

        this._setStatus('connecting');
        console.log('[Soniox] Connecting to', SONIOX_ENDPOINT);

        let newWs;
        try {
            newWs = new WebSocket(SONIOX_ENDPOINT);
            console.log('[Soniox] WebSocket created, readyState:', newWs.readyState);
        } catch (err) {
            console.error('[Soniox] Failed to create WebSocket:', err);
            this._setStatus('error');
            this.onError?.(`Failed to create WebSocket: ${err.message}`);
            return;
        }

        newWs.onopen = () => {
            const wasReconnect = this._reconnectAttempts > 0;
            console.log('[Soniox] WebSocket OPEN' + (wasReconnect ? ' (reconnect)' : ''));

            // Build config message
            const configMsg = {
                api_key: apiKey,
                model: 'stt-rt-v4',
                audio_format: 'pcm_s16le',
                sample_rate: 16000,
                num_channels: 1,
                enable_endpoint_detection: true,
                max_endpoint_delay_ms: endpointDelayMs ?? 250,
                enable_speaker_diarization: speakerDiarization !== false,
            };

            // Language hints
            if (sourceLanguage && sourceLanguage !== 'auto') {
                configMsg.language_hints = [sourceLanguage];
            }

            // Translation
            if (targetLanguage) {
                configMsg.translation = {
                    type: 'one_way',
                    target_language: targetLanguage,
                };
            }

            // Context: merge user custom context + carryover context
            const ctxMsg = this._buildContextMessage(customContext, carryoverContext);
            if (ctxMsg) configMsg.context = ctxMsg;

            console.log('[Soniox] Sending config (model:', configMsg.model, ')');
            newWs.send(JSON.stringify(configMsg));

            // Make-before-break: close old WS AFTER new one is ready
            const oldWs = this.ws;
            if (oldWs && oldWs !== newWs) {
                console.log('[Soniox] Seamless switch: closing old WebSocket');
                try {
                    if (oldWs.readyState === WebSocket.OPEN) {
                        oldWs.send(new ArrayBuffer(0)); // graceful close signal
                    }
                    oldWs._isOld = true; // mark so onclose doesn't trigger reconnect
                    oldWs.close(1000, 'Session reset');
                } catch (e) {
                    // ignore
                }
            }

            // Switch to new WS
            this.ws = newWs;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            console.log('[Soniox] Connected and config sent');

            // Notify caller if this was a reconnect (not initial connect or seamless reset)
            if (wasReconnect) {
                this.onReconnect?.();
            }

            // Start session timer
            this._startSessionTimer();
        };

        newWs.onmessage = (event) => {
            // Ignore messages from old WebSocket
            if (newWs._isOld) return;

            try {
                const data = JSON.parse(event.data);

                if (data.error_code) {
                    this._handleApiError(data);
                    return;
                }

                this._handleResponse(data);
            } catch (err) {
                console.error('Failed to parse Soniox response:', err);
            }
        };

        newWs.onerror = (event) => {
            if (newWs._isOld) return;
            console.error('[Soniox] WebSocket ERROR:', event);
            this.onError?.('WebSocket error occurred');
        };

        newWs.onclose = (event) => {
            // Ignore close events from old WebSocket during seamless switch
            if (newWs._isOld) {
                console.log('[Soniox] Old WebSocket closed (expected)');
                return;
            }

            console.log('[Soniox] WebSocket CLOSED, code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
            this.isConnected = false;

            // Only null out ws if this is the current one
            if (this.ws === newWs) {
                this.ws = null;
            }

            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }

            // Handle close codes
            if (event.code === 1000) {
                this._setStatus('disconnected');
            } else if (event.code === 1006) {
                this._tryReconnect('Connection lost unexpectedly');
            } else if (event.code === 4001 || event.code === 4003) {
                this._setStatus('error');
                this.onError?.('Invalid API key. Please check your key in Settings.');
            } else if (event.code === 4029) {
                this._setStatus('error');
                this.onError?.('Rate limit exceeded. Please wait and try again.');
            } else if (event.code === 4002) {
                this._setStatus('error');
                this.onError?.('Subscription issue. Please check your Soniox account.');
            } else {
                this._tryReconnect(`Connection closed (code: ${event.code})`);
            }
        };
    }

    /**
     * Send raw PCM audio data
     */
    sendAudio(pcmData) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(pcmData);
        }
    }

    /**
     * Gracefully disconnect
     */
    disconnect() {
        this._intentionalDisconnect = true;
        this._stopSessionTimer();
        clearTimeout(this._finalizeTimer);
        this._finalizeTimer = null;

        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(new ArrayBuffer(0));
                }
                this.ws.close(1000, 'User disconnected');
            } catch (err) {
                console.error('Error during disconnect:', err);
            }
            this.ws = null;
        }
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    finalize() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this._stopSessionTimer();
        clearTimeout(this._finalizeTimer);
        this._finalizeTimer = setTimeout(() => {
            if (!this._intentionalDisconnect && this.ws?.readyState === WebSocket.OPEN) {
                this.disconnect();
            }
        }, 4000);

        try {
            this.ws.send(new ArrayBuffer(0));
        } catch (err) {
            console.warn('[Soniox] finalize failed:', err);
        }
    }

    /**
     * Process Soniox response
     */
    _handleResponse(data) {
        if (!data.tokens || data.tokens.length === 0) return;

        let originalText = '';
        let translationText = '';
        let provisionalText = '';
        let hasEnd = false;
        let speaker = null;

        for (const token of data.tokens) {
            if (token.text === '<end>') {
                hasEnd = true;
                continue;
            }

            const tokenType = token.translation_status ?? 'original';

            if (token.speaker && tokenType === 'original') {
                speaker = token.speaker;
            }

            if (tokenType === 'original') {
                if (token.is_final) {
                    originalText += token.text;
                } else {
                    provisionalText += token.text;
                }
            } else if (tokenType === 'translation') {
                if (token.is_final) {
                    translationText += token.text;
                }
            }
        }

        // Emit finalized original text with speaker
        if (originalText.trim()) {
            this.onOriginal?.(originalText, speaker);
        }

        // Emit translation + store for context carryover
        if (translationText.trim()) {
            this.onTranslation?.(translationText);
            this._addToHistory(translationText);
        }

        // Emit provisional text with speaker
        if (provisionalText.trim()) {
            this.onProvisional?.(provisionalText, speaker);
        } else if (originalText.trim() || translationText.trim() || hasEnd) {
            this.onProvisional?.('');
        }
    }

    // ─── Session Timer ────────────────────────────────────────

    _startSessionTimer() {
        this._stopSessionTimer();
        this._sessionTimer = setTimeout(() => {
            this._seamlessReset();
        }, SESSION_DURATION_MS);
    }

    _stopSessionTimer() {
        if (this._sessionTimer) {
            clearTimeout(this._sessionTimer);
            this._sessionTimer = null;
        }
    }

    /**
     * Seamless session reset: open new WS, switch, close old
     * Audio capture continues uninterrupted
     */
    _seamlessReset() {
        if (!this._config || this._intentionalDisconnect) return;

        console.log('[Soniox] Seamless session reset (every 3 min)');

        // Build carryover context from recent translations
        const carryover = this._getCarryoverContext();

        // Open new connection (make-before-break)
        this._doConnect(this._config, carryover);
    }

    // ─── Context Carryover ────────────────────────────────────

    _addToHistory(text) {
        this._recentTranslations.push(text);
        // Trim to keep under CONTEXT_HISTORY_CHARS
        let total = this._recentTranslations.reduce((sum, t) => sum + t.length, 0);
        while (total > CONTEXT_HISTORY_CHARS && this._recentTranslations.length > 1) {
            const removed = this._recentTranslations.shift();
            total -= removed.length;
        }
    }

    _getCarryoverContext() {
        if (this._recentTranslations.length === 0) return null;
        return this._recentTranslations.join(' ').trim();
    }

    /**
     * Build the full Soniox context object from the rich context shape:
     *   { general: [{key,value}], text: string, terms: string[], translation_terms: [{source,target}] }
     * Carryover context from recent translations is appended to the `text` field.
     */
    _buildContextMessage(customContext, carryoverContext) {
        if (!customContext && !carryoverContext) return null;

        const ctx = {};

        // general: array of {key, value} pairs
        const general = customContext?.general?.filter(g => g.key?.trim() && g.value?.trim()) ?? [];
        if (general.length > 0) {
            ctx.general = general.map(g => ({ key: g.key.trim(), value: g.value.trim() }));
        }

        // text: background narrative + carryover
        const textParts = [];
        if (customContext?.text?.trim()) textParts.push(customContext.text.trim());
        if (carryoverContext) textParts.push(`Recent conversation context: ${carryoverContext}`);
        if (textParts.length > 0) ctx.text = textParts.join('\n\n');

        // terms: array of strings
        const terms = (customContext?.terms ?? []).filter(t => t?.trim());
        if (terms.length > 0) ctx.terms = terms.map(t => t.trim());

        // translation_terms: array of {source, target}
        const translationTerms = (customContext?.translation_terms ?? [])
            .filter(tt => tt.source?.trim() && tt.target?.trim());
        if (translationTerms.length > 0) {
            ctx.translation_terms = translationTerms.map(tt => ({
                source: tt.source.trim(),
                target: tt.target.trim(),
            }));
        }

        return Object.keys(ctx).length > 0 ? ctx : null;
    }

    // ─── Error Handling ──────────────────────────────────────

    _handleApiError(data) {
        const code = data.error_code || 0;
        const message = data.error_message || 'Unknown API error';

        console.error('Soniox API error:', code, message);

        if (code === 408) {
            this._tryReconnect('Request timeout');
            return;
        }

        let userMessage = message;
        if (code === 401) {
            userMessage = 'Invalid API key. Please check your key in Settings.';
        } else if (code === 429) {
            userMessage = 'Rate limit exceeded. Please wait a moment.';
        } else if (code === 402) {
            userMessage = 'Insufficient credits. Check your Soniox account.';
        } else if (code === 400) {
            userMessage = `Config error: ${message}`;
        }

        this._setStatus('error');
        this.onError?.(userMessage);
    }

    _tryReconnect(reason) {
        if (this._reconnectAttempts >= MAX_RECONNECT) {
            this._setStatus('error');
            this.onError?.(`${reason}. Reconnect failed after ${MAX_RECONNECT} attempts.`);
            return;
        }

        this._reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * this._reconnectAttempts;

        console.log(`Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT}) in ${delay}ms...`);
        this._setStatus('connecting');
        this.onError?.(`${reason}. Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT})...`);

        setTimeout(() => {
            if (!this._intentionalDisconnect && this._config) {
                const carryover = this._getCarryoverContext();
                this._doConnect(this._config, carryover);
            }
        }, delay);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
