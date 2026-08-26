use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::github;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub version: String,
    pub path: String,
    pub downloaded_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolVersions {
    pub ytdlp: Option<ToolInfo>,
    pub ffmpeg: Option<ToolInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatus {
    pub ytdlp_installed: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_version: Option<String>,
    pub tools_dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyInfo {
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub platform: String,
}

fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("tools"))
}

fn versions_path(tools_dir: &Path) -> PathBuf {
    tools_dir.join("versions.json")
}

fn ytdlp_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

fn ffprobe_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

pub fn load_versions(tools_dir: &Path) -> ToolVersions {
    let path = versions_path(tools_dir);
    if !path.exists() {
        return ToolVersions {
            ytdlp: None,
            ffmpeg: None,
        };
    }
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or(ToolVersions {
        ytdlp: None,
        ffmpeg: None,
    })
}

pub fn save_versions(tools_dir: &Path, versions: &ToolVersions) -> Result<(), String> {
    let path = versions_path(tools_dir);
    let data = serde_json::to_string_pretty(versions).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to save versions.json: {}", e))
}

pub fn check_dependencies(app: &AppHandle) -> Result<DependencyStatus, String> {
    let dir = tools_dir(app)?;
    let versions = load_versions(&dir);

    let ytdlp_path = dir.join(ytdlp_binary_name());
    let ffmpeg_path = dir.join(ffmpeg_binary_name());

    let ytdlp_installed = ytdlp_path.exists();
    let ffmpeg_installed = ffmpeg_path.exists();

    Ok(DependencyStatus {
        ytdlp_installed,
        ytdlp_version: if ytdlp_installed {
            versions.ytdlp.as_ref().map(|v| v.version.clone())
        } else {
            None
        },
        ffmpeg_installed,
        ffmpeg_version: if ffmpeg_installed {
            versions.ffmpeg.as_ref().map(|v| v.version.clone())
        } else {
            None
        },
        tools_dir: dir.to_string_lossy().to_string(),
    })
}

pub fn list_dependencies(app: &AppHandle) -> Result<Vec<DependencyInfo>, String> {
    let dir = tools_dir(app)?;
    let versions = load_versions(&dir);
    let platform = super::github::platform_key().to_string();

    let ytdlp_path = dir.join(ytdlp_binary_name());
    let ffmpeg_path = dir.join(ffmpeg_binary_name());

    Ok(vec![
        DependencyInfo {
            name: "yt-dlp".to_string(),
            installed: ytdlp_path.exists(),
            version: versions.ytdlp.as_ref().map(|v| v.version.clone()),
            path: if ytdlp_path.exists() {
                Some(ytdlp_path.to_string_lossy().to_string())
            } else {
                None
            },
            platform: platform.clone(),
        },
        DependencyInfo {
            name: "ffmpeg".to_string(),
            installed: ffmpeg_path.exists(),
            version: versions.ffmpeg.as_ref().map(|v| v.version.clone()),
            path: if ffmpeg_path.exists() {
                Some(ffmpeg_path.to_string_lossy().to_string())
            } else {
                None
            },
            platform,
        },
    ])
}

