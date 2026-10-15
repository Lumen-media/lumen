//! Media download subsystem: external tool provisioning, video downloads, and
//! YouTube cookie management.
//!
//! Three concerns live behind this module, each in its own submodule:
//!
//! - [`dependencies`] - detects, downloads, and versions the external tools
//!   (`yt-dlp`, `ffmpeg`/`ffprobe`, `node`) under `<app-data>/tools`.
//! - [`downloader`] - spawns `yt-dlp` to download videos/audio, streams
//!   progress events, and manages cancellation and cookie validation.
//! - [`github`] - resolves release asset URLs from GitHub/Node.js endpoints.
//!
//! [`DownloadState`] is created once during app setup with
//! [`initialize_download_state`] and registered with Tauri's state manager so
//! every command below can reach the shared tools directory and the set of
//! active downloads.
//!
//! # Frontend commands
//!
//! | Command | Invoke name | Returns / Events |
//! |---|---|---|
//! | [`check_dependencies`] | `check_dependencies` | [`DependencyStatus`] |
//! | [`download_dependencies`] | `download_dependencies` | emits `dependency-download-progress` / `dependency-download-complete` |
//! | [`list_dependencies`] | `list_dependencies` | `DependencyInfo[]` |
//! | [`download_video`] | `download_video` | initial [`DownloadResult`] plus `video-download-progress` / `video-download-complete` / `video-download-error` events (see [`downloader::start_download`]) |
//! | [`cancel_download`] | `cancel_download` | kills the underlying `yt-dlp` process |
//! | [`get_download_status`] | `get_download_status` | [`DownloadStatusInfo`] or `null` |
//! | [`install_cookies_file`] | `install_cookies_file` | installed path as `string` |
//! | [`validate_cookies`] | `validate_cookies` | [`downloader::CookieValidation`] |

pub mod dependencies;
pub mod downloader;
pub mod github;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use dependencies::{DependencyInfo, DependencyStatus};
use downloader::{DownloadQuality, DownloadResult};

/// Shared, Tauri-managed state for the download subsystem.
///
/// Holds the directory where downloaded tools live and the map of in-flight
/// downloads that commands mutate through a locked handle ([`downloader::ActiveDownloads`]).
#[derive(Clone)]
pub struct DownloadState {
    /// Directory containing the provisioned tools (`yt-dlp`, `ffmpeg`,
    /// `node/`, `cookies.txt`). Usually `<app-data>/tools`.
    pub tools_dir: PathBuf,
    /// In-flight downloads keyed by download id, shared with the background
    /// progress tasks spawned by [`download_video`].
    pub active_downloads: downloader::ActiveDownloads,
}

/// Lightweight snapshot of a download's state returned by
/// [`get_download_status`].
#[derive(Debug, Clone, Serialize)]
pub struct DownloadStatusInfo {
    /// Current status string; currently always `"downloading"` when the
    /// download is present in the active map.
    pub status: String,
    /// Completion fraction in `0.0..=1.0`, or `None` when unknown. Progress is
    /// pushed through the `video-download-progress` event instead.
    pub progress: Option<f64>,
}

/// Resolves the tools directory from the app data path.
fn tools_dir_from_app(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("tools"))
}

