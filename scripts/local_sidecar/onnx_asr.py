"""
Transkit Local Sidecar — ONNX ASR Engine (sherpa-onnx)

Supports offline (non-streaming) Zipformer RNNT / CTC / MedASR models from k2-fsa /
csukuangfj exported with the standard icefall ONNX exporter.

Uses OfflineRecognizer with silence-based batching for real-time transcription:
  - Accumulate audio into a rolling buffer
  - Detect silence (RMS below threshold for N seconds)
  - Feed the buffered segment to OfflineRecognizer and emit final text

Accepts raw PCM (s16le, 16 kHz, mono).
"""

import glob
import os
import threading
import time
from typing import Callable, Optional

import numpy as np

# ── Globals ────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_recognizer_cache = {}   # model_dir -> (sherpa_onnx.OfflineRecognizer, str loader_tag)
_loaded_model_dir = None  # type: Optional[str]

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # s16le

# ── Silence / batching constants ───────────────────────────────────────────────
_SILENCE_RMS_THRESHOLD   = 0.015   # RMS below this = silence (raised from 0.008 to cut mic-noise hallucinations)
_SILENCE_COMMIT_S        = 0.8     # seconds of silence → commit buffered audio
_MAX_SEGMENT_S           = 20.0    # hard cap: commit even without silence
_PROVISIONAL_INTERVAL_S  = 2.5     # run inference during long speech for provisional text
_POLL_INTERVAL_S         = 0.05    # 50 ms polling loop
_MIN_COMMIT_S            = 0.5     # discard segments shorter than this (avoids hallucination on tiny noise bursts)


# ── Model file detection ───────────────────────────────────────────────────────

def _find_model_files(model_dir):
    # type: (str) -> dict
    """
    Auto-detect ONNX model files in a directory.
    Returns dict with keys: encoder, decoder, joiner, tokens, model_type
    Raises FileNotFoundError if required files are missing.
    """
    if not os.path.isdir(model_dir):
        raise FileNotFoundError(
            "Model directory not found: '{}'. "
            "Go to Settings → Offline STT and download the model first.".format(model_dir)
        )

    def _pick(patterns):
        # Prefer full-precision over int8 within each pattern group.
        for pat in patterns:
            matches = sorted(glob.glob(os.path.join(model_dir, pat)))
            non_int8 = [m for m in matches if ".int8." not in os.path.basename(m)]
            if non_int8:
                return non_int8[0]
        for pat in patterns:
            matches = sorted(glob.glob(os.path.join(model_dir, pat)))
            if matches:
                return matches[0]
        return None

    encoder = _pick(["*encoder*.onnx", "model.onnx", "model.int8.onnx", "*model*.onnx"])
    decoder = _pick(["*decoder*.onnx"])
    joiner  = _pick(["*joiner*.onnx"])
    tokens  = _pick(["tokens.txt", "*tokens*.txt", "*.model", "*vocab*.txt"])
    # Separate single-file model (used by medasr_ctc, wenet_ctc, etc.)
    single_model = _pick(["model.onnx", "model.int8.onnx"])

    # CTC: no decoder AND no joiner
    is_ctc = encoder and not decoder and not joiner

    missing = []
    if not encoder:
        missing.append("encoder*.onnx or model.onnx")
    if not is_ctc:
        if not decoder:
            missing.append("decoder*.onnx")
        if not joiner:
            missing.append("joiner*.onnx")
    if not tokens:
        missing.append("tokens.txt (or *.model)")

    if missing:
        raise FileNotFoundError(
            "Missing required model files in '{}': {}. "
            "Download the model from Settings → Offline STT.".format(
                model_dir, ", ".join(missing)
            )
        )

    return {
        "encoder":      encoder,
        "decoder":      decoder,
        "joiner":       joiner,
        "tokens":       tokens,
        "single_model": single_model,
        "model_type":   "ctc" if is_ctc else "transducer",
    }


