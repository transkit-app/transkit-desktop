#!/usr/bin/env python3
"""
Transkit Local Sidecar — Inference Server

Starts a FastAPI HTTP + WebSocket server on localhost only.
All inference engines (LLM, ASR, TTS) are loaded lazily on first request.

Startup event emitted to stdout (for Tauri to read):
    {"type": "ready", "port": <int>, "capabilities": [...]}

Usage:
    python3 server.py --port 49152
                      --llm-model mlx-community/gemma-3-4b-it-qat-4bit
                      --asr-model mlx-community/whisper-large-v3-turbo
                      --tts-engine kokoro
                      --log-level info
"""

import argparse
import asyncio
import json
import os
import sys
import time

# Ensure the directory containing this script is always on sys.path so that
# sibling modules (capabilities, tts, asr, onnx_asr, …) can be imported even
# when the process working directory is somewhere else (e.g. on Windows where
# Tauri may launch the server from a different cwd).  This also bypasses the
# PYTHONPATH-ignored behaviour of Python embeddable packages on Windows.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Windows compatibility ───────────────────────────────────────────────────────
if sys.platform == "win32":
    import io as _io
    # Embedded Python on Windows may default to a narrow encoding (CP1252).
    # Force UTF-8 so JSON output that contains Unicode characters is transmitted
    # correctly to the Tauri process without UnicodeEncodeError.
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = _io.TextIOWrapper(
            sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
        )
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = _io.TextIOWrapper(
            sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True
        )
    # Python ≤ 3.11 on Windows defaults to ProactorEventLoop; uvicorn (and our
    # own run_in_executor calls) require SelectorEventLoop.  Set the policy
    # early, before uvicorn configures its own loop.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn  # type: ignore
from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import JSONResponse, Response  # type: ignore

# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Transkit Local Sidecar", docs_url=None, redoc_url=None)

# Allow requests from the Tauri WebView (tauri://localhost or any local origin).
# This is localhost-only so there is no cross-site risk.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global config — populated from CLI args before server starts
_config: dict = {}


def emit(data: dict):
    """Write a JSON line to stdout so Tauri can read it."""
    print(json.dumps(data, ensure_ascii=False), flush=True)


# ── Health ─────────────────────────────────────────────────────────────────────

_start_time = time.time()


@app.get("/v1/health")
async def health():
    return {"status": "ok", "uptime_s": round(time.time() - _start_time, 1)}


# ── Capabilities ───────────────────────────────────────────────────────────────

@app.get("/v1/capabilities")
async def capabilities():
    from capabilities import probe  # type: ignore
    caps = probe()
    for key in caps:
        if caps[key]["available"]:
            try:
                import importlib
                mod = importlib.import_module(key.replace("-", "_"))  # noqa
            except Exception:
                pass
    return caps


# ── Translate ──────────────────────────────────────────────────────────────────

@app.post("/v1/translate")
async def translate_endpoint(body: dict):
    """
    Body:
      { "text": str, "from": str, "to": str, "context"?: str, "stream"?: bool }
    Response (non-streaming):
      { "translated": str }
    """
    text = body.get("text", "")
    from_lang = body.get("from", "auto")
    to_lang = body.get("to", "en")
    context = body.get("context", "")
    system_prompt = body.get("system_prompt", "")
    repo = _config.get("llm_model", "mlx-community/gemma-3-4b-it-qat-4bit")
    temperature = _config.get("llm_temperature", 0.2)
    max_tokens = _config.get("llm_max_tokens", 256)

    if not text.strip():
        return {"translated": ""}

    try:
        import llm  # type: ignore
    except ImportError:
        return JSONResponse(
            status_code=503,
            content={"error": "llm_unavailable", "detail": "LLM component not installed. Install it from Settings → Local Model."},
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: llm.translate(
                text, from_lang, to_lang, repo,
                context=context, system_prompt=system_prompt,
                max_tokens=max_tokens, temperature=temperature,
            ),
        )
        return {"translated": result}
    except Exception as exc:
        err_msg = str(exc)
        # Surface useful hints for common failures
        if "mlx_lm" in err_msg or "No module named" in err_msg:
            detail = "mlx-lm not installed. Install from Settings → Local Model (LLM component)."
            status = 503
        elif "memory" in err_msg.lower() or "oom" in err_msg.lower():
            detail = f"Out of memory loading LLM model '{repo}'. Try a smaller model or close other apps."
            status = 507
        else:
            detail = f"Translation error: {err_msg}"
            status = 500
        return JSONResponse(status_code=status, content={"error": "translate_failed", "detail": detail})


# ── Chat (AI) ──────────────────────────────────────────────────────────────────

