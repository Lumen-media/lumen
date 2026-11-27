fn main() {
    // tauri-build only watches tauri.conf.json, so the icon embedded in the
    // .exe would keep the old image after the icon files are regenerated.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