def _read_onnx_metadata(onnx_path):
    # type: (str) -> dict
    """
    Extract sherpa-onnx metadata from the tail of an ONNX file.
    ONNX files are protobuf — metadata_props strings appear verbatim near the end.
    Returns a dict of key→value strings found in the last 4 KB.
    """
    meta = {}
    try:
        size = os.path.getsize(onnx_path)
        with open(onnx_path, "rb") as f:
            f.seek(max(0, size - 4096))
            tail = f.read()
        # Convert to printable ASCII for pattern matching
        text = tail.decode("latin-1")
        # Protobuf string fields appear as: \x0a\x<len><key>\x12\x<len><value>
        # We scan for known keys and grab the value that follows.
        import re
        for m in re.finditer(r'([a-zA-Z_][a-zA-Z0-9_]{2,30})\x00*\x12.{1,3}([^\x00-\x1f]{1,40})', text):
            meta[m.group(1)] = m.group(2).split('\x00')[0].split('\r')[0].strip()
        # Also look for simple "key..value" protobuf encoding patterns
        for m in re.finditer(r'([a-zA-Z_][a-zA-Z0-9_]{2,30})[\x00-\x20]{2,4}([a-zA-Z0-9_\-\.]{1,40})', text):
            k, v = m.group(1), m.group(2)
            if k not in meta:
                meta[k] = v
    except Exception:
        pass
    return meta


# ── Recognizer building ───────────────────────────────────────────────────────

def _build_recognizer(model_dir):
    # type: (str) -> tuple
    """
    Build and return (OfflineRecognizer, loader_tag) for the given model dir.
    Tries multiple loaders in order; raises RuntimeError if none succeed.
    """
    import sherpa_onnx  # type: ignore

    files = _find_model_files(model_dir)
    errors = []

    # ── Transducer (RNNT) loaders ──────────────────────────────────────────────
    if files["model_type"] == "transducer":
        enc, dec, joi, tok = (
            files["encoder"], files["decoder"], files["joiner"], files["tokens"]
        )
        bpe = _pick_bpe(model_dir)

        for loader_tag in ("transducer",):
            try:
                r = sherpa_onnx.OfflineRecognizer.from_transducer(
                    encoder=enc,
                    decoder=dec,
                    joiner=joi,
                    tokens=tok,
                    num_threads=2,
                    sample_rate=SAMPLE_RATE,
                    feature_dim=80,
                    decoding_method="greedy_search",
                    modeling_unit="bpe" if bpe else "cjkchar",
                    bpe_vocab=bpe or "",
                )
                return r, loader_tag
            except Exception as e:
                errors.append("transducer: " + str(e))

    # ── CTC / single-model loaders ─────────────────────────────────────────────
    # Use the single-model file if available, fall back to encoder.
    ctc_model = files["single_model"] or files["encoder"]
    tok = files["tokens"]

    # Try each known offline classmethod in preference order
    ctc_loaders = [
        ("medasr_ctc",    lambda: sherpa_onnx.OfflineRecognizer.from_medasr_ctc(
            model=ctc_model, tokens=tok, num_threads=2)),
        ("zipformer_ctc", lambda: sherpa_onnx.OfflineRecognizer.from_zipformer_ctc(
            model=ctc_model, tokens=tok, num_threads=2)),
        ("nemo_ctc",      lambda: sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=ctc_model, tokens=tok, num_threads=2)),
        ("wenet_ctc",     lambda: sherpa_onnx.OfflineRecognizer.from_wenet_ctc(
            model=ctc_model, tokens=tok, num_threads=2)),
    ]

    for loader_tag, loader_fn in ctc_loaders:
        if not hasattr(sherpa_onnx.OfflineRecognizer, "from_" + loader_tag):
            continue
        try:
            return loader_fn(), loader_tag
        except Exception as e:
            errors.append(loader_tag + ": " + str(e))

    # Also try transducer for CTC-detected models (sometimes misdetected)
    if files["model_type"] == "ctc" and files.get("decoder") and files.get("joiner"):
        try:
            r = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=files["encoder"],
                decoder=files["decoder"],
                joiner=files["joiner"],
                tokens=tok,
                num_threads=2,
                sample_rate=SAMPLE_RATE,
                feature_dim=80,
            )
            return r, "transducer_fallback"
        except Exception as e:
            errors.append("transducer_fallback: " + str(e))

    raise RuntimeError(
        "No compatible sherpa-onnx loader found for model in '{}'.\n"
        "Tried: {}\n"
        "Make sure you downloaded a sherpa-onnx compatible model.".format(
            model_dir, "; ".join(errors) if errors else "none"
        )
    )


