use tauri::{Manager, UriSchemeContext};

use crate::module_runtime::ModuleRuntime;

pub fn handle_module_request(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let runtime = ctx.app_handle().state::<ModuleRuntime>();
    let modules_dir = runtime.modules_dir.clone();
    let registry = runtime.registry.clone();

    let uri = request.uri().to_string();

    let path_part = uri
        .strip_prefix("lumen-module://")
        .unwrap_or("")
        .trim_start_matches('/');

    let parts: Vec<&str> = path_part.splitn(2, '/').collect();
    if parts.len() < 2 {
        return tauri::http::Response::builder()
            .status(400)
            .body(b"Bad Request: expected lumen-module://{id}/{file}".to_vec())
            .unwrap();
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
        return tauri::http::Response::builder()
            .status(403)
            .body(b"Forbidden: module is not enabled".to_vec())
            .unwrap();
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
            tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", content_type)
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes)
                .unwrap()
        }
        Err(e) => tauri::http::Response::builder()
            .status(404)
            .body(format!("Not Found: {e}").into_bytes())
            .unwrap(),
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
