# pnpm install --resolution-only
pnpm install

# wry 0.24.11 webkit2gtk fix is handled via [patch.crates-io] in Cargo.toml
# pointing to patches/wry/ which uses explicit extension trait imports instead
# of the invalid webkit2gtk::traits::* path (pub(crate), not public API).

sed -i "s/#openssl/openssl={version=\"0.10\",features=[\"vendored\"]}/g" src-tauri/Cargo.toml
if [ "$INPUT_TARGET" = "x86_64-unknown-linux-gnu" ]; then
    pnpm tauri build --target $INPUT_TARGET
else
    pnpm tauri build --target $INPUT_TARGET -b deb rpm
fi
