fn main() {
    // screencapturekit requires Swift runtime (libswift_Concurrency.dylib).
    // On macOS 12+, the library lives in /usr/lib/swift (dyld shared cache).
    // Adding it as an rpath lets the dynamic linker find it at launch.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    // Copy Python sidecar scripts into src-tauri/scripts/local_sidecar/ so
    // Tauri's bundler picks them up and ships them with the installer on all
    // platforms.  The authoritative source lives one level up at
    // scripts/local_sidecar/; we never commit the copy to git.
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let src = manifest.join("../scripts/local_sidecar");
    let dst = manifest.join("scripts/local_sidecar");
    if src.exists() {
        copy_dir(&src, &dst).ok();
    }
    println!("cargo:rerun-if-changed=../scripts/local_sidecar");

    tauri_build::build()
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Skip compiled bytecode and cache dirs
        if name_str == "__pycache__" || name_str.ends_with(".pyc") || name_str == ".DS_Store" {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
