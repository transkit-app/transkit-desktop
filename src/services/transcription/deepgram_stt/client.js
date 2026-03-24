/**
 * Deepgram Live STT Client + Google Cloud Translation
 *
 * Uses the official @deepgram/sdk v5.
 * Since Deepgram has no native translation, final utterances (speech_final=true)
 * are translated via Google Cloud Translation REST API.
 *
 * Docs: https://developers.deepgram.com/docs/live-streaming-audio
 */

import { DeepgramClient as _DeepgramSDK } from '@deepgram/sdk';

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

export class DeepgramClient {
    constructor() {
        this._socket = null;
        this.isConnected = false;
        this._reconnectAttempts = 0;
        this._config = null;
        this._intentionalDisconnect = false;
        this._keepAliveTimer = null;
        this._utteranceBuffer = '';   // accumulates is_final=true segments within an utterance
        this._currentSpeaker = null;  // most recent speaker seen in is_final results
        this._committedKeys = new Set(); // dedup: avoid double-commit between interim and is_final
        this._provisionalTimer = null; // flush provisional after silence timeout

        // Chain translation promises to preserve utterance order
        this._translationQueue = Promise.resolve();

        // Callbacks — same interface as SonioxClient / GladiaClient
        this.onOriginal = null;      // (text, speaker) => {}
        this.onTranslation = null;   // (text) => {}
        this.onProvisional = null;   // (text) => {}
        this.onStatusChange = null;  // (status) => {}
        this.onError = null;         // (message) => {}
        this.onReconnect = null;     // () => {}
    }

    connect(config) {
        if (!config.apiKey) {
            this._setStatus('error');
            this.onError?.('Deepgram API key is required. Please add it in Settings.');
            return;
        }

        this._config = config;
        this._intentionalDisconnect = false;
        this._reconnectAttempts = 0;
        this._translationQueue = Promise.resolve();
        this._utteranceBuffer = '';
        this._currentSpeaker = null;
        this._committedKeys.clear();
        this._clearProvisionalTimer();

        this._openConnection();
    }

