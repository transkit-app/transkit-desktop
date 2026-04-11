"""
Transkit Local Sidecar — Capability probe

Returns a JSON object describing which inference engines are importable
in the current Python environment.  Called once at server startup.
"""

import importlib.util
import json


def _importable(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def probe() -> dict:
    llm_ok = _importable("mlx_lm")
    mlx_asr_ok = _importable("mlx_whisper")
    onnx_asr_ok = _importable("sherpa_onnx")
    asr_ok = mlx_asr_ok or onnx_asr_ok
    tts_ok = _importable("kokoro_mlx")

    if mlx_asr_ok:
        asr_backend = "mlx-whisper"
    elif onnx_asr_ok:
        asr_backend = "sherpa-onnx"
    else:
        asr_backend = None

    return {
        "llm": {
            "available": llm_ok,
            "backend": "mlx-lm" if llm_ok else None,
        },
        "asr": {
            "available": asr_ok,
            "backend": asr_backend,
        },
        "tts": {
            "available": tts_ok,
            "backend": "kokoro-mlx" if tts_ok else None,
        },
    }


if __name__ == "__main__":
    print(json.dumps(probe(), indent=2))
