"""
Transkit Local Sidecar — ASR Engine

Wraps mlx-whisper for speech recognition.
Accepts raw PCM (s16le, 16 kHz, mono) and transcribes in sliding-window chunks.
"""

import threading
import time
from typing import Callable, Optional, Tuple

import numpy as np

_lock = threading.Lock()
_loaded_repo = None  # type: Optional[str]

# Sample rate expected by Whisper
SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # s16le


def ensure_loaded(repo):
    # type: (str) -> None
    global _loaded_repo
    with _lock:
        if _loaded_repo != repo:
            import mlx_whisper as _mw  # type: ignore
            try:
                dummy = np.zeros(SAMPLE_RATE, dtype=np.float32)
                _mw.transcribe(dummy, path_or_hf_repo=repo, language=None)
                _loaded_repo = repo
            except Exception as e:
                msg = str(e)
                # Produce a clean, actionable error for common failure modes
                if "401" in msg or "Repository Not Found" in msg or "RepositoryNotFoundError" in type(e).__name__:
                    raise RuntimeError(
                        "Model not found: '{}'. "
                        "Check the model ID in Settings → Local Model (ASR section) "
                        "and in Monitor → Local Model STT gear icon.".format(repo)
                    )
                raise


def _pcm_to_float(pcm_bytes):
    # type: (bytes) -> np.ndarray
    """Convert raw s16le PCM bytes → float32 numpy array in [-1, 1]."""
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
    return samples / 32768.0


def transcribe_chunk(pcm_bytes, repo, language=None, task="transcribe"):
    # type: (bytes, str, Optional[str], str) -> Tuple[str, Optional[str]]
    """
    Transcribe (or translate) a PCM chunk.
    task: "transcribe" | "translate"  (translate → always outputs English)
    Returns (text, detected_language).  Returns ("", None) on silence/noise.
    """
    ensure_loaded(repo)
    import mlx_whisper as mw  # type: ignore

    audio = _pcm_to_float(pcm_bytes)
    if audio.max() < 0.001:  # near-silence
        return "", None

    kwargs = {"path_or_hf_repo": repo, "verbose": False, "task": task or "transcribe"}
    if language and language != "auto":
        kwargs["language"] = language

    result = mw.transcribe(audio, **kwargs)
    text = result.get("text", "").strip()
    detected = result.get("language")
    return text, detected


def is_loaded():
    # type: () -> bool
    return _loaded_repo is not None


# ── Streaming session ──────────────────────────────────────────────────────────

# Two-tier realtime constants (tune if needed)
_PROVISIONAL_WINDOW_S   = 4      # audio window used for provisional transcription
_PROVISIONAL_INTERVAL_S = 0.7    # how often to emit a provisional update
_SILENCE_RMS_THRESHOLD  = 0.008  # RMS below this = silence (0–1 scale)
_SILENCE_COMMIT_S       = 1.0    # seconds of silence before committing segment
_MAX_SEGMENT_S          = 10     # force commit after this many accumulated seconds
_MIN_COMMIT_S           = 1.0    # don't commit segments shorter than this

# Sentence-ending punctuation triggers an early commit even without silence.
# Covers EN/VI (ASCII) and CJK full-width variants.
_SENTENCE_ENDS = ('.', '!', '?', '。', '！', '？', '…')


