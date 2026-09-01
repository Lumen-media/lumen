use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use tauri::{Manager, UriSchemeContext};
use url::{form_urlencoded, Url};

use super::{image_thumb, video_thumb};

const TOLERANCE: f64 = 1.5;
const DEFAULT_THUMB: u32 = 480;
const JPEG_QUALITY_THUMB: u8 = 82;
const JPEG_QUALITY_FULL: u8 = 88;

static INDEX: OnceLock<Mutex<HashMap<String, Vec<(u32, u32, PathBuf)>>>> = OnceLock::new();

pub fn handle_lumen_request(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let is_thumb = uri.contains("lumen-thumb");

    let path_part = if is_thumb {
        uri.strip_prefix("lumen-thumb://")
            .or_else(|| uri.strip_prefix("http://lumen-thumb.localhost/"))
            .or_else(|| uri.strip_prefix("https://lumen-thumb.localhost/"))
    } else {
        uri.strip_prefix("lumen://")
            .or_else(|| uri.strip_prefix("http://lumen.localhost/"))
            .or_else(|| uri.strip_prefix("https://lumen.localhost/"))
    }
    .unwrap_or("")
    .trim_start_matches('/');

    let (_, query) = match path_part.split_once('?') {
        Some(p) => p,
        None => ("", ""),
    };

    let mut src = String::new();
    let mut req_w: Option<u32> = None;
    let mut req_h: Option<u32> = None;
    for (k, v) in form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "src" => src = v.into_owned(),
            "w" => req_w = v.parse().ok(),
            "h" => req_h = v.parse().ok(),
            _ => {}
        }
    }

    if src.is_empty() {
        return response(400, "Bad Request: missing src parameter");
    }

    let cache_root = match ctx
        .app_handle()
        .path()
        .app_data_dir()
        .map(|d| d.join("lumen").join("cache"))
    {
        Ok(d) => d,
        Err(e) => return response(500, e.to_string()),
    };

    match process(&cache_root, &src, is_thumb, req_w, req_h) {
        Ok((bytes, mime)) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "public, max-age=31536000, immutable")
            .body(bytes)
            .unwrap(),
        Err((status, msg)) => response(status, msg),
    }
}

fn process(
    cache_root: &Path,
    src: &str,
    is_thumb: bool,
    req_w: Option<u32>,
    req_h: Option<u32>,
) -> Result<(Vec<u8>, &'static str), (u16, String)> {
    let is_remote = src.starts_with("http://") || src.starts_with("https://");

    let has_dims = req_w.is_some() || req_h.is_some();

    if has_dims || (is_thumb && req_w.is_none() && req_h.is_none()) {
        let (w, h) = match (req_w, req_h) {
            (Some(w), Some(h)) => (w.max(1), h.max(1)),
            (Some(w), None) => (w.max(1), w.max(1)),
            (None, Some(h)) => (h.max(1), h.max(1)),
            (None, None) => (DEFAULT_THUMB, DEFAULT_THUMB),
        };
        return sized(&local_cache_dir(cache_root, is_remote), src, is_remote, w, h)
            .map(|bytes| (bytes, "image/jpeg"));
    }

    if is_remote {
        if is_unsplash(src) {
            let dir = local_cache_dir(cache_root, true);
            std::fs::create_dir_all(&dir).map_err(io_err)?;
            let hash = blake3::hash(src.as_bytes()).to_hex();
            let dest = dir.join(format!("{hash}_full.jpg"));
            if let Ok(cached) = std::fs::read(&dest) {
                return Ok((cached, "image/jpeg"));
            }
            let bytes = fetch(&unsplash_optimized(src, None, None))?;
            let _ = std::fs::write(&dest, &bytes);
            return Ok((bytes, "image/jpeg"));
        }
        let bytes = fetch(src)?;
        match image::load_from_memory(&bytes) {
            Ok(img) => {
                let dir = local_cache_dir(cache_root, true);
                std::fs::create_dir_all(&dir).map_err(io_err)?;
                let hash = blake3::hash(src.as_bytes()).to_hex();
                let dest = dir.join(format!("{hash}_full.jpg"));
                write_jpeg(&img, &dest, JPEG_QUALITY_FULL).map_err(str_err)?;
                std::fs::read(&dest)
                    .map(|b| (b, "image/jpeg"))
                    .map_err(io_err)
            }
            Err(_) => Ok((bytes, mime_for_url(src))),
        }
    } else {
        let path = Path::new(src);
        if !path.exists() {
            return Err((404, format!("file not found: {src}")));
        }
        let ext = extension_of(src);
        if is_image_ext(&ext) {
            let dir = local_cache_dir(cache_root, false);
            std::fs::create_dir_all(&dir).map_err(io_err)?;
            let hash = blake3::hash(src.as_bytes()).to_hex();
            let dest = dir.join(format!("{hash}_full.jpg"));
            let img = image::open(path).map_err(|e| (400, format!("image decode: {e}")))?;
            write_jpeg(&img, &dest, JPEG_QUALITY_FULL).map_err(str_err)?;
            std::fs::read(&dest)
                .map(|b| (b, "image/jpeg"))
                .map_err(io_err)
        } else if is_video_ext(&ext) {
            Ok((std::fs::read(path).map_err(io_err)?, mime_for_ext(&ext)))
        } else {
            Err((415, format!("unsupported source for lumen://: {src}")))
        }
    }
}

