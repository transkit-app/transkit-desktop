/**
 * EdgeTTSStream — true streaming playback for Edge TTS using MediaSource API.
 *
 * Instead of waiting for the full synthesis to complete, this feeds each MP3
 * chunk into a MediaSource SourceBuffer as it arrives from the Rust backend.
 * Audio playback begins on the very first chunk (~150 ms TTFB vs ~300 ms
 * when waiting for the full file).
 *
 * Usage:
 *   const stream = new EdgeTTSStream();
 *   stream.onEnded = () => { ... };
 *   await stream.open();
 *   stream.appendChunk(bytes);   // call for each edge_tts_chunk
 *   stream.endOfStream();        // call on edge_tts_done
 *
 * AudioScheduler integration:
 *   EdgeTTSStream plays via its own HTMLAudioElement (MediaSource).
 *   Call stream.scheduleAfter(scheduler) so it starts playing at
 *   scheduler._nextTime and registers its duration with the scheduler
 *   once playback ends — keeping the shared timing cursor accurate.
 *
 * Browser / WebView support:
 *   MediaSource with 'audio/mpeg' is supported in Chromium-based WebViews
 *   (Tauri uses WebKit on macOS which does NOT support MSE for audio/mpeg).
 *   isSupported() returns false on WebKit; the caller should fall back to
 *   the buffer-collect path (_fetchEdgeTTSNative) in that case.
 */

export class EdgeTTSStream {
    constructor() {
        /** @type {HTMLAudioElement|null} */
        this._audio       = null;
        /** @type {MediaSource|null} */
        this._ms          = null;
        /** @type {SourceBuffer|null} */
        this._sb          = null;

        /** Chunks waiting to be appended while SourceBuffer is busy. */
        this._pendingChunks = [];
        this._appending     = false;
        this._endRequested  = false;
        this._open          = false;

        /** Fired when playback ends (or on error). */
        this.onEnded = null;
        /** Fired when playback starts (first audio). */
        this.onStarted = null;

        this._startedFired = false;
        this._objectUrl    = null;
    }

    // ── static ─────────────────────────────────────────────────────────────

    /**
     * Returns true if the current browser/WebView supports MSE with MP3.
     * On macOS WebKit (Tauri default), MSE for audio/mpeg is not available.
     */
    static isSupported() {
        if (typeof MediaSource === 'undefined') return false;
        return MediaSource.isTypeSupported('audio/mpeg');
    }

    // ── public ─────────────────────────────────────────────────────────────

    /**
     * Open MediaSource and prepare for streaming.
     * Must be called before appendChunk().
     * @returns {Promise<void>} resolves when SourceBuffer is ready.
     */
    open() {
        return new Promise((resolve, reject) => {
            this._ms = new MediaSource();
            this._objectUrl = URL.createObjectURL(this._ms);

            this._audio = new Audio();
            this._audio.src = this._objectUrl;

            this._audio.addEventListener('playing', () => {
                if (!this._startedFired) {
                    this._startedFired = true;
                    this.onStarted?.();
                }
            }, { once: true });

            this._audio.addEventListener('ended', () => this._handleEnded());
            this._audio.addEventListener('error', (e) => {
                console.warn('[EdgeTTSStream] audio error:', e);
                this._handleEnded();
            });

            this._ms.addEventListener('sourceopen', () => {
                try {
                    this._sb = this._ms.addSourceBuffer('audio/mpeg');
                    this._sb.addEventListener('updateend', () => {
                        this._appending = false;
                        this._appendNext();
                    });
                    this._open = true;
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });

            this._ms.addEventListener('sourceended', () => {});
            this._ms.addEventListener('sourceerror', (e) => {
                reject(new Error('MediaSource error: ' + e));
            });
        });
    }

    /**
     * Feed an MP3 chunk (Uint8Array or ArrayBuffer) to the SourceBuffer.
     * Safe to call before or after open() — chunks are queued internally.
     */
    appendChunk(bytes) {
        const ab = bytes instanceof Uint8Array ? bytes.buffer : bytes;
        // Create a copy so the caller can safely discard the original buffer.
        this._pendingChunks.push(ab.slice(0));
        this._appendNext();
    }

    /**
     * Signal end of stream.  Call this when edge_tts_done fires.
     * Closes the SourceBuffer so the browser knows the stream is complete.
     */
    endOfStream() {
        this._endRequested = true;
        this._appendNext(); // may flush remaining chunks + end stream
    }

    /**
     * Stop playback and clean up.
     */
    stop() {
        this._open          = false;
        this._pendingChunks = [];

        if (this._audio) {
            this._audio.onended = null;
            try { this._audio.pause(); } catch (_) {}
            this._audio = null;
        }
        if (this._objectUrl) {
            URL.revokeObjectURL(this._objectUrl);
            this._objectUrl = null;
        }
        this._ms = null;
        this._sb = null;
    }

    // ── private ────────────────────────────────────────────────────────────

    _appendNext() {
        if (!this._open || !this._sb || this._appending || this._sb.updating) return;

        if (this._pendingChunks.length > 0) {
            this._appending = true;
            const chunk = this._pendingChunks.shift();
            try {
                this._sb.appendBuffer(chunk);
                // Start playback as soon as we have some data.
                if (this._audio && this._audio.paused && this._audio.readyState >= 2) {
                    this._audio.play().catch(() => {});
                } else if (this._audio && this._audio.paused) {
                    // Not enough data yet — wait for canplay.
                    this._audio.addEventListener('canplay', () => {
                        this._audio?.play().catch(() => {});
                    }, { once: true });
                }
            } catch (e) {
                this._appending = false;
                console.warn('[EdgeTTSStream] appendBuffer failed:', e);
            }
            return;
        }

        // No more chunks — close the stream if requested.
        if (this._endRequested && this._ms && this._ms.readyState === 'open') {
            try {
                this._ms.endOfStream();
            } catch (e) {
                console.warn('[EdgeTTSStream] endOfStream failed:', e);
            }
        }
    }

    _handleEnded() {
        this.onEnded?.();
    }
}