/// Creates the tools directory and the [`DownloadState`] it depends on.
///
/// Called once during app setup; the returned value is registered with
/// `app.manage(...)` so the Tauri commands can request it via
/// `State<DownloadState>`.
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved or
/// the tools directory cannot be created.
pub fn initialize_download_state(app: &AppHandle) -> Result<DownloadState, String> {
    let dir = tools_dir_from_app(app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create tools directory: {}", e))?;

    Ok(DownloadState {
        tools_dir: dir,
        active_downloads: downloader::create_active_downloads(),
    })
}

/// Reports which external dependencies are installed and whether `yt-dlp` is
/// outdated.
///
/// # Tauri command (frontend API)
///
/// `invoke('check_dependencies')` resolves with a [`DependencyStatus`]
/// describing `yt-dlp`, `ffmpeg`, cookies, and `node`, plus the resolved tools
/// directory. When `yt-dlp` is installed the latest GitHub release is fetched
/// to compute `ytdlp_outdated`; network failures there are ignored and simply
/// leave the flag `false`.
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved.
#[tauri::command]
pub async fn check_dependencies(
    _state: State<'_, DownloadState>,
    app: AppHandle,
) -> Result<DependencyStatus, String> {
    dependencies::check_dependencies(&app).await
}

/// Downloads or updates the external tools, emitting progress events.
///
/// # Tauri command (frontend API)
///
/// `invoke('download_dependencies')` resolves once provisioning finishes (or
/// fails). Progress is reported through the `dependency-download-progress`
/// event (`{ tool, progress, status, bytes_downloaded?, total_bytes? }`) and
/// completion through `dependency-download-complete` (`{ tool, version }`).
///
/// `ffmpeg` and `node` are only downloaded when missing; `yt-dlp` is updated
/// whenever the installed version differs from the latest release. On macOS
/// the FFmpeg download is skipped and FFmpeg must be installed manually.
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved, a
/// release cannot be fetched, a download fails, or an archive cannot be
/// extracted.
#[tauri::command]
pub async fn download_dependencies(app: AppHandle) -> Result<(), String> {
    dependencies::download_dependencies(app).await
}

/// Lists the known external tools with their install state, version, path, and
/// platform key.
///
/// # Tauri command (frontend API)
///
/// `invoke('list_dependencies')` resolves with a [`DependencyInfo`] array
/// (currently `yt-dlp` and `ffmpeg`).
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved.
#[tauri::command]
pub async fn list_dependencies(app: AppHandle) -> Result<Vec<DependencyInfo>, String> {
    dependencies::list_dependencies(&app)
}

/// Starts a `yt-dlp` download for `url` and returns immediately.
///
/// # Tauri command (frontend API)
///
/// `invoke('download_video', { url, provider, quality, maxHeight? })` returns
/// a [`DownloadResult`] whose `download_id` identifies the job; the other
/// fields are placeholders (`file_path`/`file_extension` empty, `file_size`
/// `0`) until the download completes. The real outcome arrives through events:
///
/// - `video-download-progress` - `{ download_id, progress, speed, eta, status }`
/// - `video-download-complete` - the finished [`DownloadResult`]
/// - `video-download-error` - `{ download_id, message, code }`
///
/// # Errors
///
/// Returns an error string when the provider is not `youtube`, `yt-dlp` is not
/// installed, FFmpeg is missing on macOS, or the downloads directory cannot be
/// created or the process cannot be spawned. Behaviour is otherwise delegated
/// to [`downloader::start_download`].
#[tauri::command]
pub async fn download_video(
    state: State<'_, DownloadState>,
    app: AppHandle,
    url: String,
    provider: String,
    quality: DownloadQuality,
    max_height: Option<u32>,
) -> Result<DownloadResult, String> {
    downloader::start_download(
        app,
        state.tools_dir.clone(),
        state.active_downloads.clone(),
        url,
        provider,
        quality,
        max_height,
    )
    .await
}

/// Cancels an in-flight download by killing its `yt-dlp` process.
///
/// # Tauri command (frontend API)
///
/// `invoke('cancel_download', { downloadId })` removes the download from the
/// active map and terminates the process. Resolves even when the id is
/// unknown; no completion/error event is emitted for a cancelled job.
///
/// # Errors
///
/// Returns an error string only when the process exists but cannot be killed.
#[tauri::command]
pub async fn cancel_download(
    state: State<'_, DownloadState>,
    download_id: String,
) -> Result<(), String> {
    downloader::cancel_download(&state.active_downloads, &download_id).await
}

/// Returns whether a download id is currently active.
///
/// # Tauri command (frontend API)
///
/// `invoke('get_download_status', { downloadId })` resolves with
/// [`DownloadStatusInfo`] while the job is running or `null` once it has
/// finished or been cancelled. Detailed progress is only available through the
/// `video-download-progress` event.
///
/// # Errors
///
/// Currently never fails, but returns a `Result` to match the Tauri command
/// boundary.
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

/// Installs a user-provided Netscape-format `cookies.txt` into the tools
/// directory.
///
/// # Tauri command (frontend API)
///
/// `invoke('install_cookies_file', { sourcePath })` validates the file is a
/// Netscape cookie jar (correct header and at least one tab-separated cookie
/// line) and copies it to `<tools-dir>/cookies.txt`, which `yt-dlp` then uses
/// for YouTube authentication. Resolves with the destination path.
///
/// The file is expected to come from the "Get cookies.txt LOCALLY" browser
/// extension with the user logged in to YouTube.
///
/// # Errors
///
/// Returns an error string when the source path does not exist, the file
/// cannot be read or written, or the content does not look like a valid
/// Netscape cookie file.
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

/// Validates the installed cookies (or a detected logged-in browser) against
/// YouTube.
///
/// # Tauri command (frontend API)
///
/// `invoke('validate_cookies')` resolves with a
/// [`downloader::CookieValidation`] whose `status` is one of `valid`,
/// `missing`, `error`, `rotated`, `blocked`, or `no_account`, with a
/// human-readable `detail`. When no `cookies.txt` exists this also tries to
/// detect cookies from a logged-in browser.
///
/// # Errors
///
/// Returns an error string when `yt-dlp` is not installed or the validation
/// process cannot be spawned.
#[tauri::command]
pub async fn validate_cookies(
    state: State<'_, DownloadState>,
) -> Result<downloader::CookieValidation, String> {
    downloader::validate_cookies(&state.tools_dir).await
}
