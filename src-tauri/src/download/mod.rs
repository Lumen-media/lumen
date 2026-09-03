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
    dependencies::check_dependencies(&app).await
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

#[tauri::command]
pub async fn install_cookies_file(
    state: State<'_, DownloadState>,
    source_path: String,
) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err("Arquivo de cookies não encontrado".to_string());
    }

    let content = std::fs::read(source)
        .map_err(|e| format!("Falha ao ler o arquivo de cookies: {}", e))?;

    // Netscape cookie files always start with this header line.
    let header = b"# Netscape HTTP Cookie File";
    if !content.starts_with(header) {
        return Err(
            "O arquivo não parece ser um cookies.txt do YouTube (formato Netscape inválido). Verifique se você exportou com a extensão \"Get cookies.txt LOCALLY\".".to_string()
        );
    }

    // Ensure at least one non-comment, tab-separated cookie line exists.
    let text = String::from_utf8_lossy(&content);
    let has_cookie_line = text.lines().any(|line| {
        let line = line.trim();
        !line.is_empty() && !line.starts_with('#') && line.contains('\t')
    });
    if !has_cookie_line {
        return Err(
            "O arquivo de cookies está vazio ou não contém cookies válidos. Faça login no YouTube e exporte novamente.".to_string()
        );
    }

    let dest = state.tools_dir.join("cookies.txt");
    std::fs::write(&dest, &content)
        .map_err(|e| format!("Falha ao salvar cookies: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn validate_cookies(
    state: State<'_, DownloadState>,
) -> Result<downloader::CookieValidation, String> {
    downloader::validate_cookies(&state.tools_dir).await
}
