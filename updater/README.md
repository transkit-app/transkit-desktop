# TransKit Updater System

## Overview

This directory contains scripts that generate updater manifests for Tauri:

- `update.json` (standard builds)
- `update-fix-runtime.json` (Windows fixed WebView2 runtime builds)

These files are consumed by the auto-updater endpoints configured in `src-tauri/tauri.conf.json`.

## Release Flow (CI)

Main workflow: `.github/workflows/package.yml`

1. Build and sign release artifacts (nsis/updater, dmg/app updater bundles, appimage updater bundle)
2. Upload artifacts to the GitHub release tag
3. Run updater scripts
4. Upload `update.json` and `update-fix-runtime.json` to `updater` tag

## Prerequisites

- Node.js 18+
- `GITHUB_TOKEN` with repo access
- Tauri updater signing keypair

Required CI secrets:

- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD`

## Setup Signing Keys

```bash
pnpm tauri signer generate -w ~/.tauri/transkit.key
```

Then:

1. Put private key contents into GitHub secret `TAURI_PRIVATE_KEY`
2. Put key password into `TAURI_KEY_PASSWORD`
3. Put generated public key into `src-tauri/tauri.conf.json` -> `tauri.updater.pubkey`

## Manual Script Usage

You can run scripts manually without waiting for CI:

```bash
export GITHUB_TOKEN="<token>"
export REPO_OWNER="transkit-app"      # optional
export REPO_NAME="transkit-desktop"   # optional

pnpm run updater
pnpm run updater:fixRuntime
```

Generated files:

- `update.json`
- `update-fix-runtime.json`

Manual upload example:

```bash
gh release upload updater update.json update-fix-runtime.json --clobber
```

## Important Notes

- This repository uses numeric tags like `3.1.0` (not `v3.1.0`).
- `updater.mjs` reads release info from GitHub `releases/latest`.
- Linux updater payload is currently provided for `linux-x86_64` AppImage updater bundle.

## Troubleshooting

### `GITHUB_TOKEN is required`

Set token before running scripts:

```bash
export GITHUB_TOKEN="<token>"
```

### Empty signatures in output JSON

Usually caused by missing `.sig` files in release assets. Check:

- release job actually built updater bundles
- `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` were present in CI

### Signature verification fails in app

- `pubkey` in `tauri.conf.json` does not match signing private key
- asset/signature pair mismatch (wrong file naming or stale upload)

## Script Inputs

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | Yes | - | GitHub token for release API |
| `REPO_OWNER` | No | `transkit-app` | Repo owner |
| `REPO_NAME` | No | `transkit-desktop` | Repo name |