fn sized(dir: &Path, src: &str, is_remote: bool, w: u32, h: u32) -> Result<Vec<u8>, (u16, String)> {
    std::fs::create_dir_all(dir).map_err(io_err)?;

    let hash = blake3::hash(src.as_bytes()).to_hex();
    if let Some(dest) = find_cached(dir, &hash, w, h) {
        return std::fs::read(&dest).map_err(io_err);
    }

    let dest = dir.join(format!("{hash}_{w}x{h}.jpg"));

    if is_remote {
        if is_unsplash(src) {
            let bytes = fetch(&unsplash_optimized(src, Some(w), Some(h)))?;
            std::fs::write(&dest, &bytes).map_err(io_err)?;
            cache_insert(dir, &hash, w, h, dest.clone());
            return Ok(bytes);
        }
        let bytes = fetch(src)?;
        let img = image::load_from_memory(&bytes).map_err(|e| (400, format!("image decode: {e}")))?;
        write_jpeg(&img.thumbnail(w, h), &dest, JPEG_QUALITY_THUMB).map_err(str_err)?;
    } else {
        let path = Path::new(src);
        if !path.exists() {
            return Err((404, format!("file not found: {src}")));
        }
        let ext = extension_of(src);
        if is_image_ext(&ext) {
            let img = image::open(path).map_err(|e| (400, format!("image decode: {e}")))?;
            write_jpeg(&img.thumbnail(w, h), &dest, JPEG_QUALITY_THUMB).map_err(str_err)?;
        } else if is_video_ext(&ext) {
            video_thumb::generate_box(path, &dest, w, h).map_err(str_err)?;
        } else {
            return Err((415, format!("unsupported source for lumen-thumb://: {src}")));
        }
    }

    cache_insert(dir, &hash, w, h, dest.clone());
    std::fs::read(&dest).map_err(io_err)
}

