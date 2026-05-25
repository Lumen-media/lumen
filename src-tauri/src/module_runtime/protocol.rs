use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, UriSchemeContext, UriSchemeResponder};

use crate::module_runtime::registry::Registry;

pub fn register_lumen_module_protocol(
    app: &AppHandle,
    modules_dir: PathBuf,
    registry: Arc<Mutex<Registry>>,
) {
    let _ = (app, modules_dir, registry);
}

pub fn handle_module_request(
    _ctx: UriSchemeContext<tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
    modules_dir: PathBuf,
    registry: Arc<Mutex<Registry>>,
) {
    let uri = request.uri().to_string();

    let path_part = uri
        .strip_prefix("lumen-module://")
        .unwrap_or("")
        .trim_start_matches('/');

    let parts: Vec<&str> = path_part.splitn(2, '/').collect();
    if parts.len() < 2 {
        responder.respond(
            tauri::http::Response::builder()
                .status(400)
                .body(b"Bad Request: expected lumen-module://{id}/{file}".to_vec())
                .unwrap(),
        );
        return;
    }

    let module_id = parts[0];
    let file_path = parts[1];

    let enabled = registry
        .lock()
        .ok()
        .and_then(|reg| reg.get(module_id).ok().flatten())
        .map(|e| e.enabled)
        .unwrap_or(false);

    if !enabled {
        responder.respond(
            tauri::http::Response::builder()
                .status(403)
                .body(b"Forbidden: module is not enabled".to_vec())
                .unwrap(),
        );
        return;
    }

    let full_path = modules_dir.join(module_id).join(file_path);

    match std::fs::read(&full_path) {
        Ok(bytes) => {
            let content_type = mime_for_ext(
                full_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or(""),
            );
            responder.respond(
                tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", content_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .unwrap(),
            );
        }
        Err(e) => {
            responder.respond(
                tauri::http::Response::builder()
                    .status(404)
                    .body(format!("Not Found: {e}").into_bytes())
                    .unwrap(),
            );
        }
    }
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}