def _pick_bpe(model_dir):
    # type: (str) -> Optional[str]
    """Return path to bpe.model if present, else None."""
    path = os.path.join(model_dir, "bpe.model")
    return path if os.path.isfile(path) else None


# ── Public API ─────────────────────────────────────────────────────────────────

def is_loaded():
    # type: () -> bool
    return _loaded_model_dir is not None


def ensure_loaded(model_dir):
    # type: (str) -> None
    """Pre-load and cache the recognizer. Thread-safe."""
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
            _recognizer_cache[model_dir] = _build_recognizer(model_dir)
        _loaded_model_dir = model_dir


def _get_recognizer(model_dir):
    # type: (str) -> tuple
    """Get cached (recognizer, loader_tag), building if needed."""
    with _lock:
        if model_dir not in _recognizer_cache:
            _recognizer_cache[model_dir] = _build_recognizer(model_dir)
    return _recognizer_cache[model_dir]


def _pcm_to_float(pcm_bytes):
    # type: (bytes) -> np.ndarray
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
    return samples / 32768.0


def _rms(samples):
    # type: (np.ndarray) -> float
    if len(samples) == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples ** 2)))


def _normalize_text(text):
    # type: (str) -> str
    """
    LibriSpeech-trained k2-fsa models output ALL-CAPS.
    If >70% of alphabetic chars are uppercase, convert to lowercase.
    """
    if not text:
        return text
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        return text.lower()
    return text


def _is_hallucination(text):
    # type: (str) -> bool
    """
    Detect common hallucination patterns produced by offline models on silence/noise:
      - A single token repeated 3+ times (e.g. "Đây Đây Đây" or "và và và và")
      - Result is suspiciously short (≤ 2 chars) — corner-case noise burst
    """
    import re
    if not text or len(text) <= 2:
        return True
    # Split into words; if any word repeats 3+ consecutive times, it's a hallucination
    words = text.split()
    for i in range(len(words) - 2):
        if words[i].lower() == words[i + 1].lower() == words[i + 2].lower():
            return True
    # Also catch punctuation-separated repetitions like "và, và, và"
    tokens = re.split(r'[\s,\.]+', text.lower())
    tokens = [w for w in tokens if w]
    for i in range(len(tokens) - 2):
        if tokens[i] == tokens[i + 1] == tokens[i + 2]:
            return True
    return False


# ── Streaming session ──────────────────────────────────────────────────────────

