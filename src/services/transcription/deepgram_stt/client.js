/**
 * Deepgram Live STT Client + Google Cloud Translation
 *
 * Uses the official @deepgram/sdk v5.
 * Supports both:
 *  - apiKey  → new DeepgramClient({ apiKey })       — BYOK
 *  - token   → new DeepgramClient({ accessToken })  — Transkit Cloud trial
 *
 * Docs: https://developers.deepgram.com/docs/live-streaming-audio
 * Token auth: https://developers.deepgram.com/guides/fundamentals/token-based-authentication
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
        this._utteranceBuffer = '';
        this._currentSpeaker = null;
        this._committedKeys = new Set();
        this._provisionalTimer = null;

        this._translationQueue = Promise.resolve();

        this.onOriginal = null;
        this.onTranslation = null;
        this.onProvisional = null;
        this.onStatusChange = null;
        this.onError = null;
        this.onReconnect = null;
    }

    connect(config) {
        if (!config.apiKey && !config.token) {
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
            token,
            sourceLanguage,
            model = 'nova-3',
            endpointing = 100,
            speakerDiarization = true,
            customContext,
        } = this._config;

        // Use accessToken for cloud trial tokens, apiKey for BYOK
        const sdk = apiKey
            ? new _DeepgramSDK({ apiKey })
            : new _DeepgramSDK({ accessToken: token });

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

        // Custom vocabulary via keyterm (Deepgram Nova-2+)
        const terms = (customContext?.terms ?? []).filter(t => t?.trim());
        if (terms.length > 0) {
            options.keyterm = terms.map(t => t.trim());
        }

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

            socket.on('message', (data) => this._handleMessage(data));

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
                    const msg = apiKey
                        ? 'Invalid API key. Please check your Deepgram key in Settings.'
                        : 'Token invalid or expired. Please try again.';
                    this.onError?.(msg);
                } else {
                    this._tryReconnect(`Connection closed (code: ${event?.code})`);
                }
            });

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

    // ─── Keep-alive ───────────────────────────────────────────────────────────

    _startKeepAlive(socket) {
        this._stopKeepAlive();
        this._keepAliveTimer = setInterval(() => {
            try { socket.sendKeepAlive(); } catch (_) {}
        }, 8000);
    }

    _stopKeepAlive() {
        clearInterval(this._keepAliveTimer);
        this._keepAliveTimer = null;
    }

    // ─── Message handler ──────────────────────────────────────────────────────

    _handleMessage(data) {
        if (data.type !== 'Results') return;
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript?.trim()) return;

        const isFinal = data.is_final === true;
        const speechFinal = data.speech_final === true;
        console.log(`[Deepgram] is_final=${isFinal} speech_final=${speechFinal}:`, transcript);

        if (speechFinal) {
            // Utterance complete — commit the whole accumulated buffer
            this._clearProvisionalTimer();
            this._utteranceBuffer = this._utteranceBuffer
                ? `${this._utteranceBuffer} ${transcript}`.trim()
                : transcript;
            const speaker = this._extractSpeaker(data) ?? this._currentSpeaker;
            // Flush complete sentences first (dedup handles overlap with earlier commits)
            this._flushCompleteSentences(speaker);
            // Commit whatever remains (last sentence that didn't have a following capital)
            if (this._utteranceBuffer.trim()) {
                this._commitUnique(this._utteranceBuffer.trim(), speaker);
            }
            this._utteranceBuffer = '';
            this._currentSpeaker = null;
            this._committedKeys.clear();
            this.onProvisional?.('');

        } else if (isFinal) {
            // Stable segment — accumulate, try early sentence commits, show provisional
            this._utteranceBuffer = this._utteranceBuffer
                ? `${this._utteranceBuffer} ${transcript}`.trim()
                : transcript;
            this._currentSpeaker = this._extractSpeaker(data);
            // Commit complete sentences eagerly (starts translation sooner)
            this._flushCompleteSentences(this._currentSpeaker);
            this.onProvisional?.(this._utteranceBuffer || '');
            // Fallback flush only if buffer looks like a finished sentence —
            // prevents committing mid-phrase fragments during continuous speech
            if (/[.!?]\s*$/.test(this._utteranceBuffer)) {
                this._scheduleProvisionalFlush();
            } else {
                this._clearProvisionalTimer();
            }

        } else {
            // Interim — display only, never commit, cancel any pending flush
            // (active speech means it's too early to treat anything as final)
            const combined = this._utteranceBuffer
                ? `${this._utteranceBuffer} ${transcript}`.trim()
                : transcript;
            this.onProvisional?.(combined);
            this._clearProvisionalTimer();
        }
    }

    // ─── Provisional flush timeout ────────────────────────────────────────────

    // Fallback: commits _utteranceBuffer after silence when speech_final never arrives.
    // Only called from the is_final path when buffer ends with terminal punctuation.
    _scheduleProvisionalFlush() {
        this._clearProvisionalTimer();
        const timeoutMs = this._config?.provisionalTimeoutMs ?? 1500;
        if (!timeoutMs || !this._utteranceBuffer) return;

        this._provisionalTimer = setTimeout(() => {
            const text = this._utteranceBuffer.trim();
            if (!text) return;
            const speaker = this._currentSpeaker;
            this._utteranceBuffer = '';
            this._currentSpeaker = null;
            this._committedKeys.clear();
            this.onProvisional?.('');
            // Split and commit any remaining sentences
            const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
            for (const s of parts) {
                if (s.trim()) this._commitUnique(s.trim(), speaker);
            }
        }, timeoutMs);
    }

    _clearProvisionalTimer() {
        clearTimeout(this._provisionalTimer);
        this._provisionalTimer = null;
    }

    // ─── Sentence splitting ───────────────────────────────────────────────────

    _flushCompleteSentences(speaker) {
        const parts = this._utteranceBuffer.split(/(?<=[.!?])\s+(?=[A-Z])/);
        if (parts.length <= 1) return;

        const complete = parts.slice(0, -1);
        this._utteranceBuffer = parts[parts.length - 1];

        for (const sentence of complete) {
            const s = sentence.trim();
            if (s) this._commitUnique(s, speaker ?? this._currentSpeaker);
        }
    }

    _commitUnique(text, speaker) {
        const key = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').substring(0, 80);
        if (this._committedKeys.has(key)) return;
        this._committedKeys.add(key);
        this._commitWithTranslation(text, speaker);
    }

    // ─── Speaker diarization ─────────────────────────────────────────────────

    _extractSpeaker(data) {
        if (!this._config?.speakerDiarization) return null;
        const words = data.channel?.alternatives?.[0]?.words;
        if (!words?.length) return null;

        const counts = {};
        for (const w of words) {
            if (w.speaker != null) counts[w.speaker] = (counts[w.speaker] ?? 0) + 1;
        }
        const keys = Object.keys(counts);
        if (!keys.length) return null;

        const dominant = keys.reduce((a, b) => counts[a] >= counts[b] ? a : b);
        return `S${dominant}`;
    }

    // ─── Translation ──────────────────────────────────────────────────────────

    _commitWithTranslation(original, speaker) {
        const { targetLanguage, googleApiKey } = this._config ?? {};

        if (!targetLanguage || !googleApiKey) {
            this._commitEntry(original, speaker, original);
            return;
        }

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

    // ─── Reconnect ────────────────────────────────────────────────────────────

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
