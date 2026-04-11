"""
Transkit Local Sidecar — ONNX ASR Engine (sherpa-onnx)

Drop-in replacement for asr.py using sherpa-onnx instead of mlx-whisper.
Supports Zipformer RNNT transducer models downloaded from HuggingFace.

Accepts raw PCM (s16le, 16 kHz, mono) and transcribes using online (streaming)
recognition with endpoint detection.
"""

import glob
import os
import threading
import time
from typing import Callable, Optional

import numpy as np

# ── Globals ────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_recognizer_cache = {}   # model_dir -> sherpa_onnx.OnlineRecognizer
_loaded_model_dir = None  # type: Optional[str]

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # s16le


# ── Model file detection ───────────────────────────────────────────────────────

def _find_model_files(model_dir):
    # type: (str) -> dict
    """
    Auto-detect ONNX model files in a directory.
    Prefers int8 quantized variants when available.

    Returns dict with keys: encoder, decoder, joiner, tokens
    Raises FileNotFoundError if required files are missing.
    """
    def _pick(patterns):
        # Try int8 first, then generic
        for pat in patterns:
            int8_matches = glob.glob(os.path.join(model_dir, "*.int8" + pat.lstrip("*")))
            if int8_matches:
                return int8_matches[0]
        for pat in patterns:
            matches = glob.glob(os.path.join(model_dir, pat))
            if matches:
                return matches[0]
        return None

    encoder = _pick(["*encoder*.onnx"])
    decoder = _pick(["*decoder*.onnx"])
    joiner  = _pick(["*joiner*.onnx"])
    tokens  = os.path.join(model_dir, "tokens.txt")

    missing = []
    if not encoder:
        missing.append("encoder*.onnx")
    if not decoder:
        missing.append("decoder*.onnx")
    if not joiner:
        missing.append("joiner*.onnx")
    if not os.path.isfile(tokens):
        missing.append("tokens.txt")

    if missing:
        raise FileNotFoundError(
            "Missing required model files in '{}': {}. "
            "Download the model from Settings → Offline STT.".format(
                model_dir, ", ".join(missing)
            )
        )

    return {
        "encoder": encoder,
        "decoder": decoder,
        "joiner":  joiner,
        "tokens":  tokens,
    }


def _build_recognizer(model_dir):
    # type: (str) -> object
    """Build and return a sherpa_onnx.OnlineRecognizer for the given model dir."""
    import sherpa_onnx  # type: ignore

    files = _find_model_files(model_dir)

    recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
        encoder=files["encoder"],
        decoder=files["decoder"],
        joiner=files["joiner"],
        tokens=files["tokens"],
        num_threads=2,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4,
        rule2_min_trailing_silence=1.2,
        rule3_min_utterance_length=20.0,
        decoding_method="greedy_search",
        max_active_paths=4,
    )
    return recognizer


# ── Public API ─────────────────────────────────────────────────────────────────

def is_loaded():
    # type: () -> bool
    return _loaded_model_dir is not None


def ensure_loaded(model_dir):
    # type: (str) -> None
    """
    Pre-load (and cache) the recognizer for the given model directory.
    Thread-safe. Raises if model files are missing or sherpa_onnx is not installed.
    """
    global _loaded_model_dir
    with _lock:
        if model_dir not in _recognizer_cache:
            try:
                import sherpa_onnx  # type: ignore  # noqa
            except ImportError:
                raise RuntimeError(
                    "sherpa-onnx is not installed. "
                    "Go to Settings → Offline STT and click Install Engine."
                )
            recognizer = _build_recognizer(model_dir)
            _recognizer_cache[model_dir] = recognizer
        _loaded_model_dir = model_dir


def _get_recognizer(model_dir):
    # type: (str) -> object
    """Get cached recognizer, building if needed (lock must NOT be held by caller)."""
    with _lock:
        if model_dir not in _recognizer_cache:
            _recognizer_cache[model_dir] = _build_recognizer(model_dir)
    return _recognizer_cache[model_dir]


def _pcm_to_float(pcm_bytes):
    # type: (bytes) -> np.ndarray
    """Convert raw s16le PCM bytes -> float32 numpy array."""
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
    return samples / 32768.0


# ── Streaming session ──────────────────────────────────────────────────────────

# Two-tier realtime constants
_PROVISIONAL_INTERVAL_S = 0.3    # how often to poll for provisional text
_SILENCE_RMS_THRESHOLD  = 0.008  # RMS below this = silence
_CHUNK_STEP_SAMPLES     = int(SAMPLE_RATE * 0.05)  # 50ms feed step