class StreamingSession(object):
    """
    Buffers PCM audio and transcribes using OfflineRecognizer with silence detection.

    Audio is accumulated until either:
      - Silence (_SILENCE_RMS_THRESHOLD RMS) lasts >= _SILENCE_COMMIT_S seconds
      - Segment duration reaches _MAX_SEGMENT_S (hard cap)

    When committed, the buffered audio is fed to OfflineRecognizer and the
    transcript is emitted as a final result.

    API is identical to the mlx-whisper StreamingSession in asr.py.
    """

    def __init__(
        self,
        repo,
        language=None,       # kept for API compat — not used for offline ONNX
        chunk_seconds=7,     # kept for API compat
        stride_seconds=5,    # kept for API compat
        task="transcribe",   # kept for API compat
        on_transcript=None,  # type: Optional[Callable]
        on_status=None,      # type: Optional[Callable]
    ):
        self.model_dir    = repo
        self.on_transcript = on_transcript
        self.on_status     = on_status

        self._buffer      = bytearray()
        self._buf_lock    = threading.Lock()
        self._running     = False
        self._worker      = None  # type: Optional[threading.Thread]

        # Segment buffer: audio since last commit (as list of float32 arrays)
        self._seg_samples = []    # type: list
        self._seg_duration = 0.0  # seconds

        # Silence tracking
        self._silence_start = None  # type: Optional[float]  wall-clock time silence began

        # Provisional inference tracking
        self._last_provisional_time = 0.0

        # Read cursor into _buffer (bytes)
        self._read_pos = 0

        # Guard: track whether any speech (above RMS threshold) was heard in
        # the current segment.  Commits on pure-silence segments are suppressed
        # so the model cannot hallucinate in a tight loop when the source is
        # muted or stopped.
        self._seg_has_speech = False

        # Cross-commit dedup: remember the last emitted final text and the time
        # it was emitted so we can suppress immediate exact repeats.
        self._last_final_text = ""
        self._last_final_time = 0.0

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
        with self._buf_lock:
            self._buffer.extend(pcm_bytes)

    # ── Internal ────────────────────────────────────────────────────────────────

    def _loop(self):
        try:
            recognizer, loader_tag = _get_recognizer(self.model_dir)
        except Exception as e:
            if self.on_status:
                self.on_status("ONNX load error: " + str(e))
            return

        if self.on_status:
            self.on_status("ONNX ASR ready")

        while self._running:
            time.sleep(_POLL_INTERVAL_S)
            self._ingest(recognizer)

        # Drain on stop
        self._commit(recognizer)

    def _ingest(self, recognizer):
        """Read new PCM from buffer, update segment, detect silence, maybe commit."""
        with self._buf_lock:
            buf_snapshot = bytes(self._buffer)

        total = len(buf_snapshot)
        if total <= self._read_pos:
            return

        new_bytes = buf_snapshot[self._read_pos:total]
        self._read_pos = total

        samples = _pcm_to_float(new_bytes)
        chunk_rms = _rms(samples)
        now = time.time()

        # Accumulate into current segment
        self._seg_samples.append(samples)
        self._seg_duration += len(samples) / SAMPLE_RATE

        if chunk_rms < _SILENCE_RMS_THRESHOLD:
            # Silence frame
            if self._silence_start is None:
                self._silence_start = now
            silence_dur = now - self._silence_start
            if silence_dur >= _SILENCE_COMMIT_S and self._seg_duration > 0.2:
                self._commit(recognizer)
                return
        else:
            # Speech frame — reset silence clock and mark speech present
            self._silence_start = None
            self._seg_has_speech = True

        # Hard cap
        if self._seg_duration >= _MAX_SEGMENT_S:
            self._commit(recognizer)
            return

        # Provisional inference during long continuous speech
        if (self._seg_duration > 1.0 and
                now - self._last_provisional_time >= _PROVISIONAL_INTERVAL_S):
            self._run_provisional(recognizer)

    def _run_provisional(self, recognizer):
        """Run inference on current buffer and emit provisional text."""
        if not self._seg_samples:
            return
        audio = np.concatenate(self._seg_samples)
        if len(audio) < int(SAMPLE_RATE * 0.5):
            return
        try:
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, audio)
            recognizer.decode_stream(stream)
            text = _normalize_text(stream.result.text.strip())
            if text and self.on_transcript:
                self.on_transcript(text, False, None)  # is_final=False
        except Exception:
            pass
        self._last_provisional_time = time.time()

    def _commit(self, recognizer):
        """Transcribe accumulated segment and emit final result."""
        if not self._seg_samples:
            return

        audio = np.concatenate(self._seg_samples)
        had_speech = self._seg_has_speech

        self._seg_samples = []
        self._seg_duration = 0.0
        self._silence_start = None
        self._last_provisional_time = 0.0
        self._seg_has_speech = False

        # Skip inference on pure-silence segments — the model hallucinates when
        # fed silence, causing an infinite loop of repeated transcripts when the
        # audio source is muted or stopped.
        if not had_speech:
            return

        if len(audio) < int(SAMPLE_RATE * _MIN_COMMIT_S):
            return  # too short — likely mic noise, discard to avoid hallucination

        try:
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, audio)
            recognizer.decode_stream(stream)
            text = _normalize_text(stream.result.text.strip())
            if not text or _is_hallucination(text):
                return
            # Suppress exact duplicate emitted within 3 seconds (cross-commit dedup)
            now = time.time()
            if text == self._last_final_text and now - self._last_final_time < 3.0:
                return
            self._last_final_text = text
            self._last_final_time = now
            if self.on_transcript:
                # Clear provisional then emit final
                self.on_transcript("", False, None)
                self.on_transcript(text, True, None)
        except Exception as e:
            if self.on_status:
                self.on_status("ONNX decode error: " + str(e))
