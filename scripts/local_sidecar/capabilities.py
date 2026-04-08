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
    asr_ok = _importable("mlx_whisper")
    tts_ok = _importable("kokoro")

    return {
        "llm": {
            "available": llm_ok,
            "backend": "mlx-lm" if llm_ok else None,
        },
        "asr": {
            "available": asr_ok,
            "backend": "mlx-whisper" if asr_ok else None,
        },
        "tts": {
            "available": tts_ok,
            "backend": "kokoro-mlx" if tts_ok else None,
        },
    }


if __name__ == "__main__":
    print(json.dumps(probe(), indent=2))
