//! URI scheme handlers that serve media and thumbnails to the webview.
//!
//! The single entry point [`handle_lumen_request`] is registered twice in
//! `main.rs` (as an asynchronous scheme handler) and serves two schemes:
//!
//! - `lumen://` - full-size media: re-encodes images to JPEG once and caches
//!   them; passes videos and already-decodable remote bytes through.
//! - `lumen-thumb://` - on-demand thumbnails: decodes/requests the source at a
//!   requested width `w` and JPEG quality `q`, then caches the result.
//!
//! # URL format
//!
//! ```text
//! lumen-thumb://?src=<source>&w=<width>&q=<quality>
//! lumen://?src=<source>
//! ```
//!
//! - `src` (required) - local absolute path or `http(s)://` URL.
//! - `w` (optional) - target width in pixels; defaults to 480. Height is
//!   derived from the source aspect ratio.
//! - `q` (optional) - JPEG quality `1..=100`; defaults to 82 (thumbs) or 88
//!   (full-size Unsplash sources).
//!
//! Under WebView2 the same URLs are seen as `http://lumen.localhost/...` or
//! `http://lumen-thumb.localhost/...`, and both prefixes are accepted here.
//! The frontend builds these URLs with `lumenUrl()` / `lumenThumbUrl()` in
//! `src/services/lumen-url.ts`.
//!
//! # Behavior
//!
//! - Processing runs on a dedicated thread; the responder is invoked exactly
//!   once from that thread after the work finishes.
//! - Two webview events are emitted around the work for UI feedback:
//!   `lumen:optimizing` (payload: the `src` string) when processing starts and
//!   `lumen:optimized` when it finishes, regardless of success.
//! - Successful responses carry `Access-Control-Allow-Origin: *` and
//!   `Cache-Control: public, max-age=31536000, immutable`, since cache file
//!   names are derived from the source hash and dimensions.
//! - Sized variants are cached under `<app-data>/lumen/cache/thumbs` (local)
//!   or `.../remote-thumbs` (remote) as `<blake3(src)>_q<q>_<w>x<h>.jpg`.
//!   An in-memory index avoids re-scanning the directory, and an existing
//!   cache entry whose width is within 1.5x of the request is reused instead
//!   of re-encoding.
//! - Unsplash sources are rewritten to Unsplash's image CDN parameters
//!   (`w`, `q`, `fit`, `fm=jpg`, `auto=format`) so resizing happens upstream.
//! - Local images take a fast path: OS Shell thumbnail first, then a scaled
//!   JPEG decode that only computes the DCT blocks needed for the target
//!   width, then a full `image` crate decode.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use tauri::{Emitter, Manager, UriSchemeContext, UriSchemeResponder};
use url::{form_urlencoded, Url};

use super::{os_thumb, video_thumb};

/// Width multiplier defining when an already-cached thumbnail is "close
/// enough" to reuse: a cached image at most `1.5x` the requested width and of
/// the same quality is served instead of re-encoding.
const TOLERANCE: f64 = 1.5;
/// Width used for `lumen-thumb://` requests that omit the `w` parameter.
const DEFAULT_THUMB: u32 = 480;
/// JPEG quality for generated thumbnails when `q` is omitted.
const JPEG_QUALITY_THUMB: u8 = 82;
/// JPEG quality for full-size (`lumen://`) re-encoded images.
const JPEG_QUALITY_FULL: u8 = 88;

/// In-memory cache index: key is `<cache dir>::<blake3(src)>` and the value
/// lists every cached variant as `(width, height, quality, path)`.
type ThumbIndex = Mutex<HashMap<String, Vec<(u32, u32, u8, PathBuf)>>>;
/// Process-wide index backing [`find_cached`] and [`cache_insert`].
static INDEX: OnceLock<ThumbIndex> = OnceLock::new();

