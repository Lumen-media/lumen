//! Thumbnail generation and caching for local and remote media.
//!
//! The module turns local files (images and videos) and remote image URLs into
//! small, cached JPEG/WebP thumbnails and exposes them to the webview through
//! two Tauri commands plus the custom `lumen://` and `lumen-thumb://` URI
//! schemes implemented in [`protocol`].
//!
//! Resolution order used by [`get_thumbnail`]:
//!
//! 1. Return the cached JPEG immediately if `<blake3(path)>_<size>.jpg`
//!    already exists under the app data cache directory.
//! 2. Ask the operating system for a native thumbnail ([`os_thumb`]); on
//!    Windows this hits the Shell thumbnail cache, which is by far the
//!    cheapest source for videos and documents.
//! 3. Decode the file in-process: raster images via [`image_thumb`], H.264
//!    videos via [`video_thumb`] (symphonia demux + OpenH264 decode of the
//!    first decodable frame).
//!
//! Thumbnails are content-addressed by the BLAKE3 hash of the *source path*
//! (not the file contents), so moving a file produces a new cache entry.
//!
//! # Frontend commands
//!
//! | Command | Invoke name | Returns |
//! |---|---|---|
//! | [`get_thumbnail`] | `get_thumbnail` | absolute path of the cached JPEG |
//! | [`get_remote_thumbnail`] | `get_remote_thumbnail` | absolute path of the cached WebP |
//!
//! Streaming delivery of the same thumbnails (with on-demand resizing) is
//! handled by [`protocol::handle_lumen_request`] through the `lumen://` and
//! `lumen-thumb://` schemes rather than these commands.

mod image_thumb;
mod os_thumb;
pub mod protocol;
mod video_thumb;

use image::GenericImageView;
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Generates (or returns a cached) thumbnail for a local media file.
///
/// # Tauri command (frontend API)
///
/// Invoke as `invoke<string>('get_thumbnail', { path, size? })`.
///
/// | Argument | Type | Description |
/// |---|---|---|
/// | `path` | `string` | Absolute path of the source file. |
/// | `size` | `number?` | Maximum edge length in pixels. Defaults to `200`. |
///
/// Resolves with the absolute path of the JPEG stored in the app cache
/// directory (`<app-data>/lumen/cache/thumbs/<blake3(path)>_<size>.jpg`).
/// The file is created on first request and reused afterwards; delete it to
/// force regeneration.
///
/// # Examples
///
/// ```js
/// const thumbPath = await invoke('get_thumbnail', {
///   path: 'C:\\Videos\\intro.mp4',
///   size: 320,
/// });
/// // thumbPath === 'C:\\...\\lumen\\cache\\thumbs\\<hash>_320.jpg'
/// ```
///
/// # Errors
///
/// Returns an error string when:
///
/// - `path` does not exist (`file not found: ...`);
/// - the cache directory cannot be created;
/// - the file extension is not one of the supported image types
///   (`png`, `jpg`, `jpeg`, `webp`, `bmp`, `gif`) or video types
///   (`mp4`, `mov`, `m4v`), reported as `unsupported file type`;
/// - decoding, generating, or saving the thumbnail fails (the underlying
///   decoder message is included).
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

/// Generates (or returns a cached) downscaled WebP thumbnail for a remote image.
///
/// Downloads the image at `url`, resizes it so its longest edge fits within
/// `max_size`, and stores the result as WebP in the remote thumbnail cache
/// (`<app-data>/lumen/cache/remote-thumbs/thumb_<blake3(url)>_<max_size>.webp`).
/// Subsequent calls with the same URL and size return the cached file without
/// re-downloading.
///
/// # Tauri command (frontend API)
///
/// Invoke as `invoke<string>('get_remote_thumbnail', { url, maxSize? })`.
///
/// | Argument | Type | Description |
/// |---|---|---|
/// | `url` | `string` | `http(s)` URL of the source image. |
/// | `maxSize` | `number?` | Maximum edge length in pixels, clamped to `16..=4096`. Defaults to `480`. |
///
/// Resolves with the absolute path of the cached WebP file.
///
/// # Examples
///
/// ```js
/// const thumbPath = await invoke('get_remote_thumbnail', {
///   url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
///   maxSize: 640,
/// });
/// ```
///
/// # Errors
///
/// Returns an error string when the app cache directory cannot be resolved or
/// created, the download fails (network error, non-success HTTP status, or a
/// body larger than the 25 MiB remote limit), or the downloaded bytes cannot
/// be decoded and downscaled (`failed to decode or downscale remote image`).
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

/// Decodes `bytes`, scales the image so its longest edge fits within
/// `max_size`, and writes the result to `dest` as WebP.
///
/// Returns `false` instead of panicking when the bytes are not a decodable
/// image or the image has zero width or height.
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
