//! Custom URI scheme handler that serves module assets.
//!
//! Registered in [`crate::main`] as the handler for the `lumen-module://`
//! scheme (which Tauri also exposes as `http(s)://lumen-module.localhost/` on
//! platforms where a custom scheme is inconvenient). The webview loads a
//! module's entry script and assets through this handler, so it acts as the
//! sandbox boundary: only files that live inside an *enabled* module's
//! directory are ever returned.
//!
//! URL shape:
//!
//! ```text
//! lumen-module://{module_id}/{relative_file_path}
//! lumen-module://__theme/id/{theme_file_id}
//! ```
//!
//! The `__theme` pseudo-module resolves theme image files stored in the app's
//! `themes` media directory (see [`crate::module_runtime::themes`]), with a
//! canonicalized-path check preventing traversal outside that directory.

use std::{fs, path::PathBuf};

use rusqlite::{params, Connection};
use tauri::{Manager, UriSchemeContext};

use crate::module_runtime::ModuleRuntime;

/// Handles a single `lumen-module://` (or `lumen-module.localhost`) request.
///
/// Parses the URI into a module id and a relative file path, then resolves the
/// file under the module's registry root. Requests are answered with:
///
/// * `200` and the file bytes, with a MIME type inferred from the extension and
///   `Access-Control-Allow-Origin: *`, on success;
/// * `400` when the URI does not contain both an id and a file segment;
/// * `403` when the module is unknown, disabled, or a theme path escapes the
///   themes directory;
/// * `404` when the file cannot be read.
///
/// `module_id == "__theme"` (or a leading `__theme/` segment on the
/// `.localhost` form) is routed to the theme resolver instead of the module
/// registry.
///
/// # Errors
///
/// This function never returns a `Result`; failures are encoded as HTTP status
/// codes in the returned [`tauri::http::Response`]. A poisoned registry mutex
/// is treated as "module not found" (HTTP `403`).
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

/// Serves a theme image by resolving `file_path` through [`resolve_theme_path`].
///
/// Returns `200` with the image bytes (MIME inferred from the extension) or the
/// status/message produced by [`resolve_theme_path`] on failure.
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

/// Maps a `__theme/id/{id}` path to an absolute, canonicalized image path.
///
/// Looks the id up in the `theme_files` table, then verifies that the resolved
/// file lives inside the `themes` media directory to block path traversal.
///
/// # Errors
///
/// Returns an HTTP `(status, message)` pair when the path is malformed
/// (`400`), the id is not numeric (`400`), the database cannot be opened
/// (`500`), the id does not exist or the file is missing (`404`), or the
/// canonical path escapes the themes directory (`403`).
fn resolve_theme_path(file_path: &str) -> Result<PathBuf, (u16, String)> {
    let parts = file_path.split('/').collect::<Vec<_>>();
    if parts.len() != 2 || parts[0] != "id" {
        return Err((400, "Bad Request: expected lumen-module://__theme/id/{id} or http://lumen-module.localhost/__theme/id/{id}".to_string()));
    }

    let id = parts[1]
        .parse::<i64>()
        .map_err(|_| (400, "Bad Request: invalid theme id".to_string()))?;

    let db_path = crate::paths::db_path().map_err(|e| (500, e))?;
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
    let canonical_themes_dir = crate::paths::media_dir("themes")
        .map_err(|e| (500, e))?
        .canonicalize()
        .map_err(|e| (404, format!("Themes directory not found: {e}")))?;

    if !canonical_theme_path.starts_with(&canonical_themes_dir) {
        return Err((403, "Forbidden: theme path is outside the themes directory".to_string()));
    }

    Ok(canonical_theme_path)
}

/// Builds a plain-text HTTP response with the given `status` and `body`.
fn response(status: u16, body: impl Into<String>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .body(body.into().into_bytes())
        .unwrap()
}

/// Returns the MIME type for a file extension (case-insensitive).
///
/// Falls back to `application/octet-stream` for unknown extensions.
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
