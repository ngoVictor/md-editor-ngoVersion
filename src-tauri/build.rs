fn main() {
    // Recompile Windows resources when replacing icons in an existing target cache.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