    async _openConnection() {
        this._setStatus('connecting');

        const {
            apiKey,
            sourceLanguage,
            model = 'nova-3',
            endpointing = 100,
            speakerDiarization = true,
        } = this._config;

        const sdk = new _DeepgramSDK({ apiKey });

        const options = {
            model,
            language: sourceLanguage || 'en',
            encoding: 'linear16',
            sample_rate: 16000,
            channels: 1,
            interim_results: true,
            punctuate: true,
            endpointing,
        };

        if (speakerDiarization) options.diarize = true;

        try {
            const socket = await sdk.listen.v1.createConnection(options);

            socket.on('open', () => {
                if (this._intentionalDisconnect) return;
                const wasReconnect = this._reconnectAttempts > 0;
                this._socket = socket;
                this.isConnected = true;
                this._reconnectAttempts = 0;
                this._setStatus('connected');
                console.log('[Deepgram] Connected');
                this._startKeepAlive(socket);
                if (wasReconnect) this.onReconnect?.();
            });

            socket.on('message', (data) => {
                if (data.type !== 'Results') return;
                const transcript = data.channel?.alternatives?.[0]?.transcript;
                if (!transcript?.trim()) return;

                const isFinal = data.is_final === true;
                const speechFinal = data.speech_final === true;
                console.log(`[Deepgram] Results is_final=${isFinal} speech_final=${speechFinal}:`, transcript);

                if (speechFinal) {
                    // End of utterance — flush sentences, commit remainder, reset state
                    this._utteranceBuffer = this._utteranceBuffer
                        ? `${this._utteranceBuffer} ${transcript}`.trim()
                        : transcript;
                    const speaker = this._extractSpeaker(data) ?? this._currentSpeaker;
                    this._flushCompleteSentences(speaker);
                    if (this._utteranceBuffer.trim()) {
                        this._commitUnique(this._utteranceBuffer.trim(), speaker);
                    }
                    this._utteranceBuffer = '';
                    this._currentSpeaker = null;
                    this._committedKeys.clear();
                    this._clearProvisionalTimer();
                } else if (isFinal) {
                    // Stable segment — append to buffer, flush complete sentences
                    this._utteranceBuffer = this._utteranceBuffer
                        ? `${this._utteranceBuffer} ${transcript}`.trim()
                        : transcript;
                    this._currentSpeaker = this._extractSpeaker(data);
                    this._flushCompleteSentences(this._currentSpeaker);
                    const rem = this._utteranceBuffer || '';
                    this.onProvisional?.(rem);
                    this._scheduleProvisionalFlush(rem);
                } else {
                    // Interim — split on sentence boundaries immediately for real-time feel.
                    const combined = this._utteranceBuffer
                        ? `${this._utteranceBuffer} ${transcript}`.trim()
                        : transcript;
                    const parts = combined.split(/(?<=[.!?])\s+(?=[A-Z])/);
                    if (parts.length > 1) {
                        for (const s of parts.slice(0, -1)) {
                            if (s.trim()) this._commitUnique(s.trim(), this._currentSpeaker);
                        }
                        this._utteranceBuffer = '';
                        const frag = parts[parts.length - 1];
                        this.onProvisional?.(frag);
                        this._scheduleProvisionalFlush(frag);
                    } else {
                        this.onProvisional?.(combined);
                        this._scheduleProvisionalFlush(combined);
                    }
                }
            });

            socket.on('error', (err) => {
                console.error('[Deepgram] Error:', err);
                if (!this._intentionalDisconnect) {
                    this.onError?.(err?.message ?? String(err));
                }
            });

            socket.on('close', (event) => {
                this.isConnected = false;
                if (this._socket === socket) this._socket = null;
                console.log('[Deepgram] Closed, code:', event?.code);

                if (this._intentionalDisconnect) {
                    this._setStatus('disconnected');
                    return;
                }

                if (event?.code === 1008) {
                    this._setStatus('error');
                    this.onError?.('Invalid API key. Please check your Deepgram key in Settings.');
                } else {
                    this._tryReconnect(`Connection closed (code: ${event?.code})`);
                }
            });

            // Must call connect() explicitly — createConnection only builds the socket object
            socket.connect();

        } catch (err) {
            if (this._intentionalDisconnect) return;
            console.error('[Deepgram] Failed to create connection:', err);
            this._tryReconnect(`Failed to connect: ${err.message}`);
        }
    }

    sendAudio(pcmData) {
        if (this._socket && this.isConnected) {
            this._socket.sendMedia(new Uint8Array(pcmData));
        }
    }

    disconnect() {
        this._intentionalDisconnect = true;
        this._stopKeepAlive();
        this._clearProvisionalTimer();

        if (this._socket) {
            try {
                this._socket.sendCloseStream();
                this._socket.close();
            } catch (err) {
                console.error('[Deepgram] Error during disconnect:', err);
            }
            this._socket = null;
        }

        this.isConnected = false;
        this._setStatus('disconnected');
    }

    // ─── Keep-alive ───────────────────────────────────────────

    _startKeepAlive(socket) {
        this._stopKeepAlive();
        this._keepAliveTimer = setInterval(() => {
            try {
                socket.sendKeepAlive();
            } catch (_) {}
        }, 8000);
    }

    _stopKeepAlive() {
        clearInterval(this._keepAliveTimer);
        this._keepAliveTimer = null;
    }

    // ─── Provisional flush timeout ────────────────────────────

    /**
     * Reset the silence timer every time provisional text is updated.
     * If no new data arrives within `provisionalTimeoutMs`, commit whatever
     * is left in buffer + current provisional as a final entry.
     */
    _scheduleProvisionalFlush(provisionalText) {
        this._clearProvisionalTimer();
        const timeoutMs = this._config?.provisionalTimeoutMs ?? 1500;
        if (!timeoutMs || !provisionalText) return;

        this._provisionalTimer = setTimeout(() => {
            const text = (this._utteranceBuffer
                ? `${this._utteranceBuffer} ${provisionalText}`.trim()
                : provisionalText).trim();
            if (!text) return;

            this._utteranceBuffer = '';
            this._currentSpeaker = null;
            this._committedKeys.clear();
            this._commitUnique(text, this._currentSpeaker);
            this.onProvisional?.('');
        }, timeoutMs);
    }

