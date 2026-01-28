# TransKit Updater System

## Overview

This directory contains scripts that automatically generate `update.json` files from the latest GitHub releases of TransKit. These files enable the Tauri auto-updater to deliver seamless updates to users.

## How It Works

```
1. Build app with Tauri CLI
   ↓
2. Tauri automatically signs installer files with private key
   ↓
3. Upload files to GitHub Releases (including .sig signature files)
   ↓
4. Run updater scripts to generate update.json
   ↓
5. Upload update.json to server/GitHub
   ↓
6. App automatically checks and installs updates
```

## Prerequisites

- Node.js 16+
- GitHub Personal Access Token (with `repo` scope)
- Tauri signing keypair (see setup instructions below)

## Initial Setup: Generate Signing Keys

Before using the updater system, you need to generate a keypair for signing releases.

### Step 1: Generate Keypair

```bash
# Install Tauri CLI if you haven't already
pnpm add -D @tauri-apps/cli

# Generate a new keypair
pnpm tauri signer generate -w ~/.tauri/transkit.key
```

This command will:
- Generate a private key and save it to `~/.tauri/transkit.key`
- Display a public key in the terminal
- Optionally set a password for the private key

**Important**: Save both the private key file and the password securely!

### Step 2: Add Keys to GitHub Secrets

Go to your repository settings → Secrets and variables → Actions, and add:

1. **TAURI_PRIVATE_KEY**: The entire contents of `~/.tauri/transkit.key`
   ```bash
   # View the private key to copy it
   cat ~/.tauri/transkit.key
   ```

2. **TAURI_KEY_PASSWORD**: The password you set when generating the key
   - If you didn't set a password, leave this as an empty secret

### Step 3: Add Public Key to tauri.conf.json

Copy the public key displayed during generation and add it to `src-tauri/tauri.conf.json`:

```json
{
  "tauri": {
    "updater": {
      "active": true,
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

**Note**: The public key should be a base64-encoded string starting with `dW50cnVz...`

## Usage

The updater scripts are automatically run by GitHub Actions after each release. However, you can also run them manually.

### Manual Usage

#### Step 1: Install Dependencies

```bash
cd updater
pnpm install
```

#### Step 2: Set Environment Variables

```bash
# Required
export GITHUB_TOKEN="your_github_personal_access_token"

# Optional (defaults to transkit-app/transkit-desktop)
export REPO_OWNER="transkit-app"
export REPO_NAME="transkit-desktop"
```

#### Step 3: Run Scripts

```bash
# Generate update.json for standard builds
pnpm run updater

# Generate update-fix-runtime.json for Windows WebView2 fixed runtime builds
pnpm run updater:fixRuntime
```

The scripts will generate `update.json` and `update-fix-runtime.json` in the updater directory.

#### Step 4: Upload update.json

**Option A: Automatic with GitHub Actions (Recommended)**

The scripts run automatically after each release. No manual action needed.

**Option B: Manual Upload**

```bash
# Upload to GitHub releases
gh release upload updater update.json update-fix-runtime.json --clobber

# Or upload to your web server
scp update.json user@transkit.app:/var/www/transkit-desktop/updater/
scp update-fix-runtime.json user@transkit.app:/var/www/transkit-desktop/updater/
```

## GitHub Actions Integration

The workflow is already configured in `.github/workflows/package.yml`. When you push a tag, it will:

1. Build the app for all platforms
2. Sign all installers with `TAURI_PRIVATE_KEY`
3. Upload signed files to GitHub Releases
4. Run updater scripts to generate update.json files
5. Upload update.json files to the `updater` release tag

**To trigger a release:**

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Expected File Structure

After running the scripts, your GitHub release should contain:

```
GitHub Release (v1.0.0):
├── TransKit_1.0.0_aarch64.app.tar.gz
├── TransKit_1.0.0_aarch64.app.tar.gz.sig
├── TransKit_1.0.0_x64.app.tar.gz
├── TransKit_1.0.0_x64.app.tar.gz.sig
├── TransKit_1.0.0_x64-setup.nsis.zip
├── TransKit_1.0.0_x64-setup.nsis.zip.sig
├── TransKit_1.0.0_x86-setup.nsis.zip
├── TransKit_1.0.0_x86-setup.nsis.zip.sig
├── TransKit_1.0.0_arm64-setup.nsis.zip
├── TransKit_1.0.0_arm64-setup.nsis.zip.sig
├── TransKit_1.0.0_amd64.AppImage.tar.gz
├── TransKit_1.0.0_amd64.AppImage.tar.gz.sig
└── ... (DMG and other installers)

GitHub Release (updater):
├── update.json
└── update-fix-runtime.json
```

## Generated update.json Format

```json
{
  "name": "v1.0.0",
  "notes": "Release notes from GitHub...",
  "pub_date": "2024-01-28T10:00:00.000Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVz...",
      "url": "https://github.com/transkit-app/transkit-desktop/releases/download/v1.0.0/TransKit_1.0.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { ... },
    "windows-x86_64": { ... },
    "windows-i686": { ... },
    "windows-aarch64": { ... },
    "linux-x86_64": { ... }
  }
}
```

## Updater Endpoints

The app checks for updates at these endpoints (configured in `tauri.conf.json`):

1. `https://transkit.app/transkit-desktop/updater/update.json` (primary)
2. `https://github.com/transkit-app/transkit-desktop/releases/download/updater/update.json` (fallback)

## Troubleshooting

### Error: GITHUB_TOKEN is required

You haven't set the `GITHUB_TOKEN` environment variable.

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

### Error: 404 Not Found

- The GitHub release doesn't exist yet
- File names don't match the expected format
- Token doesn't have `repo` permission

### Empty Signature

- The `.sig` file doesn't exist in the release
- Files weren't signed during build
- `TAURI_PRIVATE_KEY` or `TAURI_KEY_PASSWORD` not set in GitHub Secrets

### Signature Verification Failed

- Public key in `tauri.conf.json` doesn't match the private key used to sign
- `.sig` file is corrupted or from a different build

### How to Rotate Keys

If you need to change signing keys:

1. Generate a new keypair: `pnpm tauri signer generate -w ~/.tauri/transkit-new.key`
2. Update `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD` in GitHub Secrets
3. Update `pubkey` in `tauri.conf.json` with the new public key
4. **Important**: Users on old versions won't be able to update. You may need to:
   - Keep both old and new update endpoints temporarily
   - Provide manual download instructions for one version

## Scripts

### `updater.mjs`

Generates `update.json` for standard builds across all platforms:
- macOS (Intel and Apple Silicon)
- Windows (x64, x86, ARM64)
- Linux (x64)

### `updater-for-fix-runtime.mjs`

Generates `update-fix-runtime.json` specifically for Windows builds that bundle a fixed version of the WebView2 runtime. These builds are larger but work on systems without WebView2 pre-installed.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | Yes | - | GitHub Personal Access Token with `repo` scope |
| `REPO_OWNER` | No | `transkit-app` | GitHub repository owner |
| `REPO_NAME` | No | `transkit-desktop` | GitHub repository name |

## Security Notes

- Never commit your private key or `.key` files to version control
- Store `TAURI_PRIVATE_KEY` only in GitHub Secrets
- The public key is safe to commit and should be in `tauri.conf.json`
- Each signature (`.sig` file) is unique to its installer file
- Users verify signatures automatically during updates using the public key
