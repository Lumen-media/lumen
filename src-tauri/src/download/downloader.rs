//! `yt-dlp`-backed media downloading, progress reporting, and cookie
//! validation.
//!
//! Downloads are executed by spawning the `yt-dlp` binary provisioned in the
//! tools directory (see [`super::dependencies`]). A download is identified by
//! a UUID ([`ActiveDownload::download_id`]) and tracked in the shared
//! [`ActiveDownloads`] map so it can be inspected or cancelled while it runs.
//!
//! Lifecycle and events:
//!
//! 1. [`start_download`] validates prerequisites, spawns the process, records
//!    it in the map, and returns an initial [`DownloadResult`] immediately.
//! 2. A background task parses yt-dlp's stdout and emits
//!    `video-download-progress` ([`DownloadProgress`]) for each progress
//!    line.
//! 3. When the process exits, the file is moved from the temporary downloads
//!    directory to the user's media directory and either
//!    `video-download-complete` ([`DownloadResult`]) or `video-download-error`
//!    ([`DownloadError`]) is emitted. Auth-shaped yt-dlp failures are
//!    classified as `auth_required` with a cookies hint.
//! 4. [`cancel_download`] kills the process and removes the entry; cancelled
//!    jobs emit no completion event.
//!
//! Authentication comes either from a `cookies.txt` file installed through
//! `install_cookies_file` (copied to a temp file per run) or, when no file
//! exists, from the first logged-in browser detected by
//! [`detect_youtube_browser`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Configures a `Command` so no console window flashes on Windows.
fn hidden_tokio(mut cmd: Command) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Requested output quality for a video download.
///
/// Serialized to snake_case so the frontend sends `best`, `high`, `medium`,
/// `low`, or `audio_only`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadQuality {
    /// Best available video and audio streams.
    Best,
    /// Video capped at 1080p.
    High,
    /// Video capped at 720p.
    Medium,
    /// Video capped at 480p.
    Low,
    /// Audio-only extraction, converted to MP3.
    AudioOnly,
}

impl DownloadQuality {
    /// yt-dlp format selector corresponding to this quality.
    fn yt_dlp_format(&self) -> &str {
        match self {
            DownloadQuality::Best => "bestvideo+bestaudio/best",
            DownloadQuality::High => "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
            DownloadQuality::Medium => "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
            DownloadQuality::Low => "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
            DownloadQuality::AudioOnly => "bestaudio",
        }
    }

    /// Returns `true` when only audio should be extracted (MP3 output).
    pub fn is_audio_only(&self) -> bool {
        matches!(self, DownloadQuality::AudioOnly)
    }
}

/// Progress snapshot emitted as the `video-download-progress` event.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    /// Identifier of the download this progress belongs to.
    pub download_id: String,
    /// Completion fraction in `0.0..=1.0`.
    pub progress: f64,
    /// Transfer speed as reported by yt-dlp (for example `1.23MiB/s`).
    pub speed: String,
    /// Estimated time remaining as reported by yt-dlp (for example `00:42`).
    pub eta: String,
    /// Status string; currently always `"downloading"`.
    pub status: String,
}

/// Outcome of a download, returned by [`start_download`] and re-emitted as the
/// `video-download-complete` event with the final file information.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadResult {
    /// Identifier of the download job.
    pub download_id: String,
    /// Absolute path of the finished file. Empty in the immediate return
    /// value of [`start_download`]; filled in when emitted after completion.
    pub file_path: String,
    /// Size of the finished file in bytes (`0` until completion).
    pub file_size: u64,
    /// Media classification: `"video"` or `"audio"`.
    pub media_type: String,
    /// File extension including the leading dot (for example `.mp4`).
    pub file_extension: String,
}

/// Failure notification emitted as the `video-download-error` event.
#[derive(Debug, Clone, Serialize)]
pub struct DownloadError {
    /// Identifier of the failed download.
    pub download_id: String,
    /// Human-readable error message (may include a cookies hint).
    pub message: String,
    /// Machine-readable error class: `"download_failed"` or `"auth_required"`.
    pub code: String,
}

