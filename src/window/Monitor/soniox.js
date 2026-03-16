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
        const { apiKey, sourceLanguage, targetLanguage, customContext } = config;

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
                max_endpoint_delay_ms: 250,
                enable_speaker_diarization: true,
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
            const domain = this._buildDomain(customContext, carryoverContext);
            const terms = customContext?.terms || [];
            if (domain || terms.length > 0) {
                configMsg.context = {};
                if (domain) configMsg.context.domain = domain;
                if (terms.length > 0) configMsg.context.terms = terms;
            }

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

            if (token.speaker && token.translation_status === 'original') {
                speaker = token.speaker;
            }

            if (token.translation_status === 'original') {
                if (token.is_final) {
                    originalText += token.text;
                } else {
                    provisionalText += token.text;
                }
            } else if (token.translation_status === 'translation') {
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

    _buildDomain(customContext, carryoverContext) {
        const parts = [];
        if (customContext?.domain) {
            parts.push(customContext.domain);
        }
        if (carryoverContext) {
            parts.push(`Recent conversation context: ${carryoverContext}`);
        }
        return parts.length > 0 ? parts.join('. ') : null;
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

// Singleton
export const sonioxClient = new SonioxClient();
