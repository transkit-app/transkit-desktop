"""
Transkit Local Sidecar — TTS Engine

Supports two backends:
  kokoro   — kokoro-mlx (default, English voices)
  mlx_audio — mlx-audio  (ZipVoice, Parler-TTS, etc.)

configure() is called once at startup with the user's chosen engine + model.
"""

import glob as _glob
import io
import os
import tempfile
import threading
import wave

_lock = threading.Lock()
_engine = "kokoro"        # "kokoro" | "mlx_audio"
_tts_model = None         # HuggingFace repo ID override (str | None)
_ref_audio = None         # optional reference audio path for mlx_audio voice cloning

# Engine-specific loaded objects
_kokoro_pipeline = None
_mlx_audio_model = None


def configure(model: str = "", engine: str = "kokoro", ref_audio: str = "") -> None:
    """Called once at startup.  Resets cached models when settings change."""
    global _engine, _tts_model, _ref_audio, _kokoro_pipeline, _mlx_audio_model
    new_engine = (engine.strip() or "kokoro").lower()
    new_model  = model.strip() or None
    new_ref    = ref_audio.strip() or None

    if new_engine != _engine or new_model != _tts_model or new_ref != _ref_audio:
        _kokoro_pipeline = None
        _mlx_audio_model = None

    _engine    = new_engine
    _tts_model = new_model
    _ref_audio = new_ref


# ── Kokoro helpers ─────────────────────────────────────────────────────────────

def _ensure_kokoro():
    global _kokoro_pipeline
    with _lock:
        if _kokoro_pipeline is None:
            from kokoro_mlx import KokoroPipeline  # type: ignore
            kwargs: dict = {"lang_code": "a"}
            if _tts_model:
                kwargs["repo"] = _tts_model
            _kokoro_pipeline = KokoroPipeline(**kwargs)


def _synthesize_kokoro(text: str, voice: str = "af_heart", speed: float = 1.0) -> bytes:
    _ensure_kokoro()
    import numpy as np  # type: ignore

    all_samples = []
    sample_rate = 24000

    for _, _, audio in _kokoro_pipeline(text, voice=voice, speed=speed):  # type: ignore
        if audio is not None:
            all_samples.append(audio)

    if not all_samples:
        raise RuntimeError("Kokoro TTS produced no audio output.")

    combined = np.concatenate(all_samples)
    pcm16    = (combined * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    return buf.getvalue()


# ── mlx-audio helpers ──────────────────────────────────────────────────────────

def _ensure_mlx_audio():
    """Load and cache the mlx-audio model.

    Newer versions of mlx-audio removed 'zipvoice' from get_model_class(),
    so load_model() may raise ValueError.  In that case we fall back to
    storing the repo string and letting generate_audio() do its own loading
    (it accepts either a pre-loaded model object or a repo-id string).
    """
    global _mlx_audio_model
    with _lock:
        if _mlx_audio_model is None:
            repo = _tts_model or "mlx-community/zipvoice-vietnamese"
            try:
                from mlx_audio.tts.utils import load_model  # type: ignore
                _mlx_audio_model = load_model(repo)
            except (ValueError, Exception):
                # API incompatibility — store the repo string as a sentinel.
                # generate_audio() accepts a repo-id string and handles
                # its own model loading / MLX caching internally.
                _mlx_audio_model = repo


def _synthesize_mlx_audio(text: str) -> bytes:
    _ensure_mlx_audio()
    from mlx_audio.tts.generate import generate_audio  # type: ignore

    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "out")
        # _mlx_audio_model is either a loaded model object or a repo-id string.
        kwargs: dict = {"model": _mlx_audio_model, "text": text, "file_prefix": prefix}
        if _ref_audio:
            kwargs["ref_audio"] = _ref_audio
        generate_audio(**kwargs)

        wav_files = _glob.glob(os.path.join(tmpdir, "*.wav"))
        if not wav_files:
            raise RuntimeError("mlx-audio produced no audio output.")
        with open(wav_files[0], "rb") as f:
            return f.read()


# ── Public API ─────────────────────────────────────────────────────────────────

def ensure_loaded() -> None:
    """Eagerly load the active TTS engine. Called at server startup for preloading."""
    if _engine == "mlx_audio":
        _ensure_mlx_audio()
    else:
        _ensure_kokoro()


def list_voices() -> list[str]:
    """Return voice IDs for the active engine."""
    if _engine == "mlx_audio":
        # mlx-audio models use reference audio for voice; no fixed voice list
        return []
    # Kokoro voices
    return [
        "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky",
        "am_adam", "am_michael",
        "bf_emma", "bf_isabella",
        "bm_george", "bm_lewis",
    ]


def synthesize(text: str, voice: str = "af_heart", speed: float = 1.0) -> bytes:
    """
    Synthesize `text` and return WAV bytes.
    `voice` and `speed` are used by the kokoro engine; mlx_audio ignores them.
    """
    if _engine == "mlx_audio":
        return _synthesize_mlx_audio(text)
    return _synthesize_kokoro(text, voice=voice, speed=speed)


def is_loaded() -> bool:
    if _engine == "mlx_audio":
        # _mlx_audio_model is either a loaded model object or a repo-id string (fallback).
        return _mlx_audio_model is not None
    return _kokoro_pipeline is not None
