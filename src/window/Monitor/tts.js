/**
 * TTSQueue — low-latency pipelined TTS playback
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  PIPELINE                                                            │
 * │                                                                      │
 * │  enqueue(text)                                                       │
 * │    │                                                                 │
 * │    ├─ splitChunks()                                                  │
 * │    │                                                                 │
 * │    ├─ fetch chunk 0 ──────────────────────────────────┐ (parallel)  │
 * │    ├─ fetch chunk 1 ────────────────────────┐         │             │
 * │    └─ fetch chunk N ──────────┐             │         │             │
 * │                               │             │         │             │
 * │    _orderChain (serial) ──────▼─────────────▼─────────▼──           │
 * │    waits for each item in call order, decodes, then pushes to:      │
 * │                                                                      │
 * │    _playQueue [ {buffer, mime, text, rate}, ... ]                    │
 * │                                                                      │
 * │    _advancePlayQueue() — processes ONE item at a time:               │
 * │      source.start(nextTime) → onended → _advancePlayQueue()         │
 * │                                                                      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * This design guarantees:
 *   - No overlapping audio — only one BufferSource plays at a time
 *   - Correct order — items play in enqueue() order regardless of fetch speed
 *   - Near-zero gap — _audioNextTime tracks the exact end of the last item
 *   - Catch-up speed — items scheduled when the queue is long play faster
 *
 * Supported API types:
 *   edge_tts       — Rust built-in Edge TTS (Tauri events, streamed MP3)
 *   vieneu_stream  — POST {serverUrl}/synthesize → raw 32-bit float PCM
 *   openai_compat  — POST {serverUrl}/v1/audio/speech → WAV/PCM
 *   google         — GET translate.google.com TTS → MP3 (sequential)
 */
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { ElevenLabsTTS } from './elevenlabs-tts';
import { callCloudTTS, CLOUD_ENABLED } from '../../lib/transkit-cloud';

// ── Edge TTS native streaming ──────────────────────────────────────────────
// Persistent Tauri event listeners shared across all concurrent synthesis calls.
// Each call gets a unique `id`; chunks and completion are routed by that id.

let _edgeListenersReady = null;
const _edgePending = new Map(); // id → { chunks, resolve, reject } | { onChunk, onDone, onError }

