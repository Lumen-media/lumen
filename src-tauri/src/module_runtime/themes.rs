use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::manifest::load_manifest;
use super::net::check_url_allowed;
use super::{app_base_dir, scoped_module_path, ModuleRuntime};

const IMAGE_EXTS: &[&str] = &["gif", "jpg", "jpeg", "png", "webp", "svg", "bmp", "avif"];
const MAX_IMAGE_BYTES: usize = 50_000_000;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ModuleThemeSource {
    Url { url: String },
    File { path: String },
}

#[derive(Debug, Deserialize)]
pub struct ModuleThemeAddInput {
    pub source: ModuleThemeSource,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ModuleThemeAddResult {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub extension: String,
}

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

    let base = app_base_dir()?;
    let themes_dir = base.join("files").join("media").join("themes");
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

    let db_path = base.join("lumen.db");
    let connection = Connection::open(&db_path).map_err(|e| e.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO theme_files (name, path, size, modified_at, extension)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_name, path_str, size, modified_at, ext],
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

fn is_image_ext(ext: &str) -> bool {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    IMAGE_EXTS.contains(&ext.as_str())
}

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

fn split_name(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(dot) if dot > 0 => (name[..dot].to_string(), name[dot..].to_ascii_lowercase()),
        _ => (name.to_string(), String::new()),
    }
}

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

fn unique_destination(dir: &Path, name: &str, ext: &str) -> (PathBuf, String) {
    let mut candidate = format!("{name}{ext}");
    let mut n = 1;
    while dir.join(&candidate).exists() {
        candidate = format!("{name} ({n}){ext}");
        n += 1;
    }
    (dir.join(&candidate), candidate)
}