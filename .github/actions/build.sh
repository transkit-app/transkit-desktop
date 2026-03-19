# pnpm install --resolution-only
pnpm install

# Hotfix for wry 0.24.11 + webkit2gtk trait import on Linux.
# Some environments fail to resolve SettingsExt methods from traits::*,
# so we patch the dependency source in cargo registry before build.
cargo fetch --manifest-path src-tauri/Cargo.toml || true
for f in $(find "${CARGO_HOME:-/usr/local/cargo}/registry/src" -path "*/wry-0.24.11/src/webview/webkitgtk/mod.rs" 2>/dev/null); do
    if ! grep -q 'use webkit2gtk::SettingsExt;' "$f"; then
        sed -i 's/use webkit2gtk::{/use webkit2gtk::SettingsExt;\\nuse webkit2gtk::{/' "$f"
        echo "Patched wry webkitgtk import: $f"
    fi
done

sed -i "s/#openssl/openssl={version=\"0.10\",features=[\"vendored\"]}/g" src-tauri/Cargo.toml
if [ "$INPUT_TARGET" = "x86_64-unknown-linux-gnu" ]; then
    pnpm tauri build --target $INPUT_TARGET
else
    pnpm tauri build --target $INPUT_TARGET -b deb rpm
fi
