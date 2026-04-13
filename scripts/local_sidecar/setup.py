#!/usr/bin/env python3
"""
Transkit Local Sidecar — Environment Setup

Creates a Python virtual environment and installs required inference packages.
Reports progress via JSON lines to stdout so Tauri can display a live progress UI.

Usage:
    python3 setup.py [--check] [--prereqs] [--components llm,stt,tts] [--tts-package PACKAGE] [--env-dir DIR]

    --check         Exit 0 if setup is complete, 1 otherwise (no output).
    --prereqs       Print JSON prereqs report and exit (no install).
    --components    Comma-separated list of components to install: llm, stt, tts (default: all)
    --tts-package   TTS pip package to install (default: kokoro-mlx, empty string = skip TTS)
    --env-dir       Custom venv directory
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Dict, List, Optional, Tuple


# Bump this when required packages change — forces re-install on next startup.
SETUP_VERSION = 2

# Always-installed foundation
CORE_PACKAGES = [
    "numpy",
    "fastapi",
    "uvicorn[standard]",
    "websockets",
]

# Per-component extra packages
COMPONENT_PACKAGES = {
    "llm": ["mlx-lm"],
    "stt": ["mlx-whisper"],
    # "tts" packages are dynamic — set by --tts-package arg
}

DEFAULT_TTS_PACKAGE = "kokoro-mlx"
ALL_COMPONENTS = ["llm", "stt", "tts"]


def emit(data):
    # type: (dict) -> None
    print(json.dumps(data, ensure_ascii=False), flush=True)


def progress(step, message, percent):
    # type: (str, str, int) -> None
    emit({"type": "progress", "step": step, "message": message, "percent": percent})


def error(message):
    # type: (str) -> None
    emit({"type": "error", "message": message})


def get_default_env_dir():
    # type: () -> str
    import platform
    if platform.system() == "Windows":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, "com.transkit.desktop", "sidecar-env")
    home = os.path.expanduser("~")
    return os.path.join(home, "Library", "Application Support", "com.transkit.desktop", "sidecar-env")


def get_marker_path(env_dir):
    # type: (str) -> str
    return os.path.join(env_dir, ".setup_complete")


def read_marker(env_dir):
    # type: (str) -> dict
    marker = get_marker_path(env_dir)
    try:
        with open(marker) as f:
            return json.load(f)
    except Exception:
        return {}


def _venv_python(env_dir):
    # type: (str) -> str
    import platform
    if platform.system() == "Windows":
        return os.path.join(env_dir, "Scripts", "python.exe")
    return os.path.join(env_dir, "bin", "python3")


def _venv_pip(env_dir):
    # type: (str) -> str
    import platform
    if platform.system() == "Windows":
        return os.path.join(env_dir, "Scripts", "pip.exe")
    return os.path.join(env_dir, "bin", "pip3")


def is_setup_complete(env_dir):
    # type: (str) -> bool
    marker = get_marker_path(env_dir)
    venv_python_path = _venv_python(env_dir)
    if not os.path.exists(marker) or not os.path.exists(venv_python_path):
        return False
    try:
        data = read_marker(env_dir)
        return data.get("version") == SETUP_VERSION and bool(data.get("components"))
    except Exception:
        return False


def find_system_python():
    # type: () -> Tuple[Optional[str], Optional[str]]
    """Find Python 3.10+ from common locations (cross-platform)."""
    import platform
    if platform.system() == "Windows":
        candidates = [
            # Windows: prefer versioned launchers then bare names
            shutil.which("python3.13"),
            shutil.which("python3.12"),
            shutil.which("python3.11"),
            shutil.which("python3.10"),
            shutil.which("python3"),
            shutil.which("python"),
            # Common install locations
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python", "Python313", "python.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python", "Python312", "python.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python", "Python311", "python.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python", "Python310", "python.exe"),
        ]
    else:
        candidates = [
            "/opt/homebrew/bin/python3",
            "/opt/homebrew/bin/python3.13",
            "/opt/homebrew/bin/python3.12",
            "/opt/homebrew/bin/python3.11",
            "/opt/homebrew/bin/python3.10",
            "/usr/local/bin/python3",
            "/usr/local/bin/python3.12",
            "/usr/local/bin/python3.11",
            "/usr/local/bin/python3.10",
            shutil.which("python3"),
            shutil.which("python3.13"),
            shutil.which("python3.12"),
            shutil.which("python3.11"),
            shutil.which("python3.10"),
        ]
    for path in candidates:
        if not path or not os.path.exists(path):
            continue
        try:
            result = subprocess.run(
                [path, "--version"], capture_output=True, text=True, timeout=5
            )
            version_str = (result.stdout.strip() or result.stderr.strip()).split()[-1]
            major, minor = map(int, version_str.split(".")[:2])
            if major >= 3 and minor >= 10:
                return path, version_str
        except Exception:
            continue
    return None, None


def find_brew():
    # type: () -> Optional[str]
    candidates = [
        "/opt/homebrew/bin/brew",
        "/usr/local/bin/brew",
        shutil.which("brew"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def check_prereqs(env_dir):
    # type: (str) -> dict
    python_path, python_version = find_system_python()
    brew_path = find_brew()
    marker_data = read_marker(env_dir)
    return {
        "type": "prereqs",
        "python_found": python_path is not None,
        "python_path": python_path,
        "python_version": python_version,
        "homebrew_found": brew_path is not None,
        "homebrew_path": brew_path,
        "setup_complete": is_setup_complete(env_dir),
        "installed_components": marker_data.get("components", []),
        "env_dir": env_dir,
    }


def install_python_via_brew(brew_path):
    # type: (str) -> Tuple[Optional[str], Optional[str]]
    progress("brew", "Installing Python 3.10+ via Homebrew (this may take a few minutes)…", 2)
    result = subprocess.run(
        [brew_path, "install", "python3"],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError("Failed to install Python via Homebrew: " + result.stderr.strip())
    progress("brew", "Python installed via Homebrew", 4)
    return find_system_python()


def create_venv(python_path, env_dir):
    # type: (str, str) -> None
    progress("venv", "Creating Python environment…", 5)
    os.makedirs(env_dir, exist_ok=True)
    result = subprocess.run(
        [python_path, "-m", "venv", env_dir, "--clear"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError("Failed to create venv: " + result.stderr.strip())

    venv_pip = _venv_pip(env_dir)
    subprocess.run(
        [venv_pip, "install", "--upgrade", "pip", "--quiet"],
        capture_output=True, text=True, timeout=120,
    )
    progress("venv", "Python environment created", 10)


def install_package_list(env_dir, packages, start_pct, end_pct):
    # type: (str, List[str], int, int) -> None
    """Install a list of packages, streaming output so the UI shows download progress."""
    venv_pip = _venv_pip(env_dir)
    total = len(packages)
    for i, pkg in enumerate(packages):
        pct = start_pct + int((i / total) * (end_pct - start_pct))
        label = pkg.split("[")[0]
        progress("packages", "Installing " + label + "…", pct)

        proc = subprocess.Popen(
            [venv_pip, "install", pkg, "--progress-bar", "off"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        lines = []
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                lines.append(line)
                # Forward meaningful lines to UI (skip blank/noise)
                if any(kw in line for kw in ("Downloading", "Installing", "error", "Error", "WARNING")):
                    emit({"type": "progress", "step": "packages", "message": line, "percent": pct})
        proc.wait()
        if proc.returncode != 0:
            detail = "\n".join(lines[-10:]) if lines else "(no output)"
            raise RuntimeError("Failed to install " + pkg + ":\n" + detail)


def verify_install(env_dir, components, tts_package):
    # type: (str, List[str], str) -> bool
    """Use pip list to verify key packages are installed — avoids slow pip show on large envs."""
    venv_pip = _venv_pip(env_dir)
    required = {"fastapi", "uvicorn", "numpy", "websockets"}
    if "llm" in components:
        required.add("mlx-lm")
    if "stt" in components:
        required.add("mlx-whisper")
    if "tts" in components and tts_package:
        required.add(tts_package.split("[")[0].lower())
    try:
        result = subprocess.run(
            [venv_pip, "list", "--format=columns"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return False
        installed = {line.split()[0].lower() for line in result.stdout.splitlines()[2:] if line.strip()}
        missing = required - installed
        if missing:
            progress("verify", "Missing packages: " + ", ".join(missing), 95)
            return False
        return True
    except subprocess.TimeoutExpired:
        # pip list timed out — treat as success if install steps didn't raise
        progress("verify", "Verification timed out, assuming install succeeded", 95)
        return True
    except Exception:
        return True  # don't fail setup over a verify glitch


def write_marker(env_dir, python_path, components):
    # type: (str, str, List[str]) -> None
    marker = get_marker_path(env_dir)
    data = read_marker(env_dir)  # preserve any existing data
    data["version"] = SETUP_VERSION
    data["python"] = python_path
    existing = set(data.get("components", []))
    existing.update(components)
    data["components"] = sorted(existing)
    with open(marker, "w") as f:
        json.dump(data, f)


def main():
    # type: () -> None
    parser = argparse.ArgumentParser()
    parser.add_argument("--check",       action="store_true")
    parser.add_argument("--prereqs",     action="store_true")
    parser.add_argument("--components",  default="llm,stt,tts")
    parser.add_argument("--tts-package", default=DEFAULT_TTS_PACKAGE)
    parser.add_argument("--env-dir",     default=None)
    args = parser.parse_args()

    env_dir = args.env_dir or get_default_env_dir()

    if args.check:
        sys.exit(0 if is_setup_complete(env_dir) else 1)

    if args.prereqs:
        emit(check_prereqs(env_dir))
        return

    # Parse components
    requested = [c.strip().lower() for c in args.components.split(",") if c.strip()]
    tts_package = (args.tts_package or "").strip()

    # Build flat package list for this run
    packages_to_install = list(CORE_PACKAGES)
    components_installing = []

    for comp in requested:
        if comp == "tts":
            if tts_package:
                packages_to_install.append(tts_package)
                components_installing.append("tts")
            else:
                emit({"type": "progress", "step": "tts", "message": "TTS skipped (no package specified)", "percent": 0})
        elif comp in COMPONENT_PACKAGES:
            packages_to_install.extend(COMPONENT_PACKAGES[comp])
            components_installing.append(comp)

    if not components_installing:
        error("No components selected for installation.")
        sys.exit(1)

    # Deduplicate while preserving order
    seen = set()
    unique_packages = []
    for p in packages_to_install:
        if p not in seen:
            seen.add(p)
            unique_packages.append(p)

    # Find system Python
    progress("check", "Checking system Python…", 2)
    python_path, version = find_system_python()

    if not python_path:
        brew_path = find_brew()
        if brew_path:
            try:
                python_path, version = install_python_via_brew(brew_path)
            except Exception as e:
                error(str(e))
                sys.exit(1)
        if not python_path:
            error(
                "Python 3.10+ not found and could not be installed automatically. "
                "Please install it manually: brew install python3"
            )
            sys.exit(1)

    progress("check", "Found Python " + str(version), 4)

    # Create venv if needed
    venv_python_path = _venv_python(env_dir)
    if not os.path.exists(venv_python_path):
        create_venv(python_path, env_dir)
    else:
        progress("venv", "Reusing existing Python environment", 10)

    # Install packages
    install_package_list(env_dir, unique_packages, 10, 90)

    # Skip verify — install steps already raise on failure, and pip list can hang.
    write_marker(env_dir, venv_python_path, components_installing)
    emit({
        "type": "done",
        "ready": True,
        "python": venv_python_path,
        "components": components_installing,
    })


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        try:
            print(json.dumps({"type": "error", "message": "Unexpected error: " + str(e)}), flush=True)
        except Exception:
            pass
        sys.exit(1)
