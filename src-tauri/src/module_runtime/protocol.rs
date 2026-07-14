use std::{fs, path::PathBuf};

use rusqlite::{params, Connection};
use tauri::{Manager, UriSchemeContext};

use crate::module_runtime::ModuleRuntime;

pub fn handle_module_request(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let uri = request.uri().to_string();

    let path_part = uri
        .strip_prefix("lumen-module://")
        .or_else(|| uri.strip_prefix("http://lumen-module.localhost/"))
        .or_else(|| uri.strip_prefix("https://lumen-module.localhost/"))
        .unwrap_or("")
        .trim_start_matches('/');

    let parts: Vec<&str> = path_part.splitn(2, '/').collect();
    if parts.len() < 2 {
        return response(400, "Bad Request: expected lumen-module://{id}/{file}");
    }

    let module_id = parts[0];
    let file_path = parts[1];

    if module_id == "__theme" {
        return handle_theme_request(file_path);
    }

    if (module_id == "localhost" || module_id == "lumen-module.localhost")
        && file_path.starts_with("__theme/")
    {
        return handle_theme_request(file_path.trim_start_matches("__theme/"));
    }

    let runtime = ctx.app_handle().state::<ModuleRuntime>();
    let registry = runtime.registry.clone();

    let entry = registry
        .lock()
        .ok()
        .and_then(|reg| reg.get(module_id).ok().flatten());

    let Some(entry) = entry else {
        return response(403, "Forbidden: module is not enabled");
    };

    if !entry.enabled {
        return response(403, "Forbidden: module is not enabled");
    }

    let full_path = entry.path.join(file_path);

    match fs::read(&full_path) {
        Ok(bytes) => tauri::http::Response::builder()
            .status(200)
            .header(
                "Content-Type",
                mime_for_ext(full_path.extension().and_then(|e| e.to_str()).unwrap_or("")),
            )
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap(),
        Err(e) => response(404, format!("Not Found: {e}")),
    }
}

fn handle_theme_request(file_path: &str) -> tauri::http::Response<Vec<u8>> {
    match resolve_theme_path(file_path) {
        Ok(path) => match fs::read(&path) {
            Ok(bytes) => tauri::http::Response::builder()
                .status(200)
                .header(
                    "Content-Type",
                    mime_for_ext(path.extension().and_then(|e| e.to_str()).unwrap_or("")),
                )
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes)
                .unwrap(),
            Err(error) => response(404, format!("Not Found: {error}")),
        },
        Err((status, message)) => response(status, message),
    }
}

fn resolve_theme_path(file_path: &str) -> Result<PathBuf, (u16, String)> {
    let parts = file_path.split('/').collect::<Vec<_>>();
    if parts.len() != 2 || parts[0] != "id" {
        return Err((400, "Bad Request: expected lumen-module://__theme/id/{id} or http://lumen-module.localhost/__theme/id/{id}".to_string()));
    }

    let id = parts[1]
        .parse::<i64>()
        .map_err(|_| (400, "Bad Request: invalid theme id".to_string()))?;

    let db_path = app_base_dir()?.join("lumen.db");
    let connection = Connection::open(db_path).map_err(|e| (500, e.to_string()))?;
    let path: String = connection
        .query_row(
            "SELECT path FROM theme_files WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| (404, "Not Found: theme id not found".to_string()))?;

    let theme_path = PathBuf::from(path);
    let canonical_theme_path = theme_path
        .canonicalize()
        .map_err(|e| (404, format!("Not Found: {e}")))?;
    let canonical_themes_dir = app_base_dir()?
        .join("files")
        .join("media")
        .join("themes")
        .canonicalize()
        .map_err(|e| (404, format!("Themes directory not found: {e}")))?;

    if !canonical_theme_path.starts_with(&canonical_themes_dir) {
        return Err((403, "Forbidden: theme path is outside the themes directory".to_string()));
    }

    Ok(canonical_theme_path)
}

fn app_base_dir() -> Result<PathBuf, (u16, String)> {
    let exe = std::env::current_exe().map_err(|e| (500, e.to_string()))?;
    let parent = exe
        .parent()
        .ok_or_else(|| (500, "Could not resolve executable directory".to_string()))?;
    Ok(parent.join("lumen"))
}

fn response(status: u16, body: impl Into<String>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .body(body.into().into_bytes())
        .unwrap()
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
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
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}
