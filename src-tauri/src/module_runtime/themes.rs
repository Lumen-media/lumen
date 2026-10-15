//! Theme image imports for modules.
//!
//! Modules use backgrounds and other imagery through the shared `theme_files`
//! table in the main Lumen database. [`module_theme_add`] lets a module import
//! an image either from a URL (subject to the same network permissions as
//! [`crate::module_runtime::net`]) or from a path inside its own directory, then
//! copies it into the `themes` media directory and records a row.
//!
//! Imports are content-hashed with BLAKE3: re-importing the exact same bytes
//! returns the existing row instead of writing a duplicate. Filenames are
//! sanitized and uniquified on disk. Imported files are served back to the
//! webview through the `lumen-module://__theme/id/{id}` route (see
//! [`crate::module_runtime::protocol`]).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::manifest::load_manifest;
use super::net::check_url_allowed;
use super::{scoped_module_path, ModuleRuntime};

/// File extensions accepted as theme images (without a leading dot).
const IMAGE_EXTS: &[&str] = &["gif", "jpg", "jpeg", "png", "webp", "svg", "bmp", "avif"];
/// Maximum size of an image that may be imported (50 MB).
const MAX_IMAGE_BYTES: usize = 50_000_000;

/// Where a module theme image is imported from.
///
/// Externally tagged by a `type` field: `{"type":"url","url":...}` or
/// `{"type":"file","path":...}`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ModuleThemeSource {
    /// Download the image from a remote URL (checked against the module's
    /// network permissions).
    Url { url: String },
    /// Read the image from a path inside the module directory (path-traversal
    /// protected).
    File { path: String },
}

/// Input for [`module_theme_add`].
#[derive(Debug, Deserialize)]
pub struct ModuleThemeAddInput {
    /// The image source.
    pub source: ModuleThemeSource,
    /// Optional preferred base name for the stored file.
    #[serde(default)]
    pub name: Option<String>,
}

/// Result of [`module_theme_add`], describing the stored image.
#[derive(Debug, Serialize)]
pub struct ModuleThemeAddResult {
    /// Row id in the `theme_files` table, usable in `lumen-module://__theme/id/{id}`.
    pub id: i64,
    /// Final file name on disk (without directory).
    pub name: String,
    /// Absolute path to the stored image file.
    pub path: String,
    /// Lowercase file extension including the leading dot.
    pub extension: String,
}

/// Tauri command: imports an image into the shared themes store for a module.
///
/// # Frontend API
///
/// ```text
/// invoke("module_theme_add", { moduleId, input })
/// ```
///
/// The module must exist and be enabled. For URL sources the download is
/// subject to the module's network permissions and a size cap; for file sources
/// the path is scoped to the module directory. The image is content-hashed so
/// duplicate imports return the existing entry.
///
/// # Errors
///
/// Returns an error when the module is missing/disabled, its manifest cannot be
/// loaded, the source is unauthorized or outside the module directory, the
/// download fails, the image type is unsupported, the size cap is exceeded, or
/// any filesystem/database operation fails.
#[tauri::command]
pub async fn module_theme_add(
    app: AppHandle,
    module_id: String,
    input: ModuleThemeAddInput,
) -> Result<ModuleThemeAddResult, String> {
    let runtime = app.state::<ModuleRuntime>();

    let entry = runtime
        .registry
        .lock()
        .map_err(|e| e.to_string())?
        .get(&module_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("module not found: {module_id}"))?;

    if !entry.enabled {
        return Err("module is not enabled".into());
    }

    let manifest = load_manifest(&entry.path)?;

    let (bytes, ext, stem) = match &input.source {
        ModuleThemeSource::Url { url } => {
            check_url_allowed(url, &manifest).map_err(|e| e.to_string())?;

            let response = runtime
                .http_client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("failed to download image: {e}"))?;

            if !response.status().is_success() {
                return Err(format!("image download failed: HTTP {}", response.status()));
            }

            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_string());

            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err(format!("image exceeds {MAX_IMAGE_BYTES} byte limit"));
            }

            let ext = mime_to_ext(content_type.as_deref())
                .or_else(|| url_extension(url).filter(|ext| is_image_ext(ext)))
                .unwrap_or_else(|| ".jpg".to_string());

            (bytes.to_vec(), ext, url_stem(url))
        }
        ModuleThemeSource::File { path } => {
            let full = scoped_module_path(&app, &module_id, path)?;
            let bytes = std::fs::read(&full).map_err(|e| format!("failed to read file: {e}"))?;

            let file_name = Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let (stem, ext) = split_name(&file_name);
            (bytes, ext, stem)
        }
    };

    let ext = ext.to_ascii_lowercase();
    if !is_image_ext(&ext) {
        return Err(format!("unsupported image type: {ext}"));
    }

    let db_path = crate::paths::db_path()?;
    let connection = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let content_hash = blake3::hash(&bytes).to_hex().to_string();

    // Dedup by content: if this exact image already exists, return it instead
    // of writing a new file + row. Prevents duplicates from rapid double calls.
    let existing = connection
        .query_row(
            "SELECT id, name, path, extension FROM theme_files WHERE content_hash = ?1",
            params![content_hash],
            |row| {
                Ok(ModuleThemeAddResult {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    extension: row.get(3)?,
                })
            },
        )
        .ok();

    if let Some(result) = existing {
        return Ok(result);
    }

    let themes_dir = crate::paths::media_dir("themes")?;
    std::fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;

    let mut desired = sanitize_filename(input.name.as_deref().unwrap_or(&stem));
    if desired.is_empty() {
        desired = "background".to_string();
    }

    let (file_path, file_name) = unique_destination(&themes_dir, &desired, &ext);
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    let path_str = file_path.to_string_lossy().to_string();
    let size = std::fs::metadata(&file_path)
        .map_err(|e| e.to_string())?
        .len() as i64;
    let modified_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    connection
        .execute(
            "INSERT OR IGNORE INTO theme_files (name, path, size, modified_at, extension, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![file_name, path_str, size, modified_at, ext, content_hash],
        )
        .map_err(|e| e.to_string())?;

    let id: i64 = connection
        .query_row(
            "SELECT id FROM theme_files WHERE path = ?1",
            params![path_str],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(ModuleThemeAddResult {
        id,
        name: file_name,
        path: path_str,
        extension: ext,
    })
}