class StreamingSession(object):
    """
    Maintains an audio buffer fed by raw PCM bytes.
    Fires on_transcript(text, is_final, language) when segments are ready.

    Two-tier commit strategy:
      PROVISIONAL — every ~0.9 s, transcribe the last 4 s of audio and emit
                    is_final=False so the UI can show realtime text.
      COMMIT      — when VAD detects ≥ 1.2 s of silence (or the accumulated
                    segment exceeds 20 s), re-transcribe the full segment from
                    the last commit point and emit is_final=True.  This gives
                    accurate final text at natural sentence/pause boundaries.

    Commit always takes priority over provisional in the processing loop.
    """

    def __init__(
        self,
        repo,           # type: str
        language=None,  # type: Optional[str]
        chunk_seconds=7,   # kept for API compat — not used in two-tier mode
        stride_seconds=5,  # kept for API compat — not used in two-tier mode
        task="transcribe",  # type: str
        on_transcript=None,  # type: Optional[Callable]
        on_status=None,      # type: Optional[Callable]
    ):
        self.repo = repo
        self.language = language
        self.task = task or "transcribe"
        self.on_transcript = on_transcript
        self.on_status = on_status

        self._buffer = bytearray()
        self._lock = threading.Lock()
        self._running = False
        self._worker = None  # type: Optional[threading.Thread]

        # Commit state
        self._committed_pos = 0          # byte offset: everything before is finalized
        self._last_commit_text = ""      # last emitted final text (for cross-commit dedup)
        self._last_provisional_time = 0.0

        # Pre-computed byte thresholds
        self._provisional_window_bytes = int(_PROVISIONAL_WINDOW_S * SAMPLE_RATE * BYTES_PER_SAMPLE)
        self._silence_bytes            = int(_SILENCE_COMMIT_S     * SAMPLE_RATE * BYTES_PER_SAMPLE)
        self._max_segment_bytes        = int(_MAX_SEGMENT_S        * SAMPLE_RATE * BYTES_PER_SAMPLE)
        self._min_commit_bytes         = int(_MIN_COMMIT_S         * SAMPLE_RATE * BYTES_PER_SAMPLE)

    def start(self):
        self._running = True
        self._worker = threading.Thread(target=self._loop, daemon=True)
        self._worker.start()

    def stop(self):
        self._running = False
        if self._worker:
            self._worker.join(timeout=15)

    def feed(self, pcm_bytes):
        # type: (bytes) -> None
        with self._lock:
            self._buffer.extend(pcm_bytes)

    # ── Internal ────────────────────────────────────────────────────────────────

    def _loop(self):
        while self._running:
            time.sleep(0.1)
            now = time.time()

            with self._lock:
                buf = bytes(self._buffer)

            uncommitted = len(buf) - self._committed_pos

            if uncommitted < self._min_commit_bytes:
                continue  # not enough audio yet

            # ── Commit check (higher priority) ──────────────────────────────
            should_commit = False

            # VAD: is the tail of the uncommitted audio silent?
            tail_start = max(self._committed_pos, len(buf) - self._silence_bytes)
            tail = buf[tail_start:]
            if len(tail) >= self._silence_bytes and self._is_silent(tail):
                should_commit = True

            # Force commit if segment is too long
            if uncommitted >= self._max_segment_bytes:
                should_commit = True

            if should_commit:
                self._do_commit(buf)
                continue  # skip provisional this iteration

            # ── Provisional (lower priority) ─────────────────────────────────
            if now - self._last_provisional_time >= _PROVISIONAL_INTERVAL_S:
                prov_start = max(self._committed_pos, len(buf) - self._provisional_window_bytes)
                prov_chunk = buf[prov_start:]
                prov_text = self._do_provisional(prov_chunk)
                self._last_provisional_time = now

                # Punctuation-triggered early commit: if the provisional window
                # ends on a sentence boundary, commit immediately rather than
                # waiting for silence or the max-segment timeout.
                if prov_text and prov_text.rstrip().endswith(_SENTENCE_ENDS):
                    uncommitted = len(buf) - self._committed_pos
                    if uncommitted >= self._min_commit_bytes * 2:
                        self._do_commit(buf)

        # ── Drain remaining audio on stop ──────────────────────────────────
        with self._lock:
            buf = bytes(self._buffer)
        if len(buf) - self._committed_pos >= self._min_commit_bytes:
            self._do_commit(buf)

    def _do_provisional(self, pcm_bytes):
        # type: (bytes) -> str
        try:
            text, lang = transcribe_chunk(pcm_bytes, self.repo, self.language, self.task)
            if text and self.on_transcript:
                self.on_transcript(text, False, lang)
            return text or ""
        except Exception as e:
            if self.on_status:
                self.on_status("ASR provisional error: " + str(e))
            return ""

    def _do_commit(self, buf):
        # type: (bytes) -> None
        """Re-transcribe the full uncommitted segment and emit as final."""
        segment = buf[self._committed_pos:]
        self._committed_pos = len(buf)

        # Clear provisional from UI before emitting final
        if self.on_transcript:
            self.on_transcript("", False, None)

        try:
            text, lang = transcribe_chunk(segment, self.repo, self.language, self.task)
        except Exception as e:
            if self.on_status:
                self.on_status("ASR commit error: " + str(e))
            return

        if not text:
            return

        # Cross-commit word-overlap dedup
        new_text = self._dedup(text, self._last_commit_text)
        self._last_commit_text = text

        if new_text and len(new_text) >= 3 and self.on_transcript:
            self.on_transcript(new_text, True, lang)

    def _is_silent(self, pcm_bytes):
        # type: (bytes) -> bool
        """Return True if the RMS energy of the audio is below the silence threshold."""
        if len(pcm_bytes) < BYTES_PER_SAMPLE:
            return False
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(samples ** 2)))
        return rms < _SILENCE_RMS_THRESHOLD

    @staticmethod
    def _dedup(text, prev_text):
        # type: (str, str) -> str
        """Remove word-level overlap between current text and the previous commit."""
        if not prev_text:
            return text
        prev_words = prev_text.split()
        curr_words = text.split()
        overlap = 0
        for n in range(min(len(prev_words), len(curr_words)), 0, -1):
            if prev_words[-n:] == curr_words[:n]:
                overlap = n
                break
        return " ".join(curr_words[overlap:])
