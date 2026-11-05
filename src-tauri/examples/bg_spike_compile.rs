//! Compiles the generator catalog to GLSL ES 3.00 and writes the TypeScript
//! bundle consumed by the webview.
//!
//! Run from the repository root:
//! `cargo run --manifest-path src-tauri/Cargo.toml --example bg_spike_compile`

use lumen_lib::backgrounds_spike;

fn main() {
    match backgrounds_spike::write_generated() {
        Ok(path) => println!("generated {path}"),
        Err(error) => {
            eprintln!("generator bundle failed:\n{error}");
            std::process::exit(1);
        }
    }
}