/// Returns `true` if `ext` (with or without a leading dot) is an image type.
fn is_image_ext(ext: &str) -> bool {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    IMAGE_EXTS.contains(&ext.as_str())
}

/// Maps an HTTP `Content-Type` to a file extension, ignoring parameters.
fn mime_to_ext(content_type: Option<&str>) -> Option<String> {
    let ct = content_type?.split(';').next()?.trim().to_ascii_lowercase();
    let ext = match ct.as_str() {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/svg+xml" => ".svg",
        "image/bmp" => ".bmp",
        "image/avif" => ".avif",
        _ => return None,
    };
    Some(ext.to_string())
}

/// Extracts the lowercased extension (including the dot) from a URL path.
fn url_extension(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let name = parsed.path().rsplit('/').next()?;
    let dot = name.rfind('.')?;
    let ext = &name[dot + 1..];
    if ext.is_empty() {
        None
    } else {
        Some(format!(".{ext}"))
    }
}

/// Derives a base file name (without extension) from a URL path.
///
/// Falls back to `"background"` when the URL has no usable name.
fn url_stem(url: &str) -> String {
    let parsed = url::Url::parse(url).ok();
    let path = parsed.as_ref().map(|u| u.path()).unwrap_or(url);
    let name = path.rsplit('/').next().unwrap_or("");
    let stem = match name.rfind('.') {
        Some(dot) => &name[..dot],
        None => name,
    };
    if stem.is_empty() {
        "background".to_string()
    } else {
        stem.to_string()
    }
}

/// Splits a file name into `(stem, extension)`, lowercasing the extension.
fn split_name(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(dot) if dot > 0 => (name[..dot].to_string(), name[dot..].to_ascii_lowercase()),
        _ => (name.to_string(), String::new()),
    }
}

/// Replaces filesystem-unsafe characters in `name` with `-` and trims trailing
/// dots/spaces. May return an empty string, which callers substitute.
fn sanitize_filename(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().chars() {
        if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    while out.ends_with('.') || out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Finds a non-colliding `(path, file_name)` in `dir` by appending ` (n)`.
fn unique_destination(dir: &Path, name: &str, ext: &str) -> (PathBuf, String) {
    let mut candidate = format!("{name}{ext}");
    let mut n = 1;
    while dir.join(&candidate).exists() {
        candidate = format!("{name} ({n}){ext}");
        n += 1;
    }
    (dir.join(&candidate), candidate)
}