use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadQuality {
    Best,
    High,
    Medium,
    Low,
    AudioOnly,
}

impl DownloadQuality {
    fn yt_dlp_format(&self) -> &str {
        match self {
            DownloadQuality::Best => "bestvideo+bestaudio/best",
            DownloadQuality::High => "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
            DownloadQuality::Medium => "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
            DownloadQuality::Low => "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
            DownloadQuality::AudioOnly => "bestaudio",
        }
    }

    pub fn is_audio_only(&self) -> bool {
        matches!(self, DownloadQuality::AudioOnly)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub download_id: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadResult {
    pub download_id: String,
    pub file_path: String,
    pub file_size: u64,
    pub media_type: String,
    pub file_extension: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadError {
    pub download_id: String,
    pub message: String,
    pub code: String,
}

#[derive(Debug)]
pub struct ActiveDownload {
    pub download_id: String,
    pub url: String,
    pub quality: DownloadQuality,
    pub process: Option<Child>,
    pub started_at: u64,
}

pub type ActiveDownloads = Arc<Mutex<HashMap<String, ActiveDownload>>>;

pub fn create_active_downloads() -> ActiveDownloads {
    Arc::new(Mutex::new(HashMap::new()))
}

fn ytdlp_path(tools_dir: &Path) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    tools_dir.join(name)
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("tools").join("downloads"))
}

fn video_media_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "Could not resolve executable directory".to_string())?;
    Ok(parent.join("lumen").join("files").join("media").join("video"))
}

fn audio_media_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "Could not resolve executable directory".to_string())?;
    Ok(parent.join("lumen").join("files").join("media").join("audio"))
}
pub async fn start_download(
    app: AppHandle,
    tools_dir: PathBuf,
    active_downloads: ActiveDownloads,
    url: String,
    provider: String,
    quality: DownloadQuality,
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

    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-check-certificates".to_string(),
        "--no-warnings".to_string(),
        "-f".to_string(),
        quality.yt_dlp_format().to_string(),
        "--merge-output-format".to_string(),
        "mp4".to_string(),
        "--newline".to_string(),
        "--progress".to_string(),
        "--restrict-filenames".to_string(),
        "--extractor-args".to_string(),
        "youtube:player_client=web_safari".to_string(),
        "-o".to_string(),
        output_template,
    ];

    if has_node {
        args.push("--js-runtimes".to_string());
        args.push(format!("node:{}", node_dir.to_string_lossy()));
    }

    let cookies_path = tools_dir.join("cookies.txt");
    let work_cookies_path = cookies_path.exists().then(|| work_cookies_copy(&cookies_path));
    if cookies_path.exists() {
        println!("[download] Using cookies file: {}", cookies_path.display());
        args.push("--cookies".to_string());
        args.push(
            work_cookies_path
                .as_deref()
                .unwrap_or(&cookies_path)
                .to_string_lossy()
                .to_string(),
        );
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
            "--extractor-args".to_string(),
            "youtube:player_client=web_safari".to_string(),
            "-o".to_string(),
            dl_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string(),
        ];
        if has_node {
            args.push("--js-runtimes".to_string());
            args.push(format!("node:{}", node_dir.to_string_lossy()));
        }
        if cookies_path.exists() {
            args.push("--cookies".to_string());
            args.push(
                work_cookies_path
                    .as_deref()
                    .unwrap_or(&cookies_path)
                    .to_string_lossy()
                    .to_string(),
            );
        }
        if !ffmpeg_location.is_empty() {
            args.push("--ffmpeg-location".to_string());
            args.push(ffmpeg_location);
        }
        args.push(url.clone());
    }

    let child = Command::new(&ytdlp)
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
