/**
 * Gladia Live STT WebSocket Client
 *
 * Flow:
 *   1. POST https://api.gladia.io/v2/live  →  { url, id }
 *   2. Connect WebSocket to `url`
 *   3. Stream raw PCM binary frames (16kHz, 16-bit, mono)
 *   4. Receive { type: "transcript" } and { type: "translation" } messages
 *   5. Send { type: "stop_recording" } then close on disconnect
 *
 * Docs: https://docs.gladia.io/chapters/live-stt/getting-started
 */

const GLADIA_API_URL = 'https://api.gladia.io';

const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

export class GladiaClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this._reconnectAttempts = 0;
        this._config = null;
        this._intentionalDisconnect = false;
        this._hasTranslation = false;

        // Pending final transcript waiting for its translation message
        this._pendingFinal = null;   // { text, speaker }
        this._translationTimeout = null;

        // Callbacks — same interface as SonioxClient
        this.onOriginal = null;      // (text, speaker) => {}
        this.onTranslation = null;   // (text) => {}
        this.onProvisional = null;   // (text) => {}
        this.onStatusChange = null;  // (status) => {}
        this.onError = null;         // (message) => {}
        this.onReconnect = null;     // () => {} — fired when reconnect succeeds
    }

    /**
     * Initiate a Gladia session then connect the WebSocket.
     * Called without await from Monitor — async work happens internally.
     *
     * Two modes:
     *   BYOK:         config.apiKey provided → POST /v2/live to create session
     *   Transkit Cloud: config._preCreatedUrl provided → skip HTTP init, connect directly
     */
    connect(config) {
        this._config = config;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._hasTranslation = !!config.targetLanguage;
        this._clearPending();

        if (config._preCreatedUrl) {
            // Cloud-managed session: session was created server-side, URL is ready.
            this._setStatus('connecting');
            this._connectWebSocket(config._preCreatedUrl);
            return;
        }

        if (!config.apiKey) {
            this._setStatus('error');
            this.onError?.('API key is required. Please add it in Settings.');
            return;
        }

        this._initSession(config);
    }

    async _initSession(config) {
        this._setStatus('connecting');

        const { apiKey, sourceLanguage, targetLanguage, customContext, endpointing, speechThreshold } = config;

        const resolvedEndpointing = endpointing ?? 0.1;
        const body = {
            encoding: 'wav/pcm',
            sample_rate: 16000,
            bit_depth: 16,
            channels: 1,
            model: 'solaria-1',
            endpointing: resolvedEndpointing,
            // Force-flush after continuous speech (Gladia minimum is 5s)
            maximum_duration_without_endpointing: 5,
            pre_processing: {
                speech_threshold: speechThreshold ?? 0.3,
            },
            messages_config: {
                receive_partial_transcripts: true,
                receive_final_transcripts: true,
                receive_speech_events: false,
                receive_pre_processing_events: false,
                receive_realtime_processing_events: true,  // required for translation messages
                receive_post_processing_events: false,
                receive_acknowledgments: false,
                receive_lifecycle_events: false,
                receive_errors: true,
            },
        };

        // Language detection / hints
        if (sourceLanguage) {
            body.language_config = {
                languages: [sourceLanguage],
                code_switching: false,
            };
        }

        // Custom vocabulary — top-level, applies regardless of translation
        const terms = (customContext?.terms ?? []).filter(t => t?.trim());
        if (terms.length > 0) {
            body.custom_vocabulary = true;
            body.custom_vocabulary_config = {
                vocabulary: terms.map(t => ({ value: t.trim() })),
            };
        }

        // Translation
        if (targetLanguage) {
            const translationConfig = {
                target_languages: [targetLanguage],
                model: 'base',
                match_original_utterances: true,
            };

            // Pass background context string if provided
            const contextText = customContext?.text?.trim();
            if (contextText) {
                translationConfig.context = contextText;
                translationConfig.context_adaptation = true;
            }

            body.realtime_processing = {
                translation: true,
                translation_config: translationConfig,
            };
        }

        console.log('[Gladia] Init session — endpointing:', resolvedEndpointing, 's | max_duration:', body.maximum_duration_without_endpointing, 's | speech_threshold:', body.pre_processing.speech_threshold);

        try {
            const response = await fetch(`${GLADIA_API_URL}/v2/live`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-GLADIA-KEY': apiKey,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                if (response.status === 401) {
                    this._setStatus('error');
                    this.onError?.('Invalid API key. Please check your key in Settings.');
                } else {
                    this._setStatus('error');
                    this.onError?.(`Failed to initialize session (${response.status}): ${text}`);
                }
                return;
            }

            const data = await response.json();
            if (!data.url) {
                this._setStatus('error');
                this.onError?.('Gladia did not return a WebSocket URL. Please try again.');
                return;
            }

            this._connectWebSocket(data.url);

        } catch (err) {
            if (this._intentionalDisconnect) return;
            console.error('[Gladia] Session init error:', err);
            this._tryReconnect(`Initialization failed: ${err.message}`);
        }
    }

    _connectWebSocket(url) {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (err) {
            this._setStatus('error');
            this.onError?.(`Failed to create WebSocket: ${err.message}`);
            return;
        }

        ws.onopen = () => {
            const wasReconnect = this._reconnectAttempts > 0;
            this.ws = ws;
            this.isConnected = true;
            this._reconnectAttempts = 0;
            this._setStatus('connected');
            console.log('[Gladia] Connected');

            if (wasReconnect) {
                this.onReconnect?.();
            }
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this._handleMessage(message);
            } catch (err) {
                console.error('[Gladia] Failed to parse message:', err);
            }
        };

        ws.onerror = (event) => {
            console.error('[Gladia] WebSocket error:', event);
            this.onError?.('WebSocket error occurred');
        };

        ws.onclose = (event) => {
            this.isConnected = false;
            if (this.ws === ws) this.ws = null;

            console.log('[Gladia] WebSocket closed, code:', event.code, 'reason:', event.reason);

            if (this._intentionalDisconnect) {
                this._setStatus('disconnected');
                return;
            }

            if (event.code === 1000) {
                this._setStatus('disconnected');
            } else if (event.code === 4001 || event.code === 4003) {
                this._setStatus('error');
                this.onError?.('Invalid API key. Please check your key in Settings.');
            } else {
                this._tryReconnect(`Connection closed (code: ${event.code})`);
            }
        };
    }

    /**
     * Send raw PCM audio buffer (ArrayBuffer of PCM s16le, 16kHz, mono)
     */
    sendAudio(pcmData) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(pcmData);
        }
    }

    /**
     * Gracefully stop: send stop_recording signal then close
     */
    disconnect() {
        this._intentionalDisconnect = true;
        this._clearPending();

        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'stop_recording' }));
                }
                this.ws.close(1000, 'User disconnected');
            } catch (err) {
                console.error('[Gladia] Error during disconnect:', err);
            }
            this.ws = null;
        }

        this.isConnected = false;
        this._setStatus('disconnected');
    }

    /**
     * Process incoming WebSocket messages from Gladia
     *
     * Gladia sends transcripts and translations as separate message types:
     *   - type "transcript": partial (is_final=false) or final (is_final=true)
     *   - type "translation": arrives ~0.3–1s after the matching final transcript
     *
     * Display strategy (Soniox-style continuous feel):
     *
     *   Partial transcript (is_final=false)
     *     → onProvisional(text)  — words build up live while speaking
     *
     *   Final transcript (is_final=true) with translation enabled
     *     → onProvisional(original)  — keep text visible immediately, user sees it right away
     *     → store in _pendingFinal; start 3s fallback timer
     *
     *   Translation message arrives
     *     → _commitEntry(original, speaker, translation)
     *        = onOriginal + onTranslation (adds entry to log) + onProvisional('')
     *     → cancel fallback timer
     *
     *   Fallback timer fires (translation never came)
     *     → commit with original as translation
     *
     *   Final transcript with NO translation configured
     *     → _commitEntry immediately (no pending needed)
     */
    _handleMessage(message) {
        const { type, data } = message;

        if (type === 'transcript') {
            const text = data?.utterance?.text;
            if (!text?.trim()) return;

            console.log(`[Gladia] transcript is_final=${data.is_final}:`, text);

            if (data.is_final) {
                const rawSpeaker = data.utterance?.speaker;
                const speaker = rawSpeaker != null ? `S${rawSpeaker}` : null;

                if (!this._hasTranslation) {
                    this._commitEntry(text, speaker, text);
                } else {
                    // Show original in provisional immediately — no blank gap
                    this.onProvisional?.(text);

                    this._pendingFinal = { text, speaker };
                    clearTimeout(this._translationTimeout);
                    this._translationTimeout = setTimeout(() => {
                        const pending = this._pendingFinal;
                        if (!pending) return;
                        this._pendingFinal = null;
                        this._commitEntry(pending.text, pending.speaker, pending.text);
                    }, 3000);
                }
            } else {
                // Partial — update provisional as words accumulate
                this.onProvisional?.(text);
            }

        } else if (type === 'translation') {
            const translatedText = data?.translated_utterance?.text;
            if (!translatedText?.trim()) return;

            clearTimeout(this._translationTimeout);
            this._translationTimeout = null;

            const pending = this._pendingFinal;
            this._pendingFinal = null;

            const original = pending?.text ?? data?.utterance?.text ?? '';
            const speaker = pending?.speaker ?? null;
            this._commitEntry(original, speaker, translatedText);

        } else if (type === 'error') {
            const msg = data?.message ?? 'Unknown Gladia error';
            console.error('[Gladia] Server error:', msg);
            this.onError?.(msg);
        }
    }

    /** Emit a finalized (original + translation) pair to Monitor */
    _commitEntry(original, speaker, translation) {
        this.onOriginal?.(original, speaker);
        this.onTranslation?.(translation);
        this.onProvisional?.('');
    }

    _clearPending() {
        clearTimeout(this._translationTimeout);
        this._translationTimeout = null;
        this._pendingFinal = null;
    }

    // ─── Reconnect ────────────────────────────────────────────

    _tryReconnect(reason) {
        // Cloud sessions use a pre-created WSS URL that is single-use.
        // Reconnect is not possible without generating a new session server-side.
        if (this._config?._preCreatedUrl) {
            this._setStatus('error');
            this.onError?.('Connection lost. Please start a new session.');
            return;
        }

        if (this._reconnectAttempts >= MAX_RECONNECT) {
            this._setStatus('error');
            this.onError?.(`${reason}. Reconnect failed after ${MAX_RECONNECT} attempts.`);
            return;
        }

        this._reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * this._reconnectAttempts;
        this._setStatus('connecting');
        this.onError?.(`${reason}. Reconnecting (${this._reconnectAttempts}/${MAX_RECONNECT})...`);

        setTimeout(() => {
            if (!this._intentionalDisconnect && this._config) {
                this._initSession(this._config);
            }
        }, delay);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
