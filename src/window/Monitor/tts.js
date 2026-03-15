/**
 * TTSQueue — low-latency pipelined TTS playback
 *
 * Pipeline: fetch starts immediately on enqueue → overlaps with current playback.
 * Generation counter: stop()/replay() increments it so stale async ops bail out.
 *
 * Playback strategy:
 *   - VieNeu / OpenAI compat → AudioContext (independent of cpal input stream)
 *   - Google TTS (MP3)       → HTMLAudioElement (simpler, always works for MP3)
 *
 * Supported API types:
 *   vieneu_stream  — POST {serverUrl}/synthesize → raw 32-bit float PCM
 *   openai_compat  — POST {serverUrl}/v1/audio/speech → WAV/PCM bytes
 *   google         — GET  translate.google.com TTS    → MP3
 */
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';

const SILENT_WAV_URI =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/** Wrap raw PCM bytes in a WAV header. audioFormat: 1=PCM int, 3=IEEE float */
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

export class TTSQueue {
    constructor() {
        this.readyQueue = [];
        this.isPlaying = false;
        this.enabled = false;
        this.playingText = null;
        this.sampleRate = 24000;
        this._generation = 0;

        // HTMLAudioElement — used only for Google MP3
        this._audio = null;
        this._blobUrl = null;

        // AudioContext — used for VieNeu / OpenAI PCM
        this._audioCtx = null;
        this._currentSource = null;

        this.onPlayStart = null;
        this.onPlayEnd = null;

        this.serverUrl = 'http://localhost:8001';
        this.apiType = 'vieneu_stream';
        this.voiceId = 'NgocHuyen';
        this.model = 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf';
        this.googleLang = 'vi';
        this.googleSpeed = 1;
        this.baseRate = 1.0; // user-configured base playback speed
        // Edge TTS params
        this.edgeServerUrl = 'http://localhost:3099';
        this.edgeVoice = 'vi-VN-HoaiMyNeural';
        this.edgeRate = '+0%';
        this.edgePitch = '+0Hz';
    }