    _clearProvisionalTimer() {
        clearTimeout(this._provisionalTimer);
        this._provisionalTimer = null;
    }

    // ─── Sentence splitting ───────────────────────────────────

    /**
     * Scan the utterance buffer for complete sentences (ending with . ? !)
     * followed by a capital letter (next sentence start). Commit each complete
     * sentence immediately so translation starts without waiting for silence.
     *
     * Example:
     *   buffer = "Is simply too complex. Take this example. If I"
     *   → commits "Is simply too complex." and "Take this example."
     *   → leaves  "If I" in buffer
     */
    _flushCompleteSentences(speaker) {
        // Split on sentence-ending punctuation followed by whitespace + capital letter
        // Lookbehind (?<=[.!?]) ensures we keep the punctuation with the sentence
        const parts = this._utteranceBuffer.split(/(?<=[.!?])\s+(?=[A-Z])/);
        if (parts.length <= 1) return;

        const complete = parts.slice(0, -1);
        this._utteranceBuffer = parts[parts.length - 1];

        for (const sentence of complete) {
            const s = sentence.trim();
            if (s) this._commitUnique(s, speaker ?? this._currentSpeaker);
        }
    }

    /**
     * Commit a sentence only if not already committed in this utterance.
     * Deduplicates between interim commits and subsequent is_final commits of same text.
     */
    _commitUnique(text, speaker) {
        // Normalize: lowercase, collapse whitespace, strip punctuation for comparison
        const key = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').substring(0, 80);
        if (this._committedKeys.has(key)) return;
        this._committedKeys.add(key);
        this._commitWithTranslation(text, speaker);
    }

    // ─── Speaker diarization ─────────────────────────────────

    _extractSpeaker(data) {
        if (!this._config?.speakerDiarization) return null;
        const words = data.channel?.alternatives?.[0]?.words;
        if (!words?.length) return null;

        const counts = {};
        for (const w of words) {
            if (w.speaker != null) {
                counts[w.speaker] = (counts[w.speaker] ?? 0) + 1;
            }
        }
        const keys = Object.keys(counts);
        if (!keys.length) return null;

        const dominant = keys.reduce((a, b) => counts[a] >= counts[b] ? a : b);
        return `S${dominant}`;
    }

    // ─── Translation ──────────────────────────────────────────

    _commitWithTranslation(original, speaker) {
        const { targetLanguage, googleApiKey } = this._config ?? {};

        if (!targetLanguage || !googleApiKey) {
            this._commitEntry(original, speaker, original);
            return;
        }

        // Show original immediately while translation fetches
        this.onProvisional?.(original);

        this._translationQueue = this._translationQueue.then(async () => {
            if (this._intentionalDisconnect) return;
            try {
                const translated = await this._googleTranslate(original, targetLanguage, this._config.sourceLanguage);
                this._commitEntry(original, speaker, translated);
            } catch (err) {
                console.warn('[Deepgram] Translation failed, using original:', err.message);
                this._commitEntry(original, speaker, original);
                this.onError?.(`Translation error: ${err.message}`);
            }
        });
    }

    async _googleTranslate(text, targetLanguage, sourceLanguage) {
        const { googleApiKey } = this._config;

        const body = { q: text, target: targetLanguage, format: 'text' };
        if (sourceLanguage) body.source = sourceLanguage;

        const response = await fetch(`${GOOGLE_TRANSLATE_URL}?key=${encodeURIComponent(googleApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            if (response.status === 403) throw new Error('Invalid Google API key or Cloud Translation API not enabled');
            throw new Error(`Google Translate error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const translated = data?.data?.translations?.[0]?.translatedText;
        if (!translated) throw new Error('Empty translation response');
        return translated;
    }

    _commitEntry(original, speaker, translation) {
        this.onOriginal?.(original, speaker);
        this.onTranslation?.(translation);
        this.onProvisional?.('');
    }

    // ─── Reconnect ────────────────────────────────────────────

    _tryReconnect(reason) {
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
                this._openConnection();
            }
        }, delay);
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}
