fn main() {
    // screencapturekit requires Swift runtime (libswift_Concurrency.dylib).
    // On macOS 12+, the library lives in /usr/lib/swift (dyld shared cache).
    // Adding it as an rpath lets the dynamic linker find it at launch.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    tauri_build::build()
}
