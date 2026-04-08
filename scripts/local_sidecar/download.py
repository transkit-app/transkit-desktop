#!/usr/bin/env python3
"""
Transkit Local Sidecar — Model Downloader

Downloads a HuggingFace model to the local hub cache.
Streams JSON progress events to stdout so Tauri can display live progress.

Usage:
    python3 download.py --repo mlx-community/gemma-3-4b-it-qat-4bit
"""

import argparse
import json
import os
import sys
import threading
import time


def emit(data):
    # type: (dict) -> None
    print(json.dumps(data, ensure_ascii=False), flush=True)


def hf_cache_dir():
    # type: () -> str
    for key in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        val = os.environ.get(key)
        if val:
            return val
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def repo_cache_path(repo_id):
    # type: (str) -> str
    safe = "models--" + repo_id.replace("/", "--")
    return os.path.join(hf_cache_dir(), safe)


def dir_size(path):
    # type: (str) -> int
    total = 0
    try:
        for root, _, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    except OSError:
        pass
    return total


# Files that are useless for MLX inference — skip to save bandwidth
_IGNORE = [
    "*.msgpack", "*.h5",
    "flax_model*", "tf_model*", "tf_*",
    "pytorch_model*",
    "rust_model*",
]


def main():
    # type: () -> None
    parser = argparse.ArgumentParser(description="Download a HuggingFace model")
    parser.add_argument("--repo", required=True, help="HuggingFace repo ID")
    args = parser.parse_args()

    repo = args.repo.strip()
    if not repo:
        emit({"type": "error", "message": "No repo specified"})
        sys.exit(1)

    # Verify huggingface_hub is available (it's a dep of mlx-lm / mlx-whisper)
    try:
        from huggingface_hub import HfApi, snapshot_download  # type: ignore
    except ImportError:
        emit({"type": "error", "message": "huggingface_hub not available — install mlx-lm or mlx-whisper first."})
        sys.exit(1)

    emit({"type": "status", "message": "Fetching model info…"})

    # Estimate total size (best-effort)
    total_size = 0
    try:
        api = HfApi()
        info = api.repo_info(repo_id=repo, repo_type="model", files_metadata=True)
        siblings = info.siblings or []
        skip_exts = (".msgpack", ".h5")
        skip_pfx  = ("flax_model", "tf_model", "tf_", "pytorch_model", "rust_model")
        total_size = sum(
            (getattr(f, "size", None) or 0)
            for f in siblings
            if not any(f.rfilename.endswith(e) for e in skip_exts)
            and not any(f.rfilename.startswith(p) for p in skip_pfx)
        )
    except Exception:
        pass  # non-fatal — just won't have a percentage

    size_label = ""
    if total_size > 0:
        gb = total_size / (1024 ** 3)
        size_label = f" (~{gb:.1f} GB)" if gb >= 1 else f" (~{total_size // (1024**2)} MB)"

    emit({"type": "status", "message": f"Downloading {repo}{size_label}…"})

    # Background thread: stream progress by watching cache dir size
    cache_path  = repo_cache_path(repo)
    stop_event  = threading.Event()

    def _monitor():
        while not stop_event.is_set():
            time.sleep(1.0)
            current = dir_size(cache_path)
            if total_size > 0:
                pct = min(95, int(current / total_size * 100))
                cur_gb  = current / (1024 ** 3)
                tot_gb  = total_size / (1024 ** 3)
                label = f"{cur_gb:.2f} / {tot_gb:.1f} GB"
                emit({"type": "progress", "percent": pct, "message": f"Downloaded {label}"})
            else:
                mb = current / (1024 ** 2)
                emit({"type": "progress", "percent": -1, "message": f"Downloaded {mb:.0f} MB…"})

    threading.Thread(target=_monitor, daemon=True).start()

    try:
        snapshot_download(repo_id=repo, ignore_patterns=_IGNORE)
        stop_event.set()
        final_size = dir_size(cache_path)
        emit({"type": "done", "repo_id": repo, "size_bytes": final_size})
    except KeyboardInterrupt:
        stop_event.set()
        emit({"type": "error", "message": "Download cancelled"})
        sys.exit(1)
    except Exception as exc:
        stop_event.set()
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
