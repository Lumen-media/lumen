mod image_thumb;
mod os_thumb;
pub mod protocol;
mod video_thumb;

use image::GenericImageView;
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

/// Fetches a remote (http/https) image, downscales it to at most `max_size` px
/// and caches the result as WebP under `cache/remote-thumbs/thumb_{hash(url)}_{size}.webp`
/// (the same folder/pattern used by YouTube thumbnails). Each URL/size is
/// processed once and reused forever afterwards.
#[tauri::command]
pub async fn get_remote_thumbnail(url: String, max_size: Option<u32>) -> Result<String, String> {
    let max_size = max_size.unwrap_or(480).clamp(16, 4096);
    let cache_dir = crate::remote::remote_thumbs_dir()?;

    let key = blake3::hash(url.as_bytes()).to_hex().to_string();
    let dest = cache_dir.join(format!("thumb_{key}_{max_size}.webp"));

    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    let bytes = crate::remote::fetch_bytes(&url).await?;

    let saved = {
        let dest_buf = dest.clone();
        tokio::task::spawn_blocking(move || downscale_to_webp(&bytes, &dest_buf, max_size))
            .await
            .unwrap_or(false)
    };

    if !saved {
        return Err("failed to decode or downscale remote image".to_string());
    }

    Ok(dest.to_string_lossy().to_string())
}

/// Decodes an in-memory image and resizes it to fit `max_size` on the longest
/// edge (never upscales), then encodes it as lossy WebP — the same maths the
/// frontend canvas used to perform.
fn downscale_to_webp(bytes: &[u8], dest: &Path, max_size: u32) -> bool {
    let img = match image::load_from_memory(bytes) {
        Ok(img) => img,
        Err(_) => return false,
    };

    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return false;
    }

    let scale = f64::min(1.0, max_size as f64 / f64::max(w as f64, h as f64));
    let target_w = (w as f64 * scale).round().max(1.0) as u32;
    let target_h = (h as f64 * scale).round().max(1.0) as u32;

    let thumb = img.resize_exact(target_w, target_h, image::imageops::FilterType::Triangle);
    thumb
        .save_with_format(dest, image::ImageFormat::WebP)
        .is_ok()
}