@app.post("/v1/chat")
async def chat_endpoint(body: dict):
    """
    OpenAI-compatible chat completions (non-streaming subset).
    Body: { "model"?: str, "messages": [...], "temperature"?: float, "max_tokens"?: int }
    """
    messages = body.get("messages", [])
    repo = _config.get("llm_model", "mlx-community/gemma-3-4b-it-qat-4bit")
    temperature = float(body.get("temperature", _config.get("llm_temperature", 0.3)))
    max_tokens = int(body.get("max_tokens", _config.get("llm_max_tokens", 512)))

    import llm  # type: ignore
    text = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: llm.chat(messages, repo, max_tokens=max_tokens, temperature=temperature),
    )

    # Return OpenAI-compatible envelope
    return {
        "id": f"chatcmpl-local-{int(time.time())}",
        "object": "chat.completion",
        "model": "local",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


# ── TTS ────────────────────────────────────────────────────────────────────────

@app.post("/v1/tts")
async def tts_endpoint(body: dict):
    """
    Body: { "text": str, "voice"?: str, "speed"?: float, "format"?: "wav" }
    Returns: audio/wav binary
    """
    text = body.get("text", "")
    voice = body.get("voice", "af_heart")
    speed = float(body.get("speed", 1.0))

    if not text.strip():
        return Response(content=b"", media_type="audio/wav")

    try:
        import tts  # type: ignore
    except ImportError:
        return JSONResponse(
            status_code=503,
            content={"error": "tts_unavailable", "detail": "TTS component not installed. Install it from Settings → Local Model."},
        )

    try:
        wav_bytes = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: tts.synthesize(text, voice=voice, speed=speed),
        )
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as exc:
        err_msg = str(exc)
        if "No module named" in err_msg or "kokoro" in err_msg.lower() or "mlx_audio" in err_msg.lower():
            detail = f"TTS engine import failed: {err_msg}. Reinstall from Settings → Local Model."
            status = 503
        else:
            detail = f"TTS synthesis error: {err_msg}"
            status = 500
        return JSONResponse(status_code=status, content={"error": "tts_failed", "detail": detail})


@app.get("/v1/tts/voices")
async def tts_voices():
    import tts  # type: ignore
    return {"voices": tts.list_voices()}


# ── STT (WebSocket) ────────────────────────────────────────────────────────────

@app.websocket("/v1/transcribe")
async def transcribe_ws(ws: WebSocket):
    """
    WebSocket streaming transcription.

    Client sends:
      1. JSON config frame: {"model"?: str, "language"?: str, "chunk_seconds"?: int, "stride_seconds"?: int}
      2. Raw PCM bytes (s16le, 16 kHz, mono) — continuously

    Server sends JSON frames:
      {"type": "ready"}
      {"type": "status",     "message": "..."}
      {"type": "transcript", "text": "...", "is_final": bool, "language": str|null}
      {"type": "error",      "message": "..."}
    """
    await ws.accept()

    try:
        # Step 1: receive config frame
        raw = await ws.receive()
        if "text" in raw:
            cfg = json.loads(raw["text"])
        else:
            cfg = {}

        repo = cfg.get("model") or _config.get("asr_model", "mlx-community/whisper-large-v3-turbo")
        language = cfg.get("language") or _config.get("asr_language") or None
        if language == "auto":
            language = None
        task = cfg.get("task") or _config.get("asr_task", "transcribe")  # "transcribe" | "translate"
        chunk_seconds = int(cfg.get("chunk_seconds", _config.get("asr_chunk_seconds", 7)))
        stride_seconds = int(cfg.get("stride_seconds", _config.get("asr_stride_seconds", 5)))

        # For ONNX backend, translate repo slug → local model directory path
        if _config.get("asr_backend", "mlx") == "onnx":
            import onnx_asr as asr  # type: ignore
            repo = os.path.join(_onnx_model_dir(), repo.replace("/", "__"))
        else:
            import asr  # type: ignore

        task_label = " (translate→EN)" if task == "translate" else ""
        await ws.send_text(json.dumps({"type": "status", "message": f"Loading {repo}{task_label}…"}))

        loop = asyncio.get_event_loop()
        transcript_queue: asyncio.Queue = asyncio.Queue()

        def on_transcript(text, is_final, lang):
            loop.call_soon_threadsafe(
                transcript_queue.put_nowait,
                {"type": "transcript", "text": text, "is_final": is_final, "language": lang},
            )

        def on_status(msg):
            loop.call_soon_threadsafe(
                transcript_queue.put_nowait,
                {"type": "status", "message": msg},
            )

        # Load model in executor — catch model-not-found and surface to client
        try:
            await loop.run_in_executor(None, lambda: asr.ensure_loaded(repo))
        except Exception as load_err:
            await ws.send_text(json.dumps({"type": "error", "message": str(load_err)}))
            return
        await ws.send_text(json.dumps({"type": "ready"}))

        session = asr.StreamingSession(
            repo=repo,
            language=language,
            task=task,
            chunk_seconds=chunk_seconds,
            stride_seconds=stride_seconds,
            on_transcript=on_transcript,
            on_status=on_status,
        )
        session.start()

        # Pump incoming PCM bytes → session, and outgoing events → WS
        async def sender():
            while True:
                event = await transcript_queue.get()
                try:
                    await ws.send_text(json.dumps(event, ensure_ascii=False))
                except Exception:
                    break

        sender_task = asyncio.create_task(sender())

        try:
            while True:
                msg = await ws.receive()
                if "bytes" in msg and msg["bytes"]:
                    session.feed(msg["bytes"])
                elif "text" in msg:
                    data = json.loads(msg["text"])
                    if data.get("type") == "stop":
                        break
        except WebSocketDisconnect:
            pass
        finally:
            session.stop()
            sender_task.cancel()

    except Exception as e:
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