class StreamingSession(object):
    """
    Maintains an audio buffer fed by raw PCM bytes.
    Fires on_transcript(text, is_final, language) when segments are ready.

    Uses sherpa-onnx's built-in endpoint detection for commit decisions.
    Provisional text is emitted periodically from the current online result.

    API is compatible with the mlx-whisper StreamingSession in asr.py.
    """

    def __init__(
        self,
        repo,            # type: str  (local model directory path)
        language=None,   # type: Optional[str]  (not used for ONNX, kept for API compat)
        chunk_seconds=7,   # kept for API compat — not used
        stride_seconds=5,  # kept for API compat — not used
        task="transcribe",  # kept for API compat — ONNX is always transcribe
        on_transcript=None,  # type: Optional[Callable]
        on_status=None,      # type: Optional[Callable]
    ):
        self.model_dir = repo  # repo here is already the local path
        self.on_transcript = on_transcript
        self.on_status = on_status

        self._buffer = bytearray()
        self._buffer_lock = threading.Lock()
        self._running = False
        self._worker = None  # type: Optional[threading.Thread]

        # Feed position: how many bytes have been fed to the stream
        self._fed_pos = 0
        # Committed position in _buffer: bytes before this are finalized
        self._committed_pos = 0

        # Accumulated text within current utterance (between resets)
        self._utterance_text = ""
        # Last provisional text emitted
        self._last_provisional = ""
        self._last_provisional_time = 0.0

        # sherpa-onnx recognizer and stream (created in worker thread after ensure_loaded)
        self._recognizer = None
        self._stream = None

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
        with self._buffer_lock:
            self._buffer.extend(pcm_bytes)

    # ── Internal ────────────────────────────────────────────────────────────────

    def _loop(self):
        # Initialize recognizer and create a streaming session
        try:
            self._recognizer = _get_recognizer(self.model_dir)
            self._stream = self._recognizer.create_stream()
        except Exception as e:
            if self.on_status:
                self.on_status("ONNX ASR load error: " + str(e))
            return

        if self.on_status:
            self.on_status("ONNX ASR ready")

        while self._running:
            time.sleep(0.05)  # 50ms polling interval
            self._process_pending()

        # Drain remaining audio on stop
        self._drain()

    def _process_pending(self):
        """Feed any new PCM bytes to the stream and handle results."""
        with self._buffer_lock:
            buf = bytes(self._buffer)

        total_bytes = len(buf)
        if total_bytes <= self._fed_pos:
            return

        # Feed new audio to the stream in chunks
        new_bytes = buf[self._fed_pos:total_bytes]
        samples = _pcm_to_float(new_bytes)

        step_bytes = _CHUNK_STEP_SAMPLES * BYTES_PER_SAMPLE
        offset = 0
        while offset < len(samples):
            chunk = samples[offset:offset + _CHUNK_STEP_SAMPLES]
            if len(chunk) == 0:
                break
            self._stream.accept_waveform(SAMPLE_RATE, chunk)
            while self._recognizer.is_ready(self._stream):
                self._recognizer.decode_stream(self._stream)
            offset += _CHUNK_STEP_SAMPLES

        self._fed_pos = total_bytes

        # Check for endpoint detection
        if self._recognizer.is_endpoint(self._stream):
            current_text = self._recognizer.get_result(self._stream).text.strip()
            # Combine with any previously accumulated utterance text
            full_text = (self._utterance_text + " " + current_text).strip()

            if full_text:
                # Clear provisional before emitting final
                if self.on_transcript:
                    self.on_transcript("", False, None)
                if self.on_transcript:
                    self.on_transcript(full_text, True, None)

            # Reset the stream for the next utterance
            self._recognizer.reset(self._stream)
            self._committed_pos = total_bytes
            self._utterance_text = ""
            self._last_provisional = ""
            return

        # Emit provisional text periodically
        now = time.time()
        if now - self._last_provisional_time >= _PROVISIONAL_INTERVAL_S:
            current_text = self._recognizer.get_result(self._stream).text.strip()
            combined = (self._utterance_text + " " + current_text).strip()
            if combined and combined != self._last_provisional:
                if self.on_transcript:
                    self.on_transcript(combined, False, None)
                self._last_provisional = combined
            self._last_provisional_time = now

    def _drain(self):
        """Flush any remaining audio after stop() is called."""
        if self._stream is None or self._recognizer is None:
            return
        try:
            with self._buffer_lock:
                buf = bytes(self._buffer)
            total_bytes = len(buf)
            if total_bytes > self._fed_pos:
                new_bytes = buf[self._fed_pos:total_bytes]
                samples = _pcm_to_float(new_bytes)
                self._stream.accept_waveform(SAMPLE_RATE, samples)
                while self._recognizer.is_ready(self._stream):
                    self._recognizer.decode_stream(self._stream)
                self._fed_pos = total_bytes

            final_text = self._recognizer.get_result(self._stream).text.strip()
            full_text = (self._utterance_text + " " + final_text).strip()
            if full_text:
                if self.on_transcript:
                    self.on_transcript("", False, None)
                if self.on_transcript:
                    self.on_transcript(full_text, True, None)
        except Exception as e:
            if self.on_status:
                self.on_status("ONNX ASR drain error: " + str(e))