/// Asynchronous URI scheme handler for the `lumen` and `lumen-thumb` schemes.
///
/// Registered in `main.rs` via
/// `register_asynchronous_uri_scheme_protocol` for both scheme names; the
/// scheme is detected from the request URI (`lumen-thumb` enables sized
/// thumbnail processing, `lumen` serves full-size media).
///
/// # Request processing
///
/// 1. Strip the scheme prefix (`lumen://`, `lumen-thumb://`, or the
///    `http(s)://lumen[-thumb].localhost/` form WebView2 produces) and parse
///    the query string into `src`, `w`, and `q`.
/// 2. Reject requests without `src` with `400`.
/// 3. Spawn a worker thread that emits `lumen:optimizing`, runs [`process`],
///    emits `lumen:optimized`, and answers the [`UriSchemeResponder`]
///    exactly once.
///
/// # Errors
///
/// The response status reflects the failure: `400` for a missing `src` or an
/// undecodable image, `404` when a local `src` does not exist, `415` for
/// unsupported source types, `500` for cache/IO/encoding failures, and `502`
/// for upstream HTTP failures when fetching a remote source. Failures are
/// delivered as plain-text response bodies through the responder rather than
/// as a Rust `Result`.
pub fn handle_lumen_request(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
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
    let mut req_q: Option<u8> = None;
    for (k, v) in form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "src" => src = v.into_owned(),
            "w" => req_w = v.parse().ok(),
            "q" => req_q = v.parse().ok(),
            _ => {}
        }
    }

    if src.is_empty() {
        responder.respond(response(400, "Bad Request: missing src parameter"));
        return;
    }

    let cache_root = match ctx
        .app_handle()
        .path()
        .app_data_dir()
        .map(|d| d.join("lumen").join("cache"))
    {
        Ok(d) => d,
        Err(e) => {
            responder.respond(response(500, e.to_string()));
            return;
        }
    };

    let app = ctx.app_handle().clone();
    let emit_src = src.clone();

    std::thread::spawn(move || {
        let _ = app.emit("lumen:optimizing", &emit_src);
        let res = process(&cache_root, &src, is_thumb, req_w, req_q).map(|(bytes, mime)| {
            tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .body(bytes)
                .unwrap()
        });
        let _ = app.emit("lumen:optimized", &emit_src);
        responder.respond(res.unwrap_or_else(|(status, msg)| response(status, msg)));
    });
}