/// Bookkeeping for an in-flight download.
#[derive(Debug)]
pub struct ActiveDownload {
    /// Identifier of the download job.
    pub download_id: String,
    /// Source URL passed to yt-dlp.
    pub url: String,
    /// Requested output quality.
    pub quality: DownloadQuality,
    /// Handle to the spawned yt-dlp process, taken by the progress task.
    pub process: Option<Child>,
    /// Unix timestamp (seconds) when the download was started.
    pub started_at: u64,
}

/// Shared map of in-flight downloads keyed by `download_id`, held in Tauri
/// state as [`super::DownloadState::active_downloads`].
pub type ActiveDownloads = Arc<Mutex<HashMap<String, ActiveDownload>>>;

/// Browsers probed, in order, when looking for YouTube cookies.
const BROWSER_ORDER: &[&str] = &["chrome", "edge", "firefox", "brave", "chromium"];

/// Creates an empty shared [`ActiveDownloads`] map.
pub fn create_active_downloads() -> ActiveDownloads {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Path of the `yt-dlp` binary inside the tools directory.
fn ytdlp_path(tools_dir: &Path) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    tools_dir.join(name)
}

/// Temporary staging directory yt-dlp writes to before files are moved to the
/// user's media directory.
fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("tools").join("downloads"))
}

/// Resolved media directory for downloaded videos.
fn video_media_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::media_dir("video")
}

/// Resolved media directory for downloaded audio.
fn audio_media_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::media_dir("audio")
}

/// File caching the browser that yielded working YouTube cookies.
fn browser_cache_file(tools_dir: &Path) -> PathBuf {
    tools_dir.join("browser.txt")
}

/// Path of the provisioned `node` binary used for yt-dlp JS runtimes.
fn has_node_at(tools_dir: &Path) -> PathBuf {
    let node_dir = tools_dir.join("node");
    if cfg!(target_os = "windows") {
        node_dir.join("node.exe")
    } else {
        node_dir.join("node")
    }
}

/// Probes whether `browser` provides usable YouTube cookies by running
/// `yt-dlp --cookies-from-browser <browser> --skip-download` against a known
/// video with a 60 second timeout.
async fn probe_browser(ytdlp: &Path, node_path: Option<&Path>, browser: &str) -> bool {
    let mut args = vec![
        "--cookies-from-browser".to_string(),
        browser.to_string(),
        "--skip-download".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--print".to_string(),
        "%(id)s".to_string(),
    ];
    if let Some(node) = node_path {
        if let Some(dir) = node.parent() {
            args.push("--js-runtimes".to_string());
            args.push(format!("node:{}", dir.to_string_lossy()));
        }
    }
    args.push("https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string());

    let child = hidden_tokio(Command::new(ytdlp))
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(_) => return false,
    };

    match tokio::time::timeout(std::time::Duration::from_secs(60), child.wait()).await {
        Ok(Ok(status)) => status.success(),
        _ => {
            let _ = child.kill().await;
            false
        }
    }
}

/// Returns the browser name cached by [`detect_youtube_browser`], if any.
fn cached_browser(tools_dir: &Path) -> Option<String> {
    let cached = std::fs::read_to_string(browser_cache_file(tools_dir)).ok()?;
    let name = cached.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Finds a logged-in browser whose cookies work for YouTube.
///
/// Returns a cached result when available, otherwise probes each browser in
/// [`BROWSER_ORDER`] with yt-dlp and caches the first success. Returns `None`
/// when yt-dlp is not installed or no browser yields usable cookies.
pub async fn detect_youtube_browser(tools_dir: &Path) -> Option<String> {
    if let Some(cached) = cached_browser(tools_dir) {
        return Some(cached);
    }

    let ytdlp = ytdlp_path(tools_dir);
    if !ytdlp.exists() {
        return None;
    }

    let node_path = has_node_at(tools_dir);
    let node = node_path.exists().then_some(node_path.as_path());

    for browser in BROWSER_ORDER {
        if probe_browser(&ytdlp, node, browser).await {
            let _ = std::fs::write(browser_cache_file(tools_dir), browser);
            return Some(browser.to_string());
        }
    }
    None
}

/// Builds the yt-dlp authentication arguments: `--cookies <file>` when a
/// working copy exists, otherwise `--cookies-from-browser <browser>` when a
/// browser was detected, or nothing when neither is available.
fn auth_args(work_cookies: Option<&Path>, browser: &str) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(work) = work_cookies {
        args.push("--cookies".to_string());
        args.push(work.to_string_lossy().to_string());
    } else if !browser.is_empty() {
        args.push("--cookies-from-browser".to_string());
        args.push(browser.to_string());
    }
    args
}

