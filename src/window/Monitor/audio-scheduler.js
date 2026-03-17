/**
 * AudioScheduler — gap-free, sequential Web Audio API playback.
 *
 * Items are decoded and scheduled at absolute AudioContext times so
 * consecutive items play back-to-back with zero gap.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  push(buffer)  ──▶  _pushChain (serial)  ──▶  source.start(t) │
 * │                     ensures ordering even with concurrent calls │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * push() can be called concurrently from multiple places but items will
 * always play in call order because scheduling is serialised internally
 * via `_pushChain`.  decodeAudioData for item N+1 starts only after
 * item N has been fully scheduled (nextTime updated).
 *
 * Supported MIME types:
 *   'audio/mpeg'    — MP3  → decodeAudioData
 *   'audio/wav'     — WAV  → decodeAudioData
 *   'audio/pcm-f32' — raw 32-bit float PCM (requires sampleRate option)
 *
 * Callbacks:
 *   onStart(text)  — fires when an item begins playing (via setTimeout)
 *   onEnd(text)    — fires when source.onended fires for an item
 *   onIdle()       — fires once all scheduled items have finished
 */
export class AudioScheduler {
    constructor() {
        /** @type {AudioContext|null} */
        this._ctx      = null;
        /** Absolute AudioContext time for the next item's start. */
        this._nextTime = 0;
        /** Number of sources currently scheduled or playing. */
        this._active   = 0;
        /** Monotonically increasing cancel token. */
        this._gen      = 0;
        /**
         * Serial chain — push() calls are queued here so that item N+1 is
         * never scheduled before item N (even when decode times differ).
         */
        this._pushChain = Promise.resolve();

        /** @type {((text: string|undefined) => void)|null} */
        this.onStart = null;
        /** @type {((text: string|undefined) => void)|null} */
        this.onEnd   = null;
        /** @type {(() => void)|null} */
        this.onIdle  = null;
    }

    // ── public API ─────────────────────────────────────────────────────────

    /**
     * Unlock the AudioContext. Call during a user-gesture handler before
     * the first push(), otherwise autoplay policy may block audio.
     */
    async unlock() {
        const ctx = this._getCtx();
        if (ctx.state === 'suspended') await ctx.resume();
    }

    /**
     * Decode `buffer` and schedule it for gapless playback after the last item.
     *
     * Calls are serialised: push(A) then push(B) guarantees A plays before B
     * regardless of whether B's decode finishes first.
     *
     * @param {ArrayBuffer} buffer
     * @param {object}      [opts]
     * @param {string}  [opts.text]       — label forwarded to onStart / onEnd
     * @param {number}  [opts.gen]        — cancel token; item dropped if stale
     * @param {string}  [opts.mime]       — audio format (default 'audio/mpeg')
     * @param {number}  [opts.sampleRate] — required for mime 'audio/pcm-f32'
     * @param {number}  [opts.rate]       — playbackRate 0.1–4.0 (default 1.0)
     * @returns {Promise<void>}
     */
    push(buffer, opts = {}) {
        // Append to the serial chain.  Each item waits for the previous to
        // finish (including its decodeAudioData) before starting its own.
        const step = this._pushChain.then(() => this._doPush(buffer, opts));
        // Keep the chain alive even when a step rejects (don't propagate errors
        // into the next item's scheduling).
        this._pushChain = step.catch(() => {});
        return step;
    }

    /**
     * Stop all playback immediately and discard any in-flight push() calls.
     *
     * Closes the AudioContext (fastest way to halt all scheduled audio).
     * The context is recreated lazily on the next push().
     */
    cancel() {
        this._gen++;
        this._active    = 0;
        this._nextTime  = 0;
        this._pushChain = Promise.resolve(); // Drop all pending chain steps.
        if (this._ctx && this._ctx.state !== 'closed') {
            this._ctx.close().catch(() => {});
        }
        this._ctx = null;
    }

    // ── private ────────────────────────────────────────────────────────────

    async _doPush(buffer, { text, gen, mime = 'audio/mpeg', sampleRate = 24000, rate = 1.0 } = {}) {
        if (!this._isAlive(gen)) return;

        const ctx = this._getCtx();
        if (ctx.state === 'suspended') await ctx.resume();

        // ── Decode ──────────────────────────────────────────────────────────
        let audioBuffer;
        try {
            if (mime === 'audio/pcm-f32') {
                const f32 = new Float32Array(buffer);
                audioBuffer = ctx.createBuffer(1, f32.length, sampleRate);
                audioBuffer.getChannelData(0).set(f32);
            } else {
                audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
            }
        } catch (e) {
            console.warn('[AudioScheduler] decodeAudioData failed:', e?.message ?? e);
            return;
        }

        // Re-check after async decode — cancel may have fired while awaiting.
        if (!this._isAlive(gen)) return;

        // ── Schedule ────────────────────────────────────────────────────────
        // 5 ms lookahead ensures the source is ready before its start time.
        const now      = ctx.currentTime;
        const startAt  = Math.max(now + 0.005, this._nextTime);
        this._nextTime = startAt + audioBuffer.duration;
        this._active++;

        const src = ctx.createBufferSource();
        src.buffer             = audioBuffer;
        src.playbackRate.value = Math.min(Math.max(rate, 0.1), 4.0);
        src.connect(ctx.destination);
        src.start(startAt);

        // Fire onStart at the moment audio actually begins.
        const fireTid = setTimeout(() => {
            if (!this._isAlive(gen)) return;
            this.onStart?.(text);
        }, Math.max(0, (startAt - now) * 1000));

        src.onended = () => {
            clearTimeout(fireTid);
            // Guard against spurious onended after AudioContext.close().
            if (!this._isAlive(gen)) return;
            this._active = Math.max(0, this._active - 1);
            this.onEnd?.(text);
            if (this._active === 0) {
                this._nextTime = 0;
                this.onIdle?.();
            }
        };
    }

    _getCtx() {
        if (!this._ctx || this._ctx.state === 'closed') {
            this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this._ctx;
    }

    _isAlive(gen) {
        return gen === undefined || gen === this._gen;
    }
}
