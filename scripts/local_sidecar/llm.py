"""
Transkit Local Sidecar — LLM Engine

Wraps mlx-lm for text generation (translation + AI chat).
Loaded lazily on first request so startup is fast.
"""

import threading
import time

_lock = threading.Lock()
_model = None
_tokenizer = None
_loaded_repo = None


def _load(repo: str):
    global _model, _tokenizer, _loaded_repo
    from mlx_lm import load  # type: ignore

    _model, _tokenizer = load(repo)
    _loaded_repo = repo


def ensure_loaded(repo: str):
    global _model, _tokenizer, _loaded_repo
    with _lock:
        if _loaded_repo != repo:
            _load(repo)


def _mlx_generate(prompt: str, max_tokens: int, temperature: float) -> str:
    """Version-safe wrapper around mlx_lm.generate.

    mlx-lm API history:
      < 0.19  — generate(..., temp=T)
      0.19+   — generate(..., sampler=make_sampler(temp=T))
      some    — generate(..., temperature=T)   (short-lived)
    """
    from mlx_lm import generate as mlx_generate  # type: ignore

    # Try sampler-based API first (mlx-lm >= 0.19)
    try:
        from mlx_lm.sample_utils import make_sampler  # type: ignore
        sampler = make_sampler(temp=temperature)
        return mlx_generate(
            _model, _tokenizer,
            prompt=prompt, max_tokens=max_tokens,
            sampler=sampler, verbose=False,
        )
    except (ImportError, TypeError):
        pass

    # Fallback: legacy temp= kwarg (mlx-lm < 0.19)
    try:
        return mlx_generate(
            _model, _tokenizer,
            prompt=prompt, max_tokens=max_tokens,
            temp=temperature, verbose=False,
        )
    except TypeError:
        pass

    # Last resort: no temperature arg
    return mlx_generate(
        _model, _tokenizer,
        prompt=prompt, max_tokens=max_tokens,
        verbose=False,
    )


def generate(prompt: str, repo: str, max_tokens: int = 512, temperature: float = 0.3) -> str:
    """Run a single text completion and return the full response string."""
    ensure_loaded(repo)
    return _mlx_generate(prompt, max_tokens, temperature)


def chat(messages: list[dict], repo: str, max_tokens: int = 512, temperature: float = 0.3) -> str:
    """
    Chat-style generation using apply_chat_template if available,
    otherwise fall back to a simple concatenation prompt.
    """
    ensure_loaded(repo)

    if hasattr(_tokenizer, "apply_chat_template"):
        prompt = _tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    else:
        parts = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            parts.append(f"{role.capitalize()}: {content}")
        parts.append("Assistant:")
        prompt = "\n".join(parts)

    return _mlx_generate(prompt, max_tokens, temperature)


def translate(text: str, from_lang: str, to_lang: str, repo: str,
              context: str = "", max_tokens: int = 256, temperature: float = 0.2) -> str:
    """
    Translate `text` from `from_lang` to `to_lang` using the loaded LLM.
    `context` is an optional domain hint to improve terminology accuracy.
    """
    system_msg = (
        "You are a professional translator. Translate accurately and naturally. "
        "Output only the translated text, nothing else."
    )
    if context:
        system_msg += f" Domain context: {context}"

    from_label = from_lang if from_lang != "auto" else "the source language"
    user_msg = f"Translate from {from_label} to {to_lang}:\n\n{text}"

    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_msg},
    ]
    return chat(messages, repo, max_tokens=max_tokens, temperature=temperature).strip()


def is_loaded() -> bool:
    return _model is not None