/// Starts a `yt-dlp` download and returns immediately with a job id.
///
/// Only the `youtube` provider is supported. The function verifies yt-dlp is
/// installed, resolves FFmpeg (on macOS it must already be on `PATH`), builds
/// the format selector from `quality` (or `max_height` when set and not
/// audio-only), attaches authentication, spawns the process, records it in
/// `active_downloads`, and launches the background task that streams progress
/// and completion events.
///
/// The returned [`DownloadResult`] is a placeholder carrying the new
/// `download_id`; the real outcome is delivered through the
/// `video-download-progress`, `video-download-complete`, and
/// `video-download-error` events.
///
/// # Errors
///
/// Returns an error string when the provider is not `youtube`, `yt-dlp` is
/// missing, FFmpeg is missing on macOS, the downloads directory cannot be
/// created, or the process cannot be spawned.
pub async fn start_download(
    app: AppHandle,
    tools_dir: PathBuf,
    active_downloads: ActiveDownloads,
    url: String,
    provider: String,
    quality: DownloadQuality,
    max_height: Option<u32>,
) -> Result<DownloadResult, String> {
    if provider != "youtube" {
        return Err(format!("Unsupported provider: {}", provider));
    }

    let ytdlp = ytdlp_path(&tools_dir);
    if !ytdlp.exists() {
        return Err("yt-dlp not installed. Run download_dependencies first.".to_string());
    }

    let node_dir = tools_dir.join("node");
    let node_exe = node_dir.join("node.exe");
    let has_node = if cfg!(target_os = "windows") {
        node_exe.exists()
    } else {
        node_dir.join("node").exists()
    };

    let ffmpeg_location = if cfg!(target_os = "macos") {
        if std::process::Command::new("ffmpeg").arg("-version").output().is_ok() {
            String::new() // Let yt-dlp find it in PATH
        } else {
            return Err("ffmpeg not found. Install it via: brew install ffmpeg".to_string());
        }
    } else {
        tools_dir.to_string_lossy().to_string()
    };

    let download_id = uuid::Uuid::new_v4().to_string();
    let dl_dir = downloads_dir(&app)?;
    std::fs::create_dir_all(&dl_dir)
        .map_err(|e| format!("Failed to create downloads directory: {}", e))?;

    let output_template = dl_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string();

    let format_selector = match max_height {
        Some(h) if !quality.is_audio_only() => {
            format!("bestvideo[height<={}]+bestaudio/best[height<={}]/best", h, h)
        }
        _ => quality.yt_dlp_format().to_string(),
    };

    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-check-certificates".to_string(),
        "--no-warnings".to_string(),
        "-f".to_string(),
        format_selector,
        "--merge-output-format".to_string(),
        "mp4".to_string(),
        "--newline".to_string(),
        "--progress".to_string(),
        "--restrict-filenames".to_string(),
        "-o".to_string(),
        output_template,
    ];

    if has_node {
        args.push("--js-runtimes".to_string());
        args.push(format!("node:{}", node_dir.to_string_lossy()));
    }

    let cookies_path = tools_dir.join("cookies.txt");
    let work_cookies_path = cookies_path.exists().then(|| work_cookies_copy(&cookies_path));
    let mut browser = String::new();
    if !cookies_path.exists() {
        browser = detect_youtube_browser(&tools_dir).await.unwrap_or_default();
        if !browser.is_empty() {
            println!("[download] Using browser cookies from: {}", browser);
        }
    } else {
        println!("[download] Using cookies file: {}", cookies_path.display());
    }
    let auth = auth_args(work_cookies_path.as_deref(), &browser);
    for arg in &auth {
        args.push(arg.clone());
    }

    if !ffmpeg_location.is_empty() {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg_location.clone());
    }
    args.push(url.clone());

    if quality.is_audio_only() {
        args = vec![
            "--no-playlist".to_string(),
            "--no-check-certificates".to_string(),
            "--no-warnings".to_string(),
            "-f".to_string(),
            "bestaudio".to_string(),
            "--extract-audio".to_string(),
            "--audio-format".to_string(),
            "mp3".to_string(),
            "--newline".to_string(),
            "--progress".to_string(),
            "--restrict-filenames".to_string(),
            "-o".to_string(),
            dl_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string(),
        ];
        if has_node {
            args.push("--js-runtimes".to_string());
            args.push(format!("node:{}", node_dir.to_string_lossy()));
        }
        for arg in &auth {
            args.push(arg.clone());
        }
        if !ffmpeg_location.is_empty() {
            args.push("--ffmpeg-location".to_string());
            args.push(ffmpeg_location);
        }
        args.push(url.clone());
    }

    let child = hidden_tokio(Command::new(&ytdlp))
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

    println!("[download] yt-dlp spawned with PID: {:?}", child.id());

    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    {
        let mut downloads = active_downloads.lock().await;
        downloads.insert(
            download_id.clone(),
            ActiveDownload {
                download_id: download_id.clone(),
                url: url.clone(),
                quality: quality.clone(),
                process: Some(child),
                started_at,
            },
        );
        println!("[download] Download {} added to active_downloads", download_id);
    }

    let app_clone = app.clone();
    let dl_id_clone = download_id.clone();
    let active_clone = active_downloads.clone();
    let quality_clone = quality.clone();
    let dl_dir_clone = dl_dir.clone();
    let cookies_path_clone = cookies_path.clone();

    println!("[download] Starting download {} for URL: {}", download_id, url);

    tokio::spawn(async move {
        println!("[download] Background task started for {}", dl_id_clone);
        let stdout = {
            let mut downloads = active_clone.lock().await;
            if let Some(dl) = downloads.get_mut(&dl_id_clone) {
                println!("[download] Taking stdout for {}", dl_id_clone);
                dl.process.as_mut().and_then(|p| p.stdout.take())
            } else {
                println!("[download] Download {} not found in active_downloads", dl_id_clone);
                None
            }
        };

        let stderr = {
            let mut downloads = active_clone.lock().await;
            if let Some(dl) = downloads.get_mut(&dl_id_clone) {
                println!("[download] Taking stderr for {}", dl_id_clone);
                dl.process.as_mut().and_then(|p| p.stderr.take())
            } else {
                println!("[download] Download {} not found for stderr", dl_id_clone);
                None
            }
        };

        let stderr_handle = if let Some(mut stderr) = stderr {
            println!("[download] stderr take result is_some=true for {}", dl_id_clone);
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut bytes = Vec::new();
                match stderr.read_to_end(&mut bytes).await {
                    Ok(_) => String::from_utf8_lossy(&bytes).into_owned(),
                    Err(e) => format!("(stderr read failed: {})", e),
                }
            })
        } else {
            println!("[download] stderr take result is_some=false for {}", dl_id_clone);
            tokio::spawn(async { String::new() })
        };

        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(progress) = parse_progress(&line) {
                    app_clone
                        .emit(
                            "video-download-progress",
                            DownloadProgress {
                                download_id: dl_id_clone.clone(),
                                progress: progress.0,
                                speed: progress.1,
                                eta: progress.2,
                                status: "downloading".to_string(),
                            },
                        )
                        .ok();
                }
            }
        }

        let status = {
            let mut downloads = active_clone.lock().await;
            if let Some(dl) = downloads.get_mut(&dl_id_clone) {
                if let Some(ref mut process) = dl.process {
                    process.wait().await.map_err(|e| e.to_string())
                } else {
                    Err("Process not found".to_string())
                }
            } else {
                Err("Download not found".to_string())
            }
        };

        {
            let mut downloads = active_clone.lock().await;
            downloads.remove(&dl_id_clone);
        }

        match status {
            Ok(status) if status.success() => {
                println!("[download] Download {} completed successfully", dl_id_clone);
                match find_downloaded_file(&dl_dir_clone) {
                    Ok(downloaded_file) => {
                        println!("[download] Found downloaded file: {:?}", downloaded_file);
                        let media_type = if quality_clone.is_audio_only() {
                            "audio"
                        } else {
                            "video"
                        };

                        let dest_dir = if quality_clone.is_audio_only() {
                            audio_media_dir(&app_clone)
                        } else {
                            video_media_dir(&app_clone)
                        };

                        match dest_dir {
                            Ok(dest_dir) => {
                                let dest_dir_exists = std::fs::create_dir_all(&dest_dir).is_ok();
                                println!(
                                    "[download] media dest dir: {} (exists={})",
                                    dest_dir.display(),
                                    dest_dir_exists
                                );

                                let file_name = downloaded_file
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_else(|| "unknown".to_string());

                                let dest_path = dest_dir.join(&file_name);

                                if let Err(e) = std::fs::rename(&downloaded_file, &dest_path) {
                                    println!(
                                        "[download] FAILED to move file to {:?}: {}",
                                        dest_path, e
                                    );
                                    app_clone
                                        .emit(
                                            "video-download-error",
                                            DownloadError {
                                                download_id: dl_id_clone.clone(),
                                                message: format!(
                                                    "Download finished but failed to move file to media dir: {}",
                                                    e
                                                ),
                                                code: "download_failed".to_string(),
                                            },
                                        )
                                        .ok();
                                    return;
                                }
                                {
                                    let file_size = std::fs::metadata(&dest_path)
                                        .map(|m| m.len())
                                        .unwrap_or(0);

                                    let _ = std::fs::remove_dir_all(&dl_dir_clone);

                                    let file_ext = dest_path
                                        .extension()
                                        .map(|e| format!(".{}", e.to_string_lossy()))
                                        .unwrap_or_default();

                                    let result = DownloadResult {
                                        download_id: dl_id_clone.clone(),
                                        file_path: dest_path.to_string_lossy().to_string(),
                                        file_size,
                                        media_type: media_type.to_string(),
                                        file_extension: file_ext,
                                    };

                                    println!(
                                        "[download] Emitting video-download-complete for {} -> {}",
                                        dl_id_clone,
                                        result.file_path
                                    );
                                    app_clone.emit("video-download-complete", &result).ok();
                                }
                            }
                            Err(e) => {
                                app_clone
                                    .emit(
                                        "video-download-error",
                                        DownloadError {
                                            download_id: dl_id_clone.clone(),
                                            message: format!("Failed to get media directory: {}", e),
                                            code: "download_failed".to_string(),
                                        },
                                    )
                                    .ok();
                            }
                        }
                    }
                    Err(e) => {
                        app_clone
                            .emit(
                                "video-download-error",
                                DownloadError {
                                    download_id: dl_id_clone.clone(),
                                    message: format!("Failed to find downloaded file: {}", e),
                                    code: "download_failed".to_string(),
                                },
                            )
                            .ok();
                    }
                }
            }
            Ok(status) => {
                println!("[download] Download {} failed with status: {}", dl_id_clone, status);
                let stderr_output = stderr_handle.await.unwrap_or_default();
                let error_detail = stderr_output.clone();
                println!("[download] stderr read result bytes: {}", stderr_output.len());
                println!("[download] stderr output: {}", error_detail);

                let cookies_hint = if cookies_path_clone.exists() {
                    "".to_string()
                } else {
                    format!(
                        "\n\nPara desbloquear a qualidade, exporte os cookies logado no YouTube (extensão 'Get cookies.txt LOCALLY') e salve como:\n{}",
                        cookies_path_clone.display()
                    )
                };

                let error_message = if error_detail.contains("Sign in")
                    || error_detail.contains("not a bot")
                    || error_detail.contains("page needs to be reloaded")
                {
                    format!(
                        "YouTube está bloqueando a extração sem autenticação (provável exigência de PO token/cookies).{}",
                        cookies_hint
                    )
                } else if error_detail.contains("Video unavailable") {
                    "Video is unavailable or private".to_string()
                } else if error_detail.contains("ERROR:") {
                    error_detail
                        .lines()
                        .find(|l| l.contains("ERROR:"))
                        .unwrap_or("Unknown error")
                        .to_string()
                } else {
                    format!("yt-dlp exited with status: {}", status)
                };

                let error_code = if error_detail.contains("Sign in")
                    || error_detail.contains("not a bot")
                {
                    "auth_required".to_string()
                } else {
                    "download_failed".to_string()
                };

                app_clone
                    .emit(
                        "video-download-error",
                        DownloadError {
                            download_id: dl_id_clone.clone(),
                            message: error_message,
                            code: error_code,
                        },
                    )
                    .ok();
            }
            Err(e) => {
                println!("[download] Download {} error: {}", dl_id_clone, e);
                app_clone
                    .emit(
                        "video-download-error",
                        DownloadError {
                            download_id: dl_id_clone.clone(),
                            message: format!("Download failed: {}", e),
                            code: "download_failed".to_string(),
                        },
                    )
                    .ok();
            }
        }
    });

    println!("[download] Returning download_id: {}", download_id);
    Ok(DownloadResult {
        download_id,
        file_path: String::new(),
        file_size: 0,
        media_type: if quality.is_audio_only() {
            "audio".to_string()
        } else {
            "video".to_string()
        },
        file_extension: String::new(),
    })
}