/// Routes a request to the sized or full-size pipeline and returns the bytes
/// plus their MIME type.
///
/// Sized processing is used whenever `is_thumb` is set or an explicit `w` was
/// requested. Otherwise: remote sources are fetched and re-encoded to JPEG
/// (Unsplash via its CDN, other hosts locally, with caching); local images
/// are re-encoded to JPEG; local videos are streamed through unmodified.
///
/// # Errors
///
/// Returns `(status, message)` for the HTTP response: `404` for missing local
/// files, `415` for unsupported extensions, `400` for decode failures, `500`
/// for IO/encoding failures, and `502` for upstream fetch failures.
fn process(
    cache_root: &Path,
    src: &str,
    is_thumb: bool,
    req_w: Option<u32>,
    req_q: Option<u8>,
) -> Result<(Vec<u8>, &'static str), (u16, String)> {
    let is_remote = src.starts_with("http://") || src.starts_with("https://");

    let has_dims = req_w.is_some();

    if has_dims || is_thumb {
        return sized(&local_cache_dir(cache_root, is_remote), src, is_remote, req_w, req_q)
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
            let bytes = fetch(&unsplash_optimized(src, None, None, JPEG_QUALITY_FULL))?;
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
                if let Ok(cached) = std::fs::read(&dest) {
                    return Ok((cached, "image/jpeg"));
                }
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
            if let Ok(cached) = std::fs::read(&dest) {
                return Ok((cached, "image/jpeg"));
            }
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

/// Produces a JPEG of width `w` (default [`DEFAULT_THUMB`]) and quality `q`
/// (default [`JPEG_QUALITY_THUMB`], clamped to `1..=100`), reusing a cached
/// variant when [`find_cached`] finds one.
///
/// Local images go through the [`decode_local`] fast path; local videos are
/// decoded with the OS thumbnail provider first and
/// [`video_thumb::generate_box_width`] as a fallback; remote sources are
/// fetched and resized, with Unsplash handled through its CDN.
///
/// # Errors
///
/// Returns `(status, message)` for the HTTP response, as described on
/// [`process`].
fn sized(
    dir: &Path,
    src: &str,
    is_remote: bool,
    req_w: Option<u32>,
    req_q: Option<u8>,
) -> Result<Vec<u8>, (u16, String)> {
    std::fs::create_dir_all(dir).map_err(io_err)?;

    let hash = blake3::hash(src.as_bytes()).to_hex();
    let w = req_w.map(|v| v.max(1)).unwrap_or(DEFAULT_THUMB);
    let q = req_q.unwrap_or(JPEG_QUALITY_THUMB).clamp(1, 100);

    if let Some(dest) = find_cached(dir, &hash, w, q) {
        return std::fs::read(&dest).map_err(io_err);
    }

    let path = Path::new(src);
    if !path.exists() {
        return Err((404, format!("file not found: {src}")));
    }

    let cache_name = |w: u32, h: u32| format!("{hash}_q{q}_{w}x{h}.jpg");

    if is_remote {
        if is_unsplash(src) {
            let bytes = fetch(&unsplash_optimized(src, Some(w), None, q))?;
            let (aw, ah) = image_dimensions_bytes(&bytes).map_err(|e| (400, e))?;
            let dest = dir.join(cache_name(aw, ah));
            std::fs::write(&dest, &bytes).map_err(io_err)?;
            cache_insert(dir, &hash, aw, ah, q, dest.clone());
            return Ok(bytes);
        }
        let bytes = fetch(src)?;
        let img = image::load_from_memory(&bytes).map_err(|e| (400, format!("image decode: {e}")))?;
        let (ow, oh) = (img.width(), img.height());
        let h = derive_h(w, ow, oh);
        let dest = dir.join(cache_name(w, h));
        write_jpeg(&img.thumbnail(w, h), &dest, q).map_err(str_err)?;
        cache_insert(dir, &hash, w, h, q, dest.clone());
        return std::fs::read(&dest).map_err(io_err);
    }

    let ext = extension_of(src);
    if is_image_ext(&ext) {
        let img = decode_local(path, w).ok_or_else(|| {
            (400, format!("image decode: {src}"))
        })?;
        let (ow, oh) = (img.width(), img.height());
        let h = derive_h(w, ow, oh);
        let dest = dir.join(cache_name(w, h));
        write_jpeg(&img.thumbnail(w, h), &dest, q).map_err(str_err)?;
        cache_insert(dir, &hash, w, h, q, dest.clone());
        std::fs::read(&dest).map_err(io_err)
    } else if is_video_ext(&ext) {
        let (vw, vh, dest) = if let Some(img) = os_thumb::get_thumbnail(path, w) {
            let (vw, vh) = (img.width(), img.height());
            let dest = dir.join(cache_name(vw, vh));
            write_jpeg(&img, &dest, q).map_err(str_err)?;
            (vw, vh, dest)
        } else {
            let tmp = dir.join(format!("{hash}_q{q}_w{w}.jpg"));
            let (vw, vh) = video_thumb::generate_box_width(path, &tmp, w, q).map_err(str_err)?;
            let dest = dir.join(cache_name(vw, vh));
            if dest != tmp {
                std::fs::rename(&tmp, &dest).map_err(io_err)?;
            }
            (vw, vh, dest)
        };
        cache_insert(dir, &hash, vw, vh, q, dest.clone());
        std::fs::read(&dest).map_err(io_err)
    } else {
        Err((415, format!("unsupported source for lumen-thumb://: {src}")))
    }
}

/// Derives the output height for a target width `w` from the source
/// dimensions, preserving aspect ratio (returns `w` when `ow` is zero).
fn derive_h(w: u32, ow: u32, oh: u32) -> u32 {
    if ow == 0 {
        return w;
    }
    ((w as u64 * oh as u64) / ow as u64).max(1) as u32
}

/// Fast path for local images: try the OS thumbnail first (Shell cache), then a
/// scaled JPEG decode that only decodes the DCT blocks needed for the target
/// width, falling back to a full `image` decode.
///
/// Returns `None` only when all three strategies fail (for example, an
/// undecodable file).
fn decode_local(path: &Path, w: u32) -> Option<image::DynamicImage> {
    if let Some(img) = os_thumb::get_thumbnail(path, w) {
        return Some(img);
    }
    if let Some(img) = decode_scaled_jpeg(path, w) {
        return Some(img);
    }
    image::open(path).ok()
}

/// Decode a JPEG at a reduced scale so we never materialize the full image.
///
/// Uses `jpeg_decoder`'s built-in scaling so only the DCT blocks needed for
/// the target size are computed; returns `None` for non-JPEG files, files
/// whose dimensions cannot be read, or when the requested scale is rejected.
fn decode_scaled_jpeg(path: &Path, w: u32) -> Option<image::DynamicImage> {
    let file = std::fs::File::open(path).ok()?;
    let mut decoder = jpeg_decoder::Decoder::new(std::io::BufReader::new(file));
    decoder.read_info().ok()?;
    let info = decoder.info()?;
    let ow = info.width as u32;
    let oh = info.height as u32;
    if ow == 0 || oh == 0 {
        return None;
    }
    let h = derive_h(w, ow, oh);
    let (sw, sh) = decoder.scale(w.min(u16::MAX as u32) as u16, h.min(u16::MAX as u32) as u16).ok()?;
    let pixels = decoder.decode().ok()?;
    let img = image::RgbImage::from_raw(sw as u32, sh as u32, pixels)?;
    Some(image::DynamicImage::ImageRgb8(img))
}

/// Returns the pixel dimensions of an in-memory image without keeping it.
///
/// # Errors
///
/// Returns a decode error message when `bytes` are not a readable image.
fn image_dimensions_bytes(bytes: &[u8]) -> Result<(u32, u32), String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("image decode: {e}"))?;
    Ok((img.width(), img.height()))
}