# ── Entry point ────────────────────────────────────────────────────────────────

def _onnx_model_dir():
    """Return the ONNX models storage directory (platform-specific)."""
    import platform
    if platform.system() == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    elif platform.system() == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
    return os.path.join(base, "com.transkit.desktop", "onnx-models")


def main():
    parser = argparse.ArgumentParser(description="Transkit Local Sidecar server")
    parser.add_argument("--port", type=int, default=49152)
    parser.add_argument("--llm-model", default="mlx-community/gemma-3-4b-it-qat-4bit")
    parser.add_argument("--asr-model", default="mlx-community/whisper-large-v3-turbo")
    parser.add_argument("--asr-language", default=None)
    parser.add_argument("--asr-task", default="transcribe", choices=["transcribe", "translate"])
    parser.add_argument("--asr-chunk-seconds", type=int, default=7)
    parser.add_argument("--asr-stride-seconds", type=int, default=5)
    parser.add_argument("--tts-engine", default="kokoro")
    parser.add_argument("--tts-model", default="")
    parser.add_argument("--tts-ref-audio", default="")
    parser.add_argument("--llm-temperature", type=float, default=0.3)
    parser.add_argument("--llm-max-tokens", type=int, default=512)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--asr-backend", default="mlx", choices=["mlx", "onnx"],
                        help="ASR backend: 'mlx' (mlx-whisper) or 'onnx' (sherpa-onnx)")
    # Comma-separated list of components explicitly installed by the user
    # (e.g. "llm,stt,tts").  Empty string means "use capability probe only".
    parser.add_argument("--installed-components", default="")
    args = parser.parse_args()

    global _config
    _config = {
        "llm_model": args.llm_model,
        "asr_model": args.asr_model,
        "asr_language": args.asr_language,
        "asr_task": args.asr_task,
        "asr_chunk_seconds": args.asr_chunk_seconds,
        "asr_stride_seconds": args.asr_stride_seconds,
        "tts_engine": args.tts_engine,
        "tts_model": args.tts_model,
        "tts_ref_audio": args.tts_ref_audio,
        "llm_temperature": args.llm_temperature,
        "llm_max_tokens": args.llm_max_tokens,
        "asr_backend": args.asr_backend,
    }

    # Configure TTS engine with user-specified engine + model (if any)
    try:
        import tts as _tts  # type: ignore
        _tts.configure(args.tts_model, engine=args.tts_engine, ref_audio=args.tts_ref_audio)
    except ImportError:
        pass

    from capabilities import probe  # type: ignore
    caps = probe()
    cap_names = [k for k, v in caps.items() if v["available"]]

    # If the caller told us which components are installed, restrict cap_names
    # to only those.  This prevents auto-downloading models for components that
    # are importable (from a previous install) but were intentionally unchecked.
    if args.installed_components:
        installed = {c.strip() for c in args.installed_components.split(",") if c.strip()}
        cap_names = [c for c in cap_names if c in installed]

    # Signal Tauri that the server is about to start
    emit({"type": "starting", "port": args.port})

    async def _preload_all(cfg, caps):
        """Eagerly load each installed model after server is ready."""
        loop = asyncio.get_event_loop()

        async def _load(component, fn):
            emit({"type": "model_loading", "component": component})
            t0 = time.time()
            try:
                await loop.run_in_executor(None, fn)
                emit({"type": "model_ready", "component": component,
                      "took_s": round(time.time() - t0, 1)})
            except ImportError:
                pass  # Component not installed — silently skip
            except Exception as exc:
                emit({"type": "model_error", "component": component, "error": str(exc)})

        tasks = []
        if "llm" in caps:
            import llm as _llm  # type: ignore  # noqa
            tasks.append(_load("llm", lambda: _llm.ensure_loaded(cfg["llm_model"])))
        if "tts" in caps:
            import tts as _tts_mod  # type: ignore  # noqa
            tasks.append(_load("tts", _tts_mod.ensure_loaded))
        if "stt" in caps:
            if cfg.get("asr_backend", "mlx") == "onnx":
                # ONNX models load lazily on first WebSocket connect — skip eager preload
                pass
            else:
                import asr as _asr  # type: ignore  # noqa
                tasks.append(_load("stt", lambda: _asr.ensure_loaded(cfg["asr_model"])))

        await asyncio.gather(*tasks, return_exceptions=True)

    class StartupEmitter(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            emit({
                "type": "ready",
                "port": args.port,
                "capabilities": cap_names,
            })
            asyncio.create_task(_preload_all(_config, cap_names))

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level=args.log_level,
        access_log=False,
    )
    server = StartupEmitter(config=config)
    server.run()


if __name__ == "__main__":
    main()