/// Cancels an in-flight download by killing its process and removing it from
/// the active map.
///
/// Returns `Ok(())` even when `download_id` is unknown. Cancelled jobs do not
/// emit a completion or error event.
///
/// # Errors
///
/// Returns an error string only when the process exists but cannot be killed.
pub async fn cancel_download(
    active_downloads: &ActiveDownloads,
    download_id: &str,
) -> Result<(), String> {
    let mut downloads = active_downloads.lock().await;
    if let Some(mut dl) = downloads.remove(download_id) {
        if let Some(ref mut process) = dl.process {
            process
                .kill()
                .await
                .map_err(|e| format!("Failed to kill process: {}", e))?;
        }
    }
    Ok(())
}

/// Result of [`validate_cookies`], surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
pub struct CookieValidation {
    /// One of `valid`, `missing`, `error`, `rotated`, `blocked`, or
    /// `no_account`.
    pub status: String,
    /// Human-readable explanation (in Portuguese) suitable for display.
    pub detail: String,
}

/// Checks whether YouTube authentication is currently usable.
///
/// When no `cookies.txt` exists in `tools_dir`, attempts to detect a logged-in
/// browser with [`detect_youtube_browser`]: a detection reports `valid`,
/// otherwise `missing`. With a cookies file present, yt-dlp is run in
/// `--skip-download` mode with a 90 second timeout and the output is
/// classified as `rotated` (cookies revoked), `blocked` (PO token / bot
/// check), `no_account` (logged-out cookies), or `valid` (account name
/// printed). A timeout reports `error` without failing.
///
/// # Errors
///
/// Returns an error string when `yt-dlp` is not installed or cannot be spawned
/// or awaited.
pub async fn validate_cookies(tools_dir: &Path) -> Result<CookieValidation, String> {
    let cookies_path = tools_dir.join("cookies.txt");
    if !cookies_path.exists() {
        let browser = detect_youtube_browser(tools_dir).await.unwrap_or_default();
        if !browser.is_empty() {
            return Ok(CookieValidation {
                status: "valid".to_string(),
                detail: format!("Usando cookies do navegador logado ({}).", browser),
            });
        }
        return Ok(CookieValidation {
            status: "missing".to_string(),
            detail: "Nenhum arquivo de cookies e nenhum navegador logado detectado. Instale cookies ou faça login no navegador.".to_string(),
        });
    }

    let ytdlp = ytdlp_path(tools_dir);
    if !ytdlp.exists() {
        return Err("yt-dlp not installed. Run download_dependencies first.".to_string());
    }

    let node_dir = tools_dir.join("node");
    let node_exe = node_dir.join("node.exe");
    let has_node = if cfg!(target_os = "windows") {
        node_exe.exists()
    } else {
        node_dir.join("node").exists()
    };

    let mut args = vec![
        "--cookies".to_string(),
        cookies_path.to_string_lossy().to_string(),
        "--skip-download".to_string(),
        "--no-playlist".to_string(),
        "--print".to_string(),
        "%(account)s".to_string(),
    ];
    if has_node {
        args.push("--js-runtimes".to_string());
        args.push(format!("node:{}", node_dir.to_string_lossy()));
    }
    args.push("https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string());

    let mut child = hidden_tokio(Command::new(&ytdlp))
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp for cookie validation: {}", e))?;

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut bytes = Vec::new();
        if let Some(stdout) = stdout.as_mut() {
            let _ = stdout.read_to_end(&mut bytes).await;
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });

    let stderr_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut bytes = Vec::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_end(&mut bytes).await;
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });

    let wait = tokio::time::timeout(std::time::Duration::from_secs(90), child.wait()).await;
    match wait {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => {
            let _ = child.kill().await;
            return Err(format!("Failed to wait for yt-dlp validation: {}", e));
        }
        Err(_) => {
            let _ = child.kill().await;
            return Ok(CookieValidation {
                status: "error".to_string(),
                detail: "Validação de cookies excedeu o tempo limite.".to_string(),
            });
        }
    }

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();
    let combined_lower = format!("{}\n{}", stdout, stderr).to_lowercase();

    if combined_lower.contains("cookies are no longer valid")
        || combined_lower.contains("have been rotated")
    {
        return Ok(CookieValidation {
            status: "rotated".to_string(),
            detail: "Os cookies foram rotacionados/revogados pelo Google. Re-exporte do navegador logado.".to_string(),
        });
    }

    if combined_lower.contains("sign in to confirm")
        || combined_lower.contains("not a bot")
    {
        return Ok(CookieValidation {
            status: "blocked".to_string(),
            detail: "YouTube está exigindo confirmação de conta (PO token). Re-exporte cookies de uma sessão logada.".to_string(),
        });
    }

    let account = stdout.trim();
    if account.is_empty() || account.eq_ignore_ascii_case("NA") {
        return Ok(CookieValidation {
            status: "no_account".to_string(),
            detail: "Nenhuma conta logada detectada. Os cookies parecem de sessão deslogada ou expirados.".to_string(),
        });
    }

    Ok(CookieValidation {
        status: "valid".to_string(),
        detail: format!("Cookies válidos (conta: {}).", account),
    })
}