async function initEdgeListeners() {
    if (_edgeListenersReady) return _edgeListenersReady;
    _edgeListenersReady = Promise.all([
        listen('edge_tts_chunk', ({ payload }) => {
            const entry = _edgePending.get(payload.id);
            if (!entry) return;
            const bin = atob(payload.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            // Streaming path (Phase 2 / non-WKWebView)
            if (entry.onChunk) { entry.onChunk(bytes); return; }
            // Buffer-collect path (Phase 1 / macOS)
            entry.chunks.push(bytes);
        }),
        listen('edge_tts_done', ({ payload }) => {
            const entry = _edgePending.get(payload.id);
            if (!entry) return;
            _edgePending.delete(payload.id);
            // Streaming path
            if (entry.onDone || entry.onError) {
                if (payload.error) entry.onError?.(payload.error);
                else entry.onDone?.();
                return;
            }
            // Buffer-collect path
            if (payload.error) {
                entry.reject(new Error(payload.error));
            } else {
                const total = entry.chunks.reduce((s, c) => s + c.length, 0);
                const buf = new Uint8Array(total);
                let off = 0;
                for (const c of entry.chunks) { buf.set(c, off); off += c.length; }
                entry.resolve(buf.buffer);
            }
        }),
    ]).then(() => {});
    return _edgeListenersReady;
}

const SILENT_WAV_URI =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

function wrapPcmInWav(pcmBytes, sampleRate = 24000, channels = 1, bitsPerSample = 16, audioFormat = 1) {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmBytes.byteLength;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const enc = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    enc(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
    enc(8, 'WAVE'); enc(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, audioFormat, true); v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true);  v.setUint32(28, byteRate, true);
    v.setUint16(32, blockAlign, true);  v.setUint16(34, bitsPerSample, true);
    enc(36, 'data'); v.setUint32(40, dataSize, true);
    new Uint8Array(buf, 44).set(new Uint8Array(pcmBytes));
    return buf;
}

// ── TTSQueue ───────────────────────────────────────────────────────────────

export class TTSQueue {
    constructor() {
        // ── playback state ─────────────────────────────────────────────────
        this.isPlaying   = false;
        this.enabled     = false;
        this.playingText = null;

        // ── callbacks ──────────────────────────────────────────────────────
        this.onPlayStart = null;  // (text: string) => void
        this.onPlayEnd   = null;  // () => void

        // ── narration (virtual mic injection) ─────────────────────────────
        /** Set to true to also inject TTS audio into the virtual mic via narration_inject_audio */
        this.narrationEnabled = false;
        /** Mute speaker output when narrating to prevent system-audio feedback loop */
        this.muteWhenNarrating = true;

        // ── config ─────────────────────────────────────────────────────────
        this.sampleRate    = 24000;
        this.apiType       = 'vieneu_stream';
        this.serverUrl     = 'http://localhost:8001';
        this.voiceId       = 'NgocHuyen';
        this.model         = 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf';
        this.googleLang    = 'vi';
        this.googleSpeed   = 1;
        this.baseRate      = 1.0;
        this.volume        = 1.0;   // 0.0–1.0 output volume via GainNode
        this.edgeServerUrl = 'http://localhost:3099';
        this.edgeVoice     = 'vi-VN-HoaiMyNeural';
        this.edgeRate      = '+0%';
        this.edgePitch     = '+0Hz';
        // ElevenLabs
        this.elevenLabsApiKey  = '';
        this.elevenLabsVoiceId = 'FTYCiQT21H9XQvhRu0ch';
        this.elevenLabsModelId = 'eleven_flash_v2_5';
        this.elevenLabsMode    = 'wss'; // 'wss' | 'http'
        // Transkit Cloud TTS
        this.cloudLang = 'auto';

        // ── ElevenLabs provider ────────────────────────────────────────────
        /** @type {ElevenLabsTTS|null} */
        this._elevenlabs = null;

        // ── AudioContext (non-Google types) ────────────────────────────────
        this._audioCtx      = null;
        /** GainNode for output volume control. Recreated with each new AudioContext. */
        this._gainNode      = null;
        /** Absolute AudioContext time when the next item should start. */
        this._audioNextTime = 0;

        // ── play queue ─────────────────────────────────────────────────────
        // Decoded AudioBuffers waiting to be played, in enqueue order.
        /** @type {{ buffer: ArrayBuffer, mime: string, text: string, rate: number }[]} */
        this._playQueue       = [];
        this._playQueueActive = false; // true while _advancePlayQueue is running

        // ── order chain ────────────────────────────────────────────────────
        // Serial Promise chain that adds decoded items to _playQueue in the
        // exact order they were enqueued, even when fetches finish out of order.
        this._orderChain = Promise.resolve();

        // ── pending count (catch-up speed) ─────────────────────────────────
        // Number of items fetched but not yet added to _playQueue.
        // Used by _calcRate() to increase playback speed when backlogged.
        this._pendingCount = 0;

        // ── cancel generation ──────────────────────────────────────────────
        this._generation = 0;

        // ── Google TTS (sequential, HTMLAudioElement) ──────────────────────
        this._googleQueue   = [];
        this._googlePlaying = false;
        this._audio         = null;
        this._blobUrl       = null;
    }

    // ── public config ──────────────────────────────────────────────────────

    updateConfig({
        serverUrl, apiType, voiceId, model, sampleRate,
        googleLang, googleSpeed, baseRate, volume,
        edgeServerUrl, edgeVoice, edgeRate, edgePitch,
        elevenLabsApiKey, elevenLabsVoiceId, elevenLabsModelId, elevenLabsMode,
        cloudLang,
    } = {}) {
        if (serverUrl     !== undefined) this.serverUrl     = serverUrl;
        if (apiType       !== undefined) this.apiType       = apiType;
        if (voiceId       !== undefined) this.voiceId       = voiceId       || 'NgocHuyen';
        if (model         !== undefined) this.model         = model         || 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf';
        if (sampleRate    !== undefined) this.sampleRate    = sampleRate    || 24000;
        if (googleLang    !== undefined) this.googleLang    = googleLang    || 'vi';
        if (googleSpeed   !== undefined) this.googleSpeed   = googleSpeed   || 1;
        if (baseRate      !== undefined) this.baseRate      = baseRate      || 1.0;
        if (volume        !== undefined) {
            this.volume = Math.min(Math.max(volume, 0.0), 1.0);
            // Apply immediately to the live audio element and GainNode.
            if (this._audio) this._audio.volume = this.volume;
            if (this._gainNode) this._gainNode.gain.value = this.volume;
        }
        if (edgeServerUrl !== undefined) this.edgeServerUrl = edgeServerUrl || 'http://localhost:3099';
        if (edgeVoice     !== undefined) this.edgeVoice     = edgeVoice     || 'vi-VN-HoaiMyNeural';
        if (edgeRate      !== undefined) this.edgeRate      = edgeRate      || '+0%';
        if (edgePitch     !== undefined) this.edgePitch     = edgePitch     || '+0Hz';
        if (elevenLabsApiKey  !== undefined) this.elevenLabsApiKey  = elevenLabsApiKey;
        if (elevenLabsVoiceId !== undefined) this.elevenLabsVoiceId = elevenLabsVoiceId || 'FTYCiQT21H9XQvhRu0ch';
        if (elevenLabsModelId !== undefined) this.elevenLabsModelId = elevenLabsModelId || 'eleven_flash_v2_5';
        if (elevenLabsMode    !== undefined) this.elevenLabsMode    = elevenLabsMode    || 'wss';
        if (cloudLang         !== undefined) this.cloudLang         = cloudLang         || 'auto';
        // Re-configure ElevenLabs client if it exists.
        if (this._elevenlabs) {
            this._elevenlabs.updateConfig({
                apiKey:  this.elevenLabsApiKey,
                voiceId: this.elevenLabsVoiceId,
                modelId: this.elevenLabsModelId,
                mode:    this.elevenLabsMode,
            });
        }
    }

    setEnabled(enabled) {
        console.log(`[PTT-TTS] ${Date.now()} setEnabled(${enabled}) apiType:${this.apiType}`);
        if (!enabled) console.trace('[PTT-TTS] setEnabled(false) — call stack:');
        this.enabled = enabled;
        if (enabled) {
            this._unlockAudio();
        } else {
            this.stop();
        }
    }

    // ── enqueue ────────────────────────────────────────────────────────────

    enqueue(text, options = {}) {
        const force = Boolean(options?.force);
        if ((!this.enabled && !force) || !text?.trim()) {
            console.log(`[PTT-TTS] ${Date.now()} enqueue SKIPPED — enabled:${this.enabled} hasText:${!!text?.trim()}`);
            return;
        }
        const { injectNarration } = options;
        const trimmed = text.trim();
        console.log(`[PTT-TTS] ${Date.now()} enqueue START — apiType:${this.apiType} text:"${trimmed.slice(0, 40)}"`);

        if (this.apiType === 'google') {
            this._enqueueGoogle(trimmed, injectNarration, force);
            return;
        }

        if (this.apiType === 'elevenlabs') {
            this._enqueueElevenLabs(trimmed, injectNarration, force);
            return;
        }

        this._enqueueScheduled(trimmed, injectNarration, force);
    }

    // ── replay ─────────────────────────────────────────────────────────────

    replay(text) {
        if (!text?.trim()) return;
        this.enabled = true; // replay is an explicit user action — force-enable regardless of state
        this.stop();
        this._unlockAudio(); // must be AFTER stop() so the new AudioContext is unlocked in the user-gesture context

        const trimmed = text.trim();
        if (this.apiType === 'google') { this._enqueueGoogle(trimmed); return; }
        if (this.apiType === 'elevenlabs') { this._enqueueElevenLabs(trimmed); return; }
        this._enqueueScheduled(trimmed);
    }

    // ── stop ───────────────────────────────────────────────────────────────

    stop() {
        this._generation++;

        // Drop all pending queue work.
        this._orderChain    = Promise.resolve();
        this._pendingCount  = 0;
        this._playQueue     = [];
        this._playQueueActive = false;
        this._audioNextTime = 0;

        // Stop AudioContext (fastest way to silence all scheduled audio).
        if (this._audioCtx && this._audioCtx.state !== 'closed') {
            this._audioCtx.close().catch(() => {});
        }
        this._audioCtx = null;
        this._gainNode = null;

        // Stop ElevenLabs (disconnect WebSocket).
        this._elevenlabs?.stop();

        // Stop Google HTMLAudioElement.
        this._stopGoogle();
        this._googleQueue   = [];
        this._googlePlaying = false;

        this.isPlaying   = false;
        this.playingText = null;
        this.onPlayEnd?.();
    }

    // ── private: ElevenLabs streaming path ────────────────────────────────

    /**
     * Route text to the ElevenLabs WebSocket provider.
     * Uses a persistent WSS stream-input connection — BOS is sent once on
     * connect, subsequent speak() calls have near-zero overhead.
     * The resulting MP3 buffer feeds into the shared _playQueue via the same
     * _orderChain + _advancePlayQueue machinery so playback is always serial.
     */
    _enqueueElevenLabs(text, injectNarration, force = false) {
        if (!this.elevenLabsApiKey) {
            console.warn('[TTS] ElevenLabs: no API key configured');
            return;
        }

        if (!this._elevenlabs) {
            this._elevenlabs = new ElevenLabsTTS({
                apiKey:  this.elevenLabsApiKey,
                voiceId: this.elevenLabsVoiceId,
                modelId: this.elevenLabsModelId,
                mode:    this.elevenLabsMode,
            });
        }

        if (!this.isPlaying) this.isPlaying = true;

        const queueGen = this._generation;
        const forcePlayback = Boolean(force);
        this._pendingCount++;

        // ElevenLabs delivers a single ArrayBuffer per text item.
        // We wrap it in the same _orderChain so it queues behind any items
        // already in-flight.
        const fetchPromise = this._elevenlabs.synthesize(text);

        this._orderChain = this._orderChain
            .then(async () => {
                this._pendingCount = Math.max(0, this._pendingCount - 1);

                let buffer;
                try { buffer = await fetchPromise; } catch (e) {
                    console.error('[TTS] ElevenLabs synthesize failed:', e);
                    return;
                }

                if (!buffer || (!this.enabled && !forcePlayback) || this._generation !== queueGen) return;

                this._playQueue.push({ buffer, mime: 'audio/mpeg', text, rate: this._calcRate(), injectNarration });
                if (!this._playQueueActive) this._advancePlayQueue();
            })
            .catch(err => {
                this._pendingCount = Math.max(0, this._pendingCount - 1);
                console.error('[TTS] ElevenLabs chain error:', String(err));
            });
    }

    // ── private: main scheduled path (edge_tts / vieneu / openai_compat) ──

    /**
     * Parallel fetch + serial queue:
     *
     *  1. Split text into short chunks (edge_tts only).
     *  2. Start ALL fetches immediately in parallel.
     *  3. For each chunk, append a step to `_orderChain`:
     *       a. Wait for this chunk's fetch to complete.
     *       b. Decode the audio data.
     *       c. Push decoded AudioBuffer onto `_playQueue` (in order).
     *       d. Kick _advancePlayQueue() if it's idle.
     *
     * Because all steps go through the single serial `_orderChain`, items
     * always reach _playQueue in enqueue order even when fetch N+1 is faster
     * than fetch N.
     */
    _enqueueScheduled(text, injectNarration, force = false) {
        const chunks = this.apiType === 'edge_tts'
            ? this._splitTextChunks(text)
            : [text];

        const queueGen = this._generation;
        const forcePlayback = Boolean(force);
        if (!this.isPlaying) this.isPlaying = true;

        console.log(`[PTT-TTS] ${Date.now()} _enqueueScheduled — chunks:${chunks.length} apiType:${this.apiType}`);

        // ── Parallel fetch ──────────────────────────────────────────────────
        const fetchPromises = chunks.map((chunk, i) => {
            const t0 = Date.now();
            console.log(`[PTT-TTS] ${t0} fetch[${i}] START — "${chunk.slice(0, 40)}"`);
            return this._fetchAudio(chunk)
                .then(r => {
                    console.log(`[PTT-TTS] ${Date.now()} fetch[${i}] DONE (+${Date.now() - t0}ms) — mime:${r?.mime ?? 'null'} bytes:${r?.buffer?.byteLength ?? 0}`);
                    return r;
                })
                .catch(err => {
                    console.error(`[PTT-TTS] ${Date.now()} fetch[${i}] ERROR (+${Date.now() - t0}ms) — ${err}`);
                    return null;
                });
        });

        this._pendingCount += chunks.length;

        // ── Serial enqueue ──────────────────────────────────────────────────
        // Each iteration appends to _orderChain, ensuring strict ordering.
        for (const [i, fetchPromise] of fetchPromises.entries()) {
            this._orderChain = this._orderChain
                .then(async () => {
                    console.log(`[PTT-TTS] ${Date.now()} orderChain[${i}] awaiting fetch…`);
                    const result = await fetchPromise;

                    // Always decrement so _calcRate() stays accurate.
                    this._pendingCount = Math.max(0, this._pendingCount - 1);

                    const genOk = this._generation === queueGen;
                    console.log(`[PTT-TTS] ${Date.now()} orderChain[${i}] result — mime:${result?.mime ?? 'null'} enabled:${this.enabled} genOk:${genOk}`);
                    if (!result || ((!this.enabled && !forcePlayback)) || !genOk) {
                        console.warn(`[PTT-TTS] ${Date.now()} orderChain[${i}] DROPPED — result:${!!result} enabled:${this.enabled} force:${forcePlayback} genOk:${genOk}`);
                        return;
                    }

                    // Wrap raw PCM-F32 in a WAV header so HTMLAudioElement can play it.
                    let { buffer, mime } = result;
                    if (mime === 'audio/pcm-f32') {
                        buffer = wrapPcmInWav(buffer, this.sampleRate);
                        mime   = 'audio/wav';
                    }

                    console.log(`[PTT-TTS] ${Date.now()} orderChain[${i}] → playQueue — mime:${mime} queueActive:${this._playQueueActive} queueLen:${this._playQueue.length}`);
                    this._playQueue.push({ buffer, mime, text, rate: this._calcRate(), injectNarration });

                    // Start the player if it's idle.
                    if (!this._playQueueActive) this._advancePlayQueue();
                })
                .catch(err => {
                    this._pendingCount = Math.max(0, this._pendingCount - 1);
                    console.error(`[PTT-TTS] ${Date.now()} orderChain[${i}] CHAIN ERROR — ${err}`);
                });
        }
    }

    /**
     * Play the next item from _playQueue via HTMLAudioElement.
     * Called: (a) when a new item is pushed and the player is idle,
     *         (b) after the previous item finishes playing.
     *
     * HTMLAudioElement is used instead of AudioContext because on macOS
     * WKWebView the AudioContext destination does not reliably route to the
     * system audio output (especially when a virtual audio device is active
     * for system-audio capture).  HTMLAudioElement uses AVAudioPlayer which
     * always targets the correct output.
     */
    _advancePlayQueue() {
        if (this._playQueue.length === 0) {
            this._playQueueActive = false;
            this._audioNextTime   = 0;
            this.isPlaying        = false;
            this.playingText      = null;
            return;
        }

        this._playQueueActive = true;

        const { buffer, mime, text, rate, injectNarration } = this._playQueue.shift();
        const gen = this._generation;
        const shouldInjectNarration = injectNarration ?? this.narrationEnabled;

        this.playingText = text;
        this.onPlayStart?.(text);

        // Narration: inject into virtual mic (BlackHole → Zoom)
        if (shouldInjectNarration) {
            this._injectNarration(buffer.slice(0), mime)
                .catch(err => console.error('[Narration] inject error:', err));
        }

        // Speaker playback — muted when narrating to prevent system-audio feedback
        const playVolume = (shouldInjectNarration && this.muteWhenNarrating) ? 0 : undefined;
        this._playViaElement(buffer, mime, rate, playVolume)
            .catch(err => console.error('[TTS] playback error:', err?.message))
            .finally(() => {
                if (this._generation !== gen) return;
                this.playingText = null;
                this.onPlayEnd?.();
                this._advancePlayQueue();
            });
    }

    /**
     * Decode audio buffer to PCM16, then send to Rust narration_inject_audio.
     * Uses AudioContext.decodeAudioData — must receive a copy (buffer.slice(0)) to avoid detach.
     */
    async _injectNarration(bufferCopy, mime) {
        // We need a temporary AudioContext just for decoding
        const ctx = new AudioContext();
        try {
            // WKWebView may create AudioContext in 'suspended' state — must resume before decoding.
            if (ctx.state === 'suspended') await ctx.resume();
            const audioBuffer = await ctx.decodeAudioData(bufferCopy);
            const channelData = audioBuffer.getChannelData(0); // mono
            const sampleRate = audioBuffer.sampleRate;

            // Float32 → PCM16
            const pcm16 = new Int16Array(channelData.length);
            for (let i = 0; i < channelData.length; i++) {
                pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(channelData[i] * 32767)));
            }

            // Int16Array → base64
            const bytes = new Uint8Array(pcm16.buffer);
            let bin = '';
            const CHUNK = 8192;
            for (let i = 0; i < bytes.length; i += CHUNK) {
                bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            await invoke('narration_inject_audio', { pcm16Base64: btoa(bin), sampleRate });
        } finally {
            ctx.close().catch(() => {});
        }
    }

    _calcRate() {
        return this.baseRate || 1.0;
    }

    /**
     * Split text into short chunks for pipelined TTS synthesis.
     * Splits at punctuation boundaries; falls back to the full text.
     * ~60 chars ≈ 8-12 words — short enough for low TTFB, long enough
     * to keep WebSocket round-trips down.
     */
    _splitTextChunks(text, maxLen = 60) {
        if (text.length <= maxLen) return [text];
        const chunks = [];
        const segs = text.split(/(?<=[,，;；!！?？.。、])\s*/);
        let cur = '';
        for (const seg of segs) {
            if (!seg) continue;
            if (cur && cur.length + seg.length > maxLen) {
                chunks.push(cur.trim());
                cur = seg;
            } else {
                cur += (cur ? ' ' : '') + seg;
            }
        }
        if (cur.trim()) chunks.push(cur.trim());
        return chunks.length > 0 ? chunks : [text];
    }

    // ── private: Google TTS path (HTMLAudioElement, sequential) ───────────

    _enqueueGoogle(text, injectNarration, force = false) {
        const promise = this._fetchGoogle(text).catch(err => {
            console.error('[TTS] Google prefetch failed:', String(err));
            return null;
        });
        this._googleQueue.push({ text, promise, injectNarration, force: Boolean(force) });
        if (!this._googlePlaying) this._playNextGoogle();
    }

    async _playNextGoogle() {
        if (this._googleQueue.length === 0) {
            this._googlePlaying = false;
            this.isPlaying      = false;
            this.playingText    = null;
            this.onPlayEnd?.();
            return;
        }
        this._googlePlaying = true;
        this.isPlaying      = true;

        const gen = this._generation;
        const { text, promise, injectNarration, force } = this._googleQueue.shift();
        const shouldInjectNarration = injectNarration ?? this.narrationEnabled;

        try {
            const result = await promise;
            if (this._generation !== gen) return;
            if (!result || (!this.enabled && !force)) {
                if (this._googleQueue.length > 0) this._playNextGoogle();
                else { this._googlePlaying = false; this.isPlaying = false; }
                return;
            }

            this.playingText = text;
            this.onPlayStart?.(text);
            if (shouldInjectNarration) {
                this._injectNarration(result.buffer.slice(0), result.mime)
                    .catch(err => console.error('[Narration] inject error:', err));
            }
            const playVolume = (shouldInjectNarration && this.muteWhenNarrating) ? 0 : undefined;
            await this._playViaElement(result.buffer, result.mime, 1.0, playVolume);

            if (this._generation !== gen) return;
            this.playingText = null;
            this.onPlayEnd?.();
            if (this.enabled && this._googleQueue.length > 0) this._playNextGoogle();
            else { this._googlePlaying = false; this.isPlaying = false; }
        } catch (err) {
            if (this._generation !== gen) return;
            console.error('[TTS] Google play error:', String(err));
            this.playingText = null;
            this.onPlayEnd?.();
            if (this.enabled && this._googleQueue.length > 0) {
                setTimeout(() => this._playNextGoogle(), 200);
            } else {
                this._googlePlaying = false;
                this.isPlaying      = false;
            }
        }
    }

    // ── private: fetch ─────────────────────────────────────────────────────

    /** Returns { buffer: ArrayBuffer, mime: string } */
    async _fetchAudio(text) {
        if (this.apiType === 'google')          return this._fetchGoogle(text);
        if (this.apiType === 'edge_tts')        return this._fetchEdgeTTSNative(text);
        if (this.apiType === 'transkit_cloud')  return this._fetchCloudTTS(text);

        const base = this._base();

        if (this.apiType === 'openai_compat') {
            const res = await tauriFetch(`${base}/v1/audio/speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: Body.json({
                    model: 'tts-1', input: text,
                    voice: this.voiceId || 'alloy', response_format: 'wav',
                }),
                responseType: ResponseType.Binary,
                timeout: 30,
            });
            if (res.status >= 400) throw new Error(`TTS HTTP ${res.status}`);
            const raw = new Uint8Array(res.data);
            const isRiff = raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46;
            return {
                buffer: isRiff ? raw.buffer : wrapPcmInWav(raw.buffer, this.sampleRate, 1, 16, 1),
                mime: 'audio/wav',
            };
        }

        // vieneu_stream
        const reqBody = { text, voice_id: this.voiceId || 'NgocHuyen', chunk_size: 100 };
        if (this.model) reqBody.model = this.model;

        const t0v = Date.now();
        console.log(`[PTT-TTS] ${t0v} vieneu_stream POST ${base}/synthesize voice:${this.voiceId}`);
        const res = await tauriFetch(`${base}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: Body.json(reqBody),
            responseType: ResponseType.Binary,
            timeout: 60,
        });
        console.log(`[PTT-TTS] ${Date.now()} vieneu_stream response (+${Date.now() - t0v}ms) status:${res.status} bytes:${res.data?.length ?? 0}`);
        if (res.status >= 400) throw new Error(`TTS HTTP ${res.status}`);
        const raw = new Uint8Array(res.data);
        const isRiff = raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46;
        if (isRiff) return { buffer: raw.buffer, mime: 'audio/wav' };
        return { buffer: raw.buffer, mime: 'audio/pcm-f32' };
    }

    async _fetchCloudTTS(text) {
        if (!CLOUD_ENABLED) throw new Error('cloud_disabled');
        const t0c = Date.now();
        console.log(`[PTT-TTS] ${t0c} _fetchCloudTTS START voice:${this.voiceId} lang:${this.cloudLang}`);
        const arrayBuffer = await callCloudTTS(text, this.voiceId || 'auto', this.cloudLang || 'auto');
        console.log(`[PTT-TTS] ${Date.now()} _fetchCloudTTS DONE (+${Date.now() - t0c}ms) bytes:${arrayBuffer?.byteLength ?? 0}`);
        return { buffer: arrayBuffer, mime: 'audio/mpeg' };
    }

    async _fetchEdgeTTSNative(text) {
        await initEdgeListeners();

        const id = crypto.randomUUID?.()
            ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

        const t0 = Date.now();
        console.log(`[PTT-TTS] ${t0} _fetchEdgeTTS — id:${id} voice:${this.edgeVoice} text:"${text.slice(0, 40)}"`);

        const buffer = await new Promise((resolve, reject) => {
            _edgePending.set(id, { chunks: [], resolve, reject });
            invoke('synthesize_edge_tts', {
                id,
                text,
                voice: this.edgeVoice || 'vi-VN-HoaiMyNeural',
                rate:  this.edgeRate  || '+0%',
                pitch: this.edgePitch || '+0Hz',
            })
            .then(() => console.log(`[PTT-TTS] ${Date.now()} _fetchEdgeTTS invoke OK (+${Date.now() - t0}ms) — waiting for edge_tts_done event…`))
            .catch(err => {
                console.error(`[PTT-TTS] ${Date.now()} _fetchEdgeTTS invoke FAILED — ${err}`);
                _edgePending.delete(id);
                reject(new Error(String(err)));
            });
        });

        console.log(`[PTT-TTS] ${Date.now()} _fetchEdgeTTS RESOLVED (+${Date.now() - t0}ms) bytes:${buffer?.byteLength ?? 0}`);
        return { buffer, mime: 'audio/mpeg' };
    }

    async _fetchGoogle(text) {
        const params = new URLSearchParams({
            ie: 'UTF-8', q: text, tl: this.googleLang || 'vi',
            total: '1', idx: '0', textlen: String(text.length),
            client: 'tw-ob', prev: 'input', ttsspeed: String(this.googleSpeed ?? 1),
        });
        const res = await tauriFetch(
            `https://translate.google.com/translate_tts?${params}`,
            {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://translate.google.com/',
                },
                responseType: ResponseType.Binary,
                timeout: 15,
            },
        );
        if (res.status >= 400) throw new Error(`Google TTS HTTP ${res.status}`);
        return { buffer: new Uint8Array(res.data).buffer, mime: 'audio/mpeg' };
    }

    // ── private: Google HTMLAudioElement playback ──────────────────────────

    async _playViaElement(buffer, mime = 'audio/mpeg', rate = 1.0, volumeOverride) {
        // WKWebView (Tauri macOS) silently fails to load blob: URLs from HTMLAudioElement.
        // Convert to a data: URL via FileReader to bypass this restriction.
        const url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(new Blob([buffer], { type: mime }));
        });
        if (this._blobUrl?.startsWith('blob:')) URL.revokeObjectURL(this._blobUrl);
        this._blobUrl = null; // data URLs need no revocation

        const audio = this._audio || new Audio();
        this._audio        = audio;
        audio.src          = url;
        audio.playbackRate = Math.min(Math.max(rate || 1.0, 0.1), 4.0);
        audio.volume       = Math.min(Math.max(volumeOverride ?? this.volume ?? 1.0, 0.0), 1.0);

        try {
            await new Promise((resolve, reject) => {
                audio.onended = () => resolve();
                audio.onerror = () => reject(new Error(audio.error?.message ?? 'audio error'));
                audio.play().catch(reject);
            });
            return true;
        } catch (err) {
            console.warn('[TTS] HTMLAudio failed:', err?.name, err?.message);
            return false;
        }
    }

    _stopGoogle() {
        if (this._audio) {
            this._audio.onended = null;
            this._audio.onerror = null;
            try { this._audio.pause(); } catch (_) {}
        }
        if (this._blobUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(this._blobUrl);
        }
        this._blobUrl = null;
    }

    // ── private: AudioContext ──────────────────────────────────────────────

    _getAudioCtx() {
        if (!this._audioCtx || this._audioCtx.state === 'closed') {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this._gainNode = null; // Invalidate gain node — must be recreated for new context.
        }
        return this._audioCtx;
    }

    /**
     * Return (or create) the GainNode for the given AudioContext.
     * Recreated whenever the AudioContext changes (e.g. after stop()).
     */
    _getGainNode(ctx) {
        if (!this._gainNode || this._gainNode.context !== ctx) {
            this._gainNode = ctx.createGain();
            this._gainNode.gain.value = Math.min(Math.max(this.volume ?? 1.0, 0.0), 1.0);
            this._gainNode.connect(ctx.destination);
        }
        return this._gainNode;
    }

    _unlockAudio() {
        // Unlock HTMLAudioElement (Google TTS).
        if (!this._audio) this._audio = new Audio();
        this._audio.src = SILENT_WAV_URI;
        this._audio.play().catch(e => console.debug('[TTS] silent audio.play() error:', e?.name));

        // Unlock AudioContext (non-Google TTS).
        const ctx = this._getAudioCtx();
        console.debug('[TTS] _unlockAudio — ctx.state:', ctx.state);

        const doWarmUp = () => {
            // Play a 1-frame silent buffer through the Web Audio pipeline.
            // On macOS WKWebView this is required to "warm up" the audio output
            // path — without it, the first real BufferSourceNode may produce no
            // sound even though ctx.state === 'running'.
            try {
                const silentBuf = ctx.createBuffer(1, 1, 22050);
                const warmSrc   = ctx.createBufferSource();
                warmSrc.buffer  = silentBuf;
                warmSrc.connect(this._getGainNode(ctx));
                warmSrc.start(0);
            } catch (_) {}
        };

        if (ctx.state === 'suspended') {
            ctx.resume()
                .then(() => {
                    console.debug('[TTS] AudioContext resumed — state now:', ctx.state);
                    doWarmUp();
                })
                .catch(e => console.warn('[TTS] AudioContext.resume() failed:', e?.message));
        } else {
            doWarmUp();
        }
    }

    // ── private: helpers ───────────────────────────────────────────────────

    _base()     { return this.serverUrl.replace(/\/+$/, ''); }
    _edgeBase() { return (this.edgeServerUrl || 'http://localhost:3099').replace(/\/+$/, ''); }
}

// ── singleton ──────────────────────────────────────────────────────────────

let instance = null;
export function getTTSQueue() {
    if (!instance) instance = new TTSQueue();
    return instance;
}
