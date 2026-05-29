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

pub const DEV_SERVER_PORT: u16 = 5179;

#[derive(Clone)]
struct AppState {
    app: AppHandle,
}

#[derive(Deserialize)]
struct InstallBody {
    path: String,
    #[serde(default)]
    dev_mode: bool,
}

#[derive(Serialize)]
struct ModuleListItem {
    id: String,
    version: String,
    source: String,
    enabled: bool,
}

pub async fn start_dev_server(app: AppHandle) {
    let state = AppState { app: app.clone() };

    let router = Router::new()
        .route("/modules", get(list_modules))
        .route("/modules", post(install_module))
        .route("/modules/{id}/reload", post(reload_module))
        .route("/modules/{id}/disable", post(disable_module))
        .route("/modules/{id}", delete(uninstall_module))
        .route("/module-files/{id}/{*file}", get(serve_module_file))
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

async fn serve_module_file(
    State(state): State<Arc<AppState>>,
    Path((id, file)): Path<(String, String)>,
) -> Response {
    use tauri::Manager;
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