/// Copies the cookies file to a uniquely named temporary file used by a single
/// download run, so concurrent runs do not contend over the same file.
///
/// The file name is derived from a hash of the source stem. On copy failure
/// the original path is returned so the download still has valid cookies.
fn work_cookies_copy(cookies_path: &std::path::Path) -> PathBuf {
    let name = format!(
        "cookies_work_{}.txt",
        cookies_path
            .extension()
            .and_then(|_| cookies_path.file_stem())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "cookies".to_string())
            .chars()
            .map(|c| c as u32)
            .enumerate()
            .map(|(i, c)| c.wrapping_mul(31).wrapping_add(i as u32) % 1000000)
            .fold(0u64, |acc, x| acc.wrapping_add(x as u64))
    );

    let dest = std::env::temp_dir().join(format!("lumen_{}", name));
    match std::fs::copy(cookies_path, &dest) {
        Ok(_) => dest,
        Err(_) => cookies_path.to_path_buf(),
    }
}

/// Parses a yt-dlp `[download] ... %` progress line into
/// `(fraction, speed, eta)`.
///
/// Returns `None` for any line that is not a download progress line.
fn parse_progress(line: &str) -> Option<(f64, String, String)> {
    if !line.contains("[download]") || !line.contains("%") {
        return None;
    }

    let percent_str = line
        .split_whitespace()
        .find(|s| s.ends_with('%'))?
        .trim_end_matches('%');

    let percent: f64 = percent_str.parse().ok()?;

    let speed = line
        .split("at ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("")
        .to_string();

    let eta = line
        .split("ETA ")
        .nth(1)
        .unwrap_or("")
        .trim()
        .to_string();

    Some((percent / 100.0, speed, eta))
}

/// Returns the most recently modified file in `dir`, ignoring yt-dlp
/// intermediate artifacts (`.part`, `.ytdl`, `.temp`, hidden files).
///
/// # Errors
///
/// Returns an error string when `dir` cannot be read or contains no candidate
/// file.
fn find_downloaded_file(dir: &Path) -> Result<PathBuf, String> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read downloads directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !name.ends_with(".part")
                && !name.ends_with(".ytdl")
                && !name.ends_with(".temp")
                && !name.starts_with(".")
        })
        .collect();

    entries
        .into_iter()
        .max_by_key(|e| {
            e.metadata()
                .and_then(|m| Ok(m.modified().ok()))
                .ok()
                .flatten()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        })
        .map(|e| e.path())
        .ok_or_else(|| "No downloaded file found".to_string())
}