/// Looks up an existing cached thumbnail close enough to the request.
///
/// [`INDEX`] is populated from a directory scan on first miss. Among entries
/// with the same quality whose width covers `w` without exceeding
/// `w * `[`TOLERANCE`], the smallest pixel area wins, so the served file is
/// the closest non-upscaled variant. Returns the file to serve, or `None`
/// when nothing matches and a new thumbnail must be generated.
fn find_cached(dir: &Path, hash: &str, w: u32, q: u8) -> Option<PathBuf> {
    let index_key = format!("{}::{}", dir.display(), hash);
    let index = INDEX.get_or_init(|| Mutex::new(HashMap::new()));
    let mut lock = index.lock().unwrap();
    if !lock.contains_key(&index_key) {
        lock.insert(index_key.clone(), scan_cache(dir, hash));
    }
    let entries = &lock[&index_key];

    let max_w = (w as f64 * TOLERANCE).ceil() as u64;

    let mut best: Option<(u64, PathBuf)> = None;
    for (cw, ch, cq, path) in entries {
        if *cq == q && *cw >= w && (*cw as u64) <= max_w {
            let area = (*cw as u64) * (*ch as u64);
            if best.as_ref().map_or(true, |(a, _)| area < *a) {
                best = Some((area, path.clone()));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// Scans `dir` for cache files matching `<hash>_*` and parses their
/// dimensions and quality from the file name.
fn scan_cache(dir: &Path, hash: &str) -> Vec<(u32, u32, u8, PathBuf)> {
    let prefix = format!("{hash}_");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(rest) = name.strip_prefix(&prefix) {
                if let Some((w, h, q)) = parse_dims(rest) {
                    out.push((w, h, q, entry.path()));
                }
            }
        }
    }
    out
}

/// Parses the trailing `<q>_<w>x<h>.jpg` portion of a cache file name.
///
/// Returns `None` when the name does not follow the cache naming convention
/// (for example `*_full.jpg` files, which carry no dimensions).
fn parse_dims(rest: &str) -> Option<(u32, u32, u8)> {
    let rest = rest.strip_suffix(".jpg")?;
    let (qpart, dims) = rest.split_once('_')?;
    let q = qpart.strip_prefix('q')?.parse().ok()?;
    let (w, h) = dims.split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?, q))
}