fn find_cached(dir: &Path, hash: &str, req_w: u32, req_h: u32) -> Option<PathBuf> {
    let index_key = format!("{}::{}", dir.display(), hash);
    let index = INDEX.get_or_init(|| Mutex::new(HashMap::new()));
    let mut lock = index.lock().unwrap();
    if !lock.contains_key(&index_key) {
        lock.insert(index_key.clone(), scan_cache(dir, hash));
    }
    let entries = &lock[&index_key];

    let max_w = (req_w as f64 * TOLERANCE).ceil() as u64;
    let max_h = (req_h as f64 * TOLERANCE).ceil() as u64;

    let mut best: Option<(u64, PathBuf)> = None;
    for (cw, ch, path) in entries {
        if *cw >= req_w && *ch >= req_h && (*cw as u64) <= max_w && (*ch as u64) <= max_h {
            let area = (*cw as u64) * (*ch as u64);
            if best.as_ref().map_or(true, |(a, _)| area < *a) {
                best = Some((area, path.clone()));
            }
        }
    }
    best.map(|(_, p)| p)
}

fn scan_cache(dir: &Path, hash: &str) -> Vec<(u32, u32, PathBuf)> {
    let prefix = format!("{hash}_");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(rest) = name.strip_prefix(&prefix) {
                if let Some((w, h)) = parse_dims(rest) {
                    out.push((w, h, entry.path()));
                }
            }
        }
    }
    out
}

fn parse_dims(rest: &str) -> Option<(u32, u32)> {
    let rest = rest.strip_suffix(".jpg")?;
    let (w, h) = rest.split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

fn cache_insert(dir: &Path, hash: &str, w: u32, h: u32, path: PathBuf) {
    let index_key = format!("{}::{}", dir.display(), hash);
    let index = INDEX.get_or_init(|| Mutex::new(HashMap::new()));
    let mut lock = index.lock().unwrap();
    lock.entry(index_key).or_default().push((w, h, path));
}

fn write_jpeg(img: &image::DynamicImage, dest: &Path, quality: u8) -> Result<(), String> {
    let file = std::fs::File::create(dest).map_err(|e| format!("create cache file: {e}"))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, quality);
    encoder
        .encode_image(&img.to_rgb8())
        .map_err(|e| format!("encode jpeg: {e}"))
}

fn fetch(url: &str) -> Result<Vec<u8>, (u16, String)> {
    let resp = reqwest::blocking::get(url).map_err(|e| (502, format!("fetch {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err((502, format!("upstream status {} for {url}", resp.status())));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| (502, format!("read {url}: {e}")))
}

fn is_unsplash(src: &str) -> bool {
    Url::parse(src)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .map(|h| h == "images.unsplash.com" || h.ends_with(".unsplash.com"))
        .unwrap_or(false)
}

fn unsplash_optimized(src: &str, w: Option<u32>, h: Option<u32>) -> String {
    let mut url = match Url::parse(src) {
        Ok(u) => u,
        Err(_) => return src.to_string(),
    };
    {
        let mut pairs = url.query_pairs_mut();
        if let Some(w) = w {
            pairs.append_pair("w", &w.to_string());
        }
        if let Some(h) = h {
            pairs.append_pair("h", &h.to_string());
        }
        pairs.append_pair("q", "80");
        pairs.append_pair("fit", "crop");
        pairs.append_pair("fm", "jpg");
        pairs.append_pair("auto", "format");
    }
    url.to_string()
}

fn is_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif")
}

fn is_video_ext(ext: &str) -> bool {
    matches!(ext, "mp4" | "mov" | "m4v" | "webm" | "avi" | "mkv")
}

fn extension_of(src: &str) -> String {
    Path::new(src)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

fn mime_for_url(url: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or(url);
    let ext = extension_of(path);
    if is_video_ext(&ext) {
        mime_for_ext(&ext)
    } else {
        "application/octet-stream"
    }
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

fn io_err(e: std::io::Error) -> (u16, String) {
    (500, e.to_string())
}

fn str_err(e: String) -> (u16, String) {
    (500, e)
}

fn response(status: u16, body: impl Into<String>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .body(body.into().into_bytes())
        .unwrap()
}

fn local_cache_dir(cache_root: &Path, is_remote: bool) -> PathBuf {
    if is_remote {
        cache_root.join("remote-thumbs")
    } else {
        cache_root.join("thumbs")
    }
}