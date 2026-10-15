//! Loopback HTTP server used while developing modules.
//!
//! [`start_dev_server`] runs an [axum] server bound to `127.0.0.1:5179` that
//! exposes the module runtime over plain HTTP so a module's build tooling (or a
//! browser) can install, reload, disable and uninstall modules and read module
//! files without going through the Tauri IPC bridge.
//!
//! Endpoints:
//!
//! | method | path                          | action                          |
//! |--------|-------------------------------|---------------------------------|
//! | GET    | `/modules`                    | list all registered modules     |
//! | POST   | `/modules`                    | install (`{ path, dev_mode }`)  |
//! | POST   | `/modules/{id}/reload`        | emit `module:reload`            |
//! | POST   | `/modules/{id}/disable`       | disable a module                |
//! | DELETE | `/modules/{id}`               | uninstall a module              |
//! | GET    | `/module-files/*path`         | serve `{module_id}/{file}`      |
//!
//! The server is only ever started on the loopback interface and failure to
//! bind (for example when another instance is running) is logged rather than
//! propagated.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

use crate::module_runtime::ModuleRuntime;

/// TCP port the development server listens on (loopback only).
pub const DEV_SERVER_PORT: u16 = 5179;

/// Shared state passed to every axum handler: the Tauri app handle, used to
/// reach [`ModuleRuntime`] and to emit events.
#[derive(Clone)]
struct AppState {
    app: AppHandle,
}

/// JSON body for `POST /modules`.
#[derive(Deserialize)]
struct InstallBody {
    /// Path to a `.lumenpack` file or module directory.
    path: String,
    /// Install the directory in place instead of copying it.
    #[serde(default)]
    dev_mode: bool,
}

/// JSON representation of a module returned by `GET /modules`.
#[derive(Serialize)]
struct ModuleListItem {
    /// Module id.
    id: String,
    /// Installed version.
    version: String,
    /// Install source (`sideload`, `dev`, `store`).
    source: String,
    /// Whether the module is enabled.
    enabled: bool,
}

/// Starts the development server on `127.0.0.1:DEV_SERVER_PORT`.
///
/// The function runs until the server stops and never returns an error: a bind
/// failure is logged and the function returns, so callers can `spawn` it
/// without handling failure.
pub async fn start_dev_server(app: AppHandle) {
    let state = AppState { app: app.clone() };

    let router = Router::new()
        .route("/modules", get(list_modules))
        .route("/modules", post(install_module))
        .route("/modules/{id}/reload", post(reload_module))
        .route("/modules/{id}/disable", post(disable_module))
        .route("/modules/{id}", delete(uninstall_module))
        .route("/module-files/*path", get(serve_module_file))
        .with_state(Arc::new(state));

    let addr = SocketAddr::from(([127, 0, 0, 1], DEV_SERVER_PORT));
    match TcpListener::bind(addr).await {
        Ok(listener) => {
            log::info!("[dev-server] listening on http://{addr}");
            if let Err(e) = axum::serve(listener, router).await {
                log::error!("[dev-server] server error: {e}");
            }
        }
        Err(e) => {
            log::error!("[dev-server] failed to bind {addr}: {e}");
        }
    }
}

/// `GET /modules`: lists every registered module (enabled or not).
async fn list_modules(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    use tauri::Manager;
    let runtime = state.app.state::<ModuleRuntime>();
    let reg = match runtime.registry.lock() {
        Ok(r) => r,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(Vec::<ModuleListItem>::new())),
    };
    let entries = reg.list_all().unwrap_or_default();
    let items: Vec<ModuleListItem> = entries
        .into_iter()
        .map(|e| ModuleListItem {
            id: e.id,
            version: e.version,
            source: e.source,
            enabled: e.enabled,
        })
        .collect();
    (StatusCode::OK, Json(items))
}

/// `POST /modules`: installs a module from a path, delegating to
/// [`super::module_install`]. Returns `400` with the error message on failure.
async fn install_module(
    State(state): State<Arc<AppState>>,
    Json(body): Json<InstallBody>,
) -> impl IntoResponse {
    match super::module_install(state.app.clone(), body.path, body.dev_mode) {
        Ok(m) => (
            StatusCode::OK,
            Json(serde_json::json!({ "id": m.manifest.id, "status": "installed" })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

/// `POST /modules/{id}/reload`: emits `module:reload` so the frontend reloads
/// the module. Returns `500` if the event cannot be emitted.
async fn reload_module(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    state
        .app
        .emit("module:reload", &id)
        .map(|_| (StatusCode::OK, Json(serde_json::json!({ "status": "reload-requested" }))))
        .unwrap_or_else(|e: tauri::Error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })
}

/// `POST /modules/{id}/disable`: disables a module via
/// [`super::module_disable`]. Returns `400` on failure.
async fn disable_module(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match super::module_disable(state.app.clone(), id) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "status": "disabled" }))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

/// `DELETE /modules/{id}`: uninstalls a module via
/// [`super::module_uninstall`]. Returns `400` on failure.
async fn uninstall_module(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match super::module_uninstall(state.app.clone(), id) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "status": "uninstalled" }))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

/// `GET /module-files/{module_id}/{file}`: serves a file from a module's
/// directory with a minimal MIME mapping and permissive CORS. Returns `400`
/// for a malformed path, `404` when the module or file is missing.
async fn serve_module_file(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
) -> Response {
    use tauri::Manager;
    let (id, file) = match path.split_once('/') {
        Some(pair) => (pair.0.to_string(), pair.1.to_string()),
        None => return (StatusCode::BAD_REQUEST, "expected path: {module_id}/{file}").into_response(),
    };
    let runtime = state.app.state::<ModuleRuntime>();
    let entry = runtime.registry.lock().ok()
        .and_then(|reg| reg.get(&id).ok().flatten());

    let Some(entry) = entry else {
        return (StatusCode::NOT_FOUND, "module not found").into_response();
    };

    let full_path = entry.path.join(&file);
    match std::fs::read(&full_path) {
        Ok(bytes) => {
            let mime = match full_path.extension().and_then(|e| e.to_str()).unwrap_or("") {
                "js" | "mjs" => "application/javascript",
                "css" => "text/css",
                "json" => "application/json",
                _ => "application/octet-stream",
            };
            let mut res = (StatusCode::OK, bytes).into_response();
            res.headers_mut().insert("Content-Type", HeaderValue::from_static(mime));
            res.headers_mut().insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
            res
        }
        Err(_) => (StatusCode::NOT_FOUND, "file not found").into_response(),
    }
}