/// Registers a newly written cache file in the in-memory [`INDEX`] so
/// [`find_cached`] can serve it without another directory scan.
fn cache_insert(dir: &Path, hash: &str, w: u32, h: u32, q: u8, path: PathBuf) {
    let index_key = format!("{}::{}", dir.display(), hash);
    let index = INDEX.get_or_init(|| Mutex::new(HashMap::new()));
    let mut lock = index.lock().unwrap();
    lock.entry(index_key).or_default().push((w, h, q, path));
}

/// Writes `img` to `dest` as an 8-bit JPEG with the given quality.
///
/// # Errors
///
/// Returns an error string when the file cannot be created or the JPEG
/// encoder fails.
fn write_jpeg(img: &image::DynamicImage, dest: &Path, quality: u8) -> Result<(), String> {
    let file = std::fs::File::create(dest).map_err(|e| format!("create cache file: {e}"))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, quality);
    encoder
        .encode_image(&img.to_rgb8())
        .map_err(|e| format!("encode jpeg: {e}"))
}

/// Downloads a URL with the blocking `reqwest` client.
///
/// # Errors
///
/// Returns `(502, message)` when the request fails, the upstream status is
/// not successful, or the body cannot be read.
fn fetch(url: &str) -> Result<Vec<u8>, (u16, String)> {
    let resp = reqwest::blocking::get(url).map_err(|e| (502, format!("fetch {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err((502, format!("upstream status {} for {url}", resp.status())));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| (502, format!("read {url}: {e}")))
}

/// Returns `true` when `src` points at the Unsplash image CDN
/// (`images.unsplash.com` or any `*.unsplash.com` host).
fn is_unsplash(src: &str) -> bool {
    Url::parse(src)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .map(|h| h == "images.unsplash.com" || h.ends_with(".unsplash.com"))
        .unwrap_or(false)
}

/// Appends Unsplash CDN parameters to `src` so the resize and encode happen
/// upstream of Lumen.
///
/// Adds `w`/`h` when provided (using `fit=crop` when both are present,
/// otherwise `fit=max`), plus `q`, `fm=jpg`, and `auto=format`. Returns `src`
/// unchanged when it is not a parseable URL.
fn unsplash_optimized(src: &str, w: Option<u32>, h: Option<u32>, q: u8) -> String {
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
        pairs.append_pair("q", &q.to_string());
        pairs.append_pair(
            "fit",
            if w.is_some() && h.is_some() { "crop" } else { "max" },
        );
        pairs.append_pair("fm", "jpg");
        pairs.append_pair("auto", "format");
    }
    url.to_string()
}

/// Returns `true` for extensions Lumen decodes as raster images.
fn is_image_ext(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif")
}

/// Returns `true` for extensions Lumen recognizes as video containers.
fn is_video_ext(ext: &str) -> bool {
    matches!(ext, "mp4" | "mov" | "m4v" | "webm" | "avi" | "mkv")
}

/// Lowercase file extension of `src`, or an empty string when there is none.
fn extension_of(src: &str) -> String {
    Path::new(src)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

/// Best-effort MIME type for a remote URL based on its path extension
/// (ignoring the query string); falls back to `application/octet-stream`.
fn mime_for_url(url: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or(url);
    let ext = extension_of(path);
    if is_video_ext(&ext) {
        mime_for_ext(&ext)
    } else {
        "application/octet-stream"
    }
}

/// Maps a lowercase file extension to its MIME type, defaulting to
/// `application/octet-stream`.
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

/// Wraps an I/O error as an HTTP `500` response tuple.
fn io_err(e: std::io::Error) -> (u16, String) {
    (500, e.to_string())
}

/// Wraps an encoding error message as an HTTP `500` response tuple.
fn str_err(e: String) -> (u16, String) {
    (500, e)
}

/// Builds a plain-text response with the given status code.
fn response(status: u16, body: impl Into<String>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .body(body.into().into_bytes())
        .unwrap()
}

/// Subdirectory of the app cache used for sized thumbnails: `thumbs` for
/// local sources and `remote-thumbs` for remote ones.
fn local_cache_dir(cache_root: &Path, is_remote: bool) -> PathBuf {
    if is_remote {
        cache_root.join("remote-thumbs")
    } else {
        cache_root.join("thumbs")
    }
}