pub async fn download_dependencies(app: AppHandle) -> Result<(), String> {
    let dir = tools_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create tools directory: {}", e))?;

    let downloads_dir = dir.join("downloads");
    std::fs::create_dir_all(&downloads_dir)
        .map_err(|e| format!("Failed to create downloads directory: {}", e))?;

    let mut versions = load_versions(&dir);

    // Download yt-dlp
    if !dir.join(ytdlp_binary_name()).exists() {
        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "ytdlp",
            "progress": 0.0,
            "status": "fetching_release"
        }))
        .ok();

        let release = github::fetch_latest_ytdlp().await?;

        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "ytdlp",
            "progress": 0.1,
            "status": "downloading"
        }))
        .ok();

        let dest_path = downloads_dir.join(&release.file_name);
        download_file(&release.download_url, &dest_path, &app, "ytdlp").await?;

        // Move to final location
        let final_path = dir.join(ytdlp_binary_name());
        std::fs::rename(&dest_path, &final_path)
            .map_err(|e| format!("Failed to move yt-dlp binary: {}", e))?;

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&final_path, std::fs::Permissions::from_mode(0o755));
        }

        versions.ytdlp = Some(ToolInfo {
            version: release.version,
            path: final_path.to_string_lossy().to_string(),
            downloaded_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
        save_versions(&dir, &versions)?;

        app.emit("dependency-download-complete", serde_json::json!({
            "tool": "ytdlp",
            "version": versions.ytdlp.as_ref().unwrap().version
        }))
        .ok();
    }

    // Download FFmpeg (not available on macOS from BtbN)
    if !dir.join(ffmpeg_binary_name()).exists() {
        // Check if FFmpeg is available for this platform
        let platform = super::github::platform_key();
        if platform.starts_with("macos") {
            println!("[ffmpeg] macOS detected - FFmpeg must be installed manually (e.g., via Homebrew: brew install ffmpeg)");
            // Don't fail, just skip - user can install manually
        } else {
            app.emit("dependency-download-progress", serde_json::json!({
                "tool": "ffmpeg",
                "progress": 0.0,
                "status": "fetching_release"
            }))
            .ok();

            let release = github::fetch_latest_ffmpeg().await?;

            app.emit("dependency-download-progress", serde_json::json!({
                "tool": "ffmpeg",
                "progress": 0.1,
                "status": "downloading"
            }))
            .ok();

            let dest_path = downloads_dir.join(&release.file_name);
            download_file(&release.download_url, &dest_path, &app, "ffmpeg").await?;

        // Extract zip
        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "ffmpeg",
            "progress": 0.9,
            "status": "extracting"
        }))
        .ok();

        extract_ffmpeg_zip(&dest_path, &dir)?;

        // Clean up zip
        let _ = std::fs::remove_file(&dest_path);

        versions.ffmpeg = Some(ToolInfo {
            version: release.version,
            path: dir.join(ffmpeg_binary_name()).to_string_lossy().to_string(),
            downloaded_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
        save_versions(&dir, &versions)?;

        app.emit("dependency-download-complete", serde_json::json!({
            "tool": "ffmpeg",
            "version": versions.ffmpeg.as_ref().unwrap().version
        }))
        .ok();
        } // end else (not macOS)
    }

    // Clean up downloads directory
    let _ = std::fs::remove_dir_all(&downloads_dir);

    Ok(())
}

async fn download_file(
    url: &str,
    dest: &Path,
    app: &AppHandle,
    tool_name: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("User-Agent", "lumen-app")
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {}", tool_name, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed for {}: HTTP {}",
            tool_name,
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create file for {}: {}", tool_name, e))?;

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    use std::io::Write;

    while let Some(chunk) = stream.next().await {
        let chunk: bytes::Bytes = chunk.map_err(|e| format!("Download stream error for {}: {}", tool_name, e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write {}: {}", tool_name, e))?;

        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = downloaded as f64 / total_size as f64;
            app.emit(
                "dependency-download-progress",
                serde_json::json!({
                    "tool": tool_name,
                    "progress": progress,
                    "bytes_downloaded": downloaded,
                    "total_bytes": total_size,
                    "status": "downloading"
                }),
            )
            .ok();
        }
    }

    Ok(())
}

fn extract_ffmpeg_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let zip_file =
        std::fs::File::open(zip_path).map_err(|e| format!("Failed to open ffmpeg zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to read ffmpeg zip: {}", e))?;

    let bin_name = ffmpeg_binary_name();
    let probe_name = ffprobe_binary_name();

    println!("[ffmpeg] Extracting zip to {:?}", dest_dir);

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let name = file.name().to_string();
        println!("[ffmpeg] Checking entry: {}", name);

        // Look for ffmpeg.exe and ffprobe.exe in any subdirectory
        if name.ends_with(&format!("/{}", bin_name)) || name.ends_with(&format!("\\{}", bin_name)) 
            || name == bin_name || name.ends_with(&format!("/{}", probe_name)) 
            || name.ends_with(&format!("\\{}", probe_name)) || name == probe_name {
            
            let out_name = if name.contains("ffprobe") { &probe_name } else { &bin_name };
            let out_path = dest_dir.join(out_name);

            println!("[ffmpeg] Extracting {} to {:?}", name, out_path);

            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create {}: {}", name, e))?;
            std::io::copy(&mut file, &mut out_file)
                .map_err(|e| format!("Failed to extract {}: {}", name, e))?;

            let file_size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
            println!("[ffmpeg] Extracted {} ({} bytes)", out_name, file_size);

            // Make executable on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755));
            }
        }
    }

    // Verify extraction
    let ffmpeg_path = dest_dir.join(&bin_name);
    if !ffmpeg_path.exists() {
        return Err("Failed to extract ffmpeg binary from zip".to_string());
    }
    let ffmpeg_size = std::fs::metadata(&ffmpeg_path).map(|m| m.len()).unwrap_or(0);
    println!("[ffmpeg] Verification: {:?} exists, size: {} bytes", ffmpeg_path, ffmpeg_size);

    Ok(())
}
