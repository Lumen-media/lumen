pub mod dependencies;
pub mod downloader;
pub mod github;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use dependencies::{DependencyInfo, DependencyStatus};
use downloader::{DownloadQuality, DownloadResult};

#[derive(Clone)]
pub struct DownloadState {
    pub tools_dir: PathBuf,
    pub active_downloads: downloader::ActiveDownloads,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadStatusInfo {
    pub status: String,
    pub progress: Option<f64>,
}

fn tools_dir_from_app(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("tools"))
}

pub fn initialize_download_state(app: &AppHandle) -> Result<DownloadState, String> {
    let dir = tools_dir_from_app(app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create tools directory: {}", e))?;

    Ok(DownloadState {
        tools_dir: dir,
        active_downloads: downloader::create_active_downloads(),
    })
}

#[tauri::command]
pub async fn check_dependencies(
    _state: State<'_, DownloadState>,
    app: AppHandle,
) -> Result<DependencyStatus, String> {
    dependencies::check_dependencies(&app)
}

#[tauri::command]
pub async fn download_dependencies(app: AppHandle) -> Result<(), String> {
    dependencies::download_dependencies(app).await
}

#[tauri::command]
pub async fn list_dependencies(app: AppHandle) -> Result<Vec<DependencyInfo>, String> {
    dependencies::list_dependencies(&app)
}

#[tauri::command]
pub async fn download_video(
    state: State<'_, DownloadState>,
    app: AppHandle,
    url: String,
    provider: String,
    quality: DownloadQuality,
) -> Result<DownloadResult, String> {
    downloader::start_download(
        app,
        state.tools_dir.clone(),
        state.active_downloads.clone(),
        url,
        provider,
        quality,
    )
    .await
}

#[tauri::command]
pub async fn cancel_download(
    state: State<'_, DownloadState>,
    download_id: String,
) -> Result<(), String> {
    downloader::cancel_download(&state.active_downloads, &download_id).await
}

#[tauri::command]
pub async fn get_download_status(
    state: State<'_, DownloadState>,
    download_id: String,
) -> Result<Option<DownloadStatusInfo>, String> {
    let downloads = state.active_downloads.lock().await;
    if downloads.contains_key(&download_id) {
        Ok(Some(DownloadStatusInfo {
            status: "downloading".to_string(),
            progress: None,
        }))
    } else {
        Ok(None)
    }
}