    updateConfig({ serverUrl, apiType, voiceId, model, sampleRate, googleLang, googleSpeed, baseRate, edgeServerUrl, edgeVoice, edgeRate, edgePitch } = {}) {
        if (serverUrl   !== undefined) this.serverUrl  = serverUrl;
        if (apiType     !== undefined) this.apiType    = apiType;
        if (voiceId     !== undefined) this.voiceId    = voiceId    || 'NgocHuyen';
        if (model       !== undefined) this.model      = model      || 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf';
        if (sampleRate  !== undefined) this.sampleRate = sampleRate || 24000;
        if (googleLang  !== undefined) this.googleLang = googleLang || 'vi';
        if (googleSpeed !== undefined) this.googleSpeed = googleSpeed || 1;
        if (baseRate    !== undefined) this.baseRate    = baseRate   || 1.0;
        if (edgeServerUrl !== undefined) this.edgeServerUrl = edgeServerUrl || 'http://localhost:3099';
        if (edgeVoice   !== undefined) this.edgeVoice  = edgeVoice  || 'vi-VN-HoaiMyNeural';
        if (edgeRate    !== undefined) this.edgeRate   = edgeRate   || '+0%';
        if (edgePitch   !== undefined) this.edgePitch  = edgePitch  || '+0Hz';
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled) this._unlockAudio();
        else this.stop();
    }

    enqueue(text) {
        if (!this.enabled || !text?.trim()) return;
        const trimmed = text.trim();
        const promise = this._fetchAudio(trimmed).catch(err => {
            console.error('[TTS] prefetch failed:', String(err));
            return null;
        });
        this.readyQueue.push({ text: trimmed, promise });
        if (!this.isPlaying) this._playNext();
    }

    replay(text) {
        if (!text?.trim()) return;
        this._unlockAudio();
        this._cancel();
        const trimmed = text.trim();
        const promise = this._fetchAudio(trimmed).catch(err => {
            console.error('[TTS] replay fetch failed:', String(err));
            return null;
        });
        this.readyQueue = [{ text: trimmed, promise }];
        this._playNext();
    }

    stop() {
        this._cancel();
        this.readyQueue = [];
    }

    // ─── private ────────────────────────────────────────────────────────────

    _base() { return this.serverUrl.replace(/\/+$/, ''); }
    _edgeBase() { return (this.edgeServerUrl || 'http://localhost:3099').replace(/\/+$/, ''); }

    _cancel() {
        this._generation++;
        this._stopCurrent();
        this.isPlaying = false;
        this.playingText = null;
        this.onPlayEnd?.();
    }

    /** Called during user gesture to unlock both audio backends */
    _unlockAudio() {
        // Unlock HTMLAudioElement (for Google TTS MP3)
        if (!this._audio) this._audio = new Audio();
        this._audio.src = SILENT_WAV_URI;
        this._audio.play().catch(() => {});

        // Create AudioContext during user gesture so it's allowed to play later
        const ctx = this._getAudioContext();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    }

    _getAudioContext() {
        if (!this._audioCtx || this._audioCtx.state === 'closed') {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this._audioCtx;
    }

    _stopCurrent() {
        // Stop AudioContext source
        if (this._currentSource) {
            try { this._currentSource.stop(); } catch (_) {}
            this._currentSource = null;
        }
        // Stop HTMLAudioElement
        if (this._audio) {
            this._audio.onended = null;
            this._audio.onerror = null;
            try { this._audio.pause(); } catch (_) {}
        }
        if (this._blobUrl) {
            URL.revokeObjectURL(this._blobUrl);
            this._blobUrl = null;
        }
    }

    /** Returns { buffer: ArrayBuffer, mime: string } */
    async _fetchAudio(text) {
        if (this.apiType === 'google') return this._fetchGoogle(text);
        if (this.apiType === 'edge_tts') return this._fetchEdgeTTS(text);

        const base = this._base();

        if (this.apiType === 'openai_compat') {
            const res = await tauriFetch(`${base}/v1/audio/speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: Body.json({ model: 'tts-1', input: text, voice: this.voiceId || 'alloy', response_format: 'wav' }),
                responseType: ResponseType.Binary,
                timeout: 30,
            });
            if (res.status >= 400) throw new Error(`TTS HTTP ${res.status}`);
            const raw = new Uint8Array(res.data);
            const isRiff = raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46;
            // Ensure it's a WAV file with a header so decodeAudioData can handle it
            return { buffer: isRiff ? raw.buffer : wrapPcmInWav(raw.buffer, this.sampleRate, 1, 16, 1), mime: 'audio/wav' };
        }

        // vieneu_stream → POST /synthesize
        const reqBody = {
            text,
            voice_id: this.voiceId || 'NgocHuyen',
            chunk_size: 100,
        };
        // Include model only if explicitly configured
        if (this.model) reqBody.model = this.model;

        const res = await tauriFetch(`${base}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: Body.json(reqBody),
            responseType: ResponseType.Binary,
            timeout: 60,
        });
        if (res.status >= 400) throw new Error(`TTS HTTP ${res.status}`);
        const raw = new Uint8Array(res.data);
        const isRiff = raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46;
        if (isRiff) {
            // Proper WAV file — HTMLAudioElement handles it best
            return { buffer: raw.buffer, mime: 'audio/wav' };
        }
        // Raw 32-bit float PCM (no header) — AudioContext direct copy path
        return { buffer: raw.buffer, mime: 'audio/pcm-f32' };
    }

    async _fetchEdgeTTS(text) {
        // Calls the local edge-tts-server (Node.js) — browser WebSocket can't set
        // the required Sec-WebSocket-Version header for Microsoft's TTS service.
        const base = this._edgeBase();
        const res = await tauriFetch(`${base}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: Body.json({
                text,
                voice: this.edgeVoice || 'vi-VN-HoaiMyNeural',
                rate: this.edgeRate || '+0%',
                pitch: this.edgePitch || '+0Hz',
            }),
            responseType: ResponseType.Binary,
            timeout: 30,
        });
        if (res.status >= 400) throw new Error(`Edge TTS HTTP ${res.status}`);
        return { buffer: new Uint8Array(res.data).buffer, mime: 'audio/mpeg' };
    }

    async _fetchGoogle(text) {
        const params = new URLSearchParams({
            ie: 'UTF-8', q: text, tl: this.googleLang || 'vi',
            total: '1', idx: '0', textlen: String(text.length),
            client: 'tw-ob', prev: 'input', ttsspeed: String(this.googleSpeed ?? 1),
        });
        const res = await tauriFetch(`https://translate.google.com/translate_tts?${params}`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://translate.google.com/',
            },
            responseType: ResponseType.Binary,
            timeout: 15,
        });
        if (res.status >= 400) throw new Error(`Google TTS HTTP ${res.status}`);
        return { buffer: new Uint8Array(res.data).buffer, mime: 'audio/mpeg' };
    }

    /**
     * Play via Web Audio API (AudioContext).
     * Works independently of cpal input streams — no conflict with audio capture.
     *
     * mime 'audio/pcm-f32': raw 32-bit float PCM → copied directly into AudioBuffer
     * mime 'audio/wav':     decoded via decodeAudioData (supports 16-bit PCM WAV)
     */
    async _playViaAudioCtx(buffer, mime, playbackRate = 1.0, gen) {
        const ctx = this._getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();

        let audioBuffer;
        if (mime === 'audio/pcm-f32') {
            const float32 = new Float32Array(buffer);
            audioBuffer = ctx.createBuffer(1, float32.length, this.sampleRate);
            audioBuffer.getChannelData(0).set(float32);
        } else {
            audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
        }

        await new Promise((resolve, reject) => {
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = playbackRate;
            source.connect(ctx.destination);
            source.onended = () => { this._currentSource = null; resolve(); };
            this._currentSource = source;
            const stopWatcher = this._startRateWatcher(() => this._currentSource, gen ?? this._generation);
            source.onended = () => { stopWatcher(); this._currentSource = null; resolve(); };
            try {
                source.start(0);
            } catch (err) {
                stopWatcher();
                this._currentSource = null;
                reject(err);
            }
        });
    }

    /** Play via HTMLAudioElement — used for MP3 and standard WAV */
    async _playViaElement(buffer, mime = 'audio/mpeg', playbackRate = 1.0, gen) {
        const blob = new Blob([buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        if (this._blobUrl) URL.revokeObjectURL(this._blobUrl);
        this._blobUrl = url;
        const audio = this._audio || new Audio();
        this._audio = audio;
        audio.src = url;
        audio.playbackRate = playbackRate;
        try {
            await new Promise((resolve, reject) => {
                const stopWatcher = this._startRateWatcher(() => this._audio, gen ?? this._generation);
                audio.onended = () => { stopWatcher(); resolve(); };
                audio.onerror = () => { stopWatcher(); reject(new Error(audio.error?.message ?? 'audio error')); };
                audio.play().catch(err => { stopWatcher(); reject(err); });
            });
            return true;
        } catch (err) {
            console.warn('[TTS] HTMLAudio failed:', err?.name, err?.message);
            return false;
        }
    }

    /**
     * Compute playback rate: baseRate scaled up when items are waiting.
     * Multipliers: ×1.0 / ×1.5 / ×2.0 / ×2.5 relative to baseRate.
     * Capped at 4.0× to stay comprehensible.
     */
    _playbackRate() {
        const base = this.baseRate || 1.0;
        const n = this.readyQueue.length;
        const mul = n >= 3 ? 2.5 : n === 2 ? 2.0 : n === 1 ? 1.5 : 1.0;
        return Math.min(base * mul, 4.0);
    }

    /**
     * Dynamically update playback rate while an item is playing.
     * Queue may grow during playback (prefetch completes), so we
     * re-check every 300ms and bump rate if needed.
     * Returns a cancel function.
     */
    _startRateWatcher(getAudioNode, gen) {
        const id = setInterval(() => {
            if (this._generation !== gen) { clearInterval(id); return; }
            const rate = this._playbackRate();
            const node = getAudioNode();
            if (!node) return;
            // HTMLAudioElement
            if (node instanceof HTMLMediaElement && node.playbackRate !== rate) {
                node.playbackRate = rate;
                if (rate > 1.0) console.debug(`[TTS] rate → ${rate}x (queue: ${this.readyQueue.length})`);
            }
            // AudioBufferSourceNode
            if (node.playbackRate && typeof node.playbackRate.value === 'number' && node.playbackRate.value !== rate) {
                node.playbackRate.value = rate;
                if (rate > 1.0) console.debug(`[TTS] rate → ${rate}x (queue: ${this.readyQueue.length})`);
            }
        }, 300);
        return () => clearInterval(id);
    }

    async _playNext() {
        if (this.readyQueue.length === 0) {
            this.isPlaying = false;
            this.playingText = null;
            this.onPlayEnd?.();
            return;
        }
        this.isPlaying = true;
        const gen = this._generation;
        const { text, promise } = this.readyQueue.shift();

        try {
            const result = await promise;
            if (this._generation !== gen) return;
            if (!result || !this.enabled) {
                if (this.readyQueue.length > 0) this._playNext();
                else this.isPlaying = false;
                return;
            }

            const { buffer, mime } = result;
            const rate = this._playbackRate();
            this.playingText = text;
            this.onPlayStart?.(text);

            if (mime === 'audio/pcm-f32') {
                // Raw 32-bit float PCM — AudioContext direct copy
                await this._playViaAudioCtx(buffer, mime, rate, gen);
            } else {
                // Proper WAV or MP3 — HTMLAudioElement first (reliable for standard files)
                const played = await this._playViaElement(buffer, mime, rate, gen);
                if (this._generation !== gen) return;
                if (!played) {
                    // Fallback: AudioContext decodeAudioData
                    console.warn('[TTS] HTMLAudio failed, trying AudioContext');
                    await this._playViaAudioCtx(buffer, mime, rate, gen);
                }
            }

            if (this._generation !== gen) return;
            this.playingText = null;
            this.onPlayEnd?.();
            if (this.enabled && this.readyQueue.length > 0) this._playNext();
            else this.isPlaying = false;
        } catch (err) {
            if (this._generation !== gen) return;
            console.error('[TTS] Error:', String(err));
            this.playingText = null;
            this.onPlayEnd?.();
            if (this.enabled && this.readyQueue.length > 0) setTimeout(() => this._playNext(), 200);
            else this.isPlaying = false;
        }
    }
}

let instance = null;
export function getTTSQueue() {
    if (!instance) instance = new TTSQueue();
    return instance;
}
