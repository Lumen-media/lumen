mod image_thumb;
mod os_thumb;
mod video_thumb;

use std::path::Path;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_thumbnail(app: AppHandle, path: String, size: Option<u32>) -> Result<String, String> {
    let src = Path::new(&path);
    let size = size.unwrap_or(200);

    if !src.exists() {
        return Err(format!("file not found: {path}"));
    }

    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lumen")
        .join("cache")
        .join("thumbs");

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let key = blake3::hash(path.as_bytes()).to_hex();
    let dest = cache_dir.join(format!("{key}_{size}.jpg"));

    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    // Try OS thumbnail cache first (blocking — COM/fs I/O)
    let saved = {
        let src_buf = src.to_path_buf();
        let dest_buf = dest.clone();
        tokio::task::spawn_blocking(move || os_thumb::try_get(&src_buf, &dest_buf, size))
            .await
            .unwrap_or(false)
    };

    if saved {
        return Ok(dest.to_string_lossy().to_string());
    }

    // OS had nothing — generate ourselves
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" => {
            image_thumb::generate(src, &dest, size)?;
        }
        "mp4" | "mov" | "m4v" => {
            video_thumb::generate(src, &dest, size)?;
        }
        _ => return Err("unsupported file type".into()),
    }

    Ok(dest.to_string_lossy().to_string())
}
