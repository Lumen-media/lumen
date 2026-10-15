//! Dependency provisioning: manages external tools under the app's tools
//! directory.
//!
//! The state (installed versions and paths) is persisted as `versions.json` in
//! `<tools-dir>`. Three tools are provisioned on demand:
//!
//! - `yt-dlp` - downloaded from the nightly GitHub releases; updated whenever
//!   the installed version differs from the latest release.
//! - `ffmpeg`/`ffprobe` - extracted from BtbN GitHub release ZIPs on Windows
//!   and Linux. On macOS this module does not download FFmpeg (the
//!   dependencies install step skips it and expects `ffmpeg` on PATH).
//! - `node` - downloaded as a Windows x64 ZIP from `nodejs.org/dist/index.json`
//!   (picks the latest LTS, falling back to the newest release overall).
//!
//! Progress/completion notifications are emitted through the Tauri event
//! system: `dependency-download-progress` and `dependency-download-complete`.
//! These events are consumed by the frontend UI.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::github;

/// Information about a single installed tool (version and location).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    /// Release version string stored at install time.
    pub version: String,
    /// Absolute path to the tool binary (or directory for multi-file tools).
    pub path: String,
    /// Unix timestamp (seconds) when the tool was downloaded/installed.
    pub downloaded_at: u64,
}

/// Installed tool versions persisted to `versions.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ToolVersions {
    /// Information about the installed `yt-dlp`.
    pub ytdlp: Option<ToolInfo>,
    /// Information about the installed `ffmpeg`/`ffprobe`.
    pub ffmpeg: Option<ToolInfo>,
    /// Information about the installed `node` runtime.
    pub node: Option<ToolInfo>,
}

/// Current status of the external dependencies (used by the frontend UI).
#[derive(Debug, Clone, Serialize)]
pub struct DependencyStatus {
    /// Whether `yt-dlp` is present in the tools directory.
    pub ytdlp_installed: bool,
    /// Installed version string, or `None` if not installed.
    pub ytdlp_version: Option<String>,
    /// `true` when `yt-dlp` is installed but the latest release tag differs.
    pub ytdlp_outdated: bool,
    /// Whether `ffmpeg` is present in the tools directory.
    pub ffmpeg_installed: bool,
    /// Installed version string, or `None` if not installed.
    pub ffmpeg_version: Option<String>,
    /// Whether `cookies.txt` is present in the tools directory.
    pub cookies_installed: bool,
    /// Whether the `node` runtime is present.
    pub node_installed: bool,
    /// Path to the `node` directory, or `None` if not installed.
    pub node_dir: Option<String>,
    /// Absolute path of the tools directory.
    pub tools_dir: String,
}

/// Description of a single tool returned by [`list_dependencies`].
#[derive(Debug, Clone, Serialize)]
pub struct DependencyInfo {
    /// Tool name (`yt-dlp` or `ffmpeg`).
    pub name: String,
    /// Whether the tool is currently installed.
    pub installed: bool,
    /// Installed version string, or `None` if not installed.
    pub version: Option<String>,
    /// Absolute path to the tool binary, or `None` if not installed.
    pub path: Option<String>,
    /// Platform key string (`win_x64`, `linux_x64`, etc.).
    pub platform: String,
}

/// Resolves the tools directory from the app data path.
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved.
fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("tools"))
}

/// Returns the path to the persisted `versions.json` file.
fn versions_path(tools_dir: &Path) -> PathBuf {
    tools_dir.join("versions.json")
}

/// Platform-specific name of the `yt-dlp` binary.
fn ytdlp_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Platform-specific name of the `ffmpeg` binary.
fn ffmpeg_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

/// Platform-specific name of the `ffprobe` binary.
fn ffprobe_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

/// Loads `versions.json` into a [`ToolVersions`] struct, returning defaults
/// if the file does not exist or cannot be parsed.
fn load_versions(tools_dir: &Path) -> ToolVersions {
    let path = versions_path(tools_dir);
    if !path.exists() {
        return ToolVersions {
            ytdlp: None,
            ffmpeg: None,
            node: None,
        };
    }
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or(ToolVersions {
        ytdlp: None,
        ffmpeg: None,
        node: None,
    })
}

/// Persists `versions` to `versions.json`.
///
/// # Errors
///
/// Returns an error string when serialization or writing to disk fails.
pub fn save_versions(tools_dir: &Path, versions: &ToolVersions) -> Result<(), String> {
    let path = versions_path(tools_dir);
    let data = serde_json::to_string_pretty(versions).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to save versions.json: {}", e))
}

/// Reports which dependencies are installed and whether `yt-dlp` is outdated.
///
/// When `yt-dlp` is installed this fetches the latest release from GitHub to
/// set `ytdlp_outdated`; network failures are ignored and the flag remains
/// `false` in that case.
///
/// # Errors
///
/// Returns an error string when the tools directory cannot be resolved.
pub async fn check_dependencies(app: &AppHandle) -> Result<DependencyStatus, String> {
    let dir = tools_dir(app)?;
    let versions = load_versions(&dir);

    let ytdlp_path = dir.join(ytdlp_binary_name());
    let ffmpeg_path = dir.join(ffmpeg_binary_name());

    let ytdlp_installed = ytdlp_path.exists();
    let cookies_installed = dir.join("cookies.txt").exists();
    let node_dir = dir.join("node");
    let node_path = node_dir.join("node.exe");
    let node_installed = node_path.exists();

    let mut ytdlp_outdated = false;
    if ytdlp_installed {
        if let Ok(latest) = github::fetch_latest_ytdlp().await {
            let installed_version = versions.ytdlp.as_ref().map(|v| v.version.as_str());
            ytdlp_outdated = installed_version != Some(latest.version.as_str());
        }
    }

    Ok(DependencyStatus {
        ytdlp_installed,
        ytdlp_version: if ytdlp_installed {
            versions.ytdlp.as_ref().map(|v| v.version.clone())
        } else {
            None
        },
        ytdlp_outdated,
        ffmpeg_installed: ffmpeg_path.exists(),
        ffmpeg_version: if ffmpeg_path.exists() {
            versions.ffmpeg.as_ref().map(|v| v.version.clone())
        } else {
            None
        },
        cookies_installed,
        node_installed,
        node_dir: if node_installed {
            Some(node_dir.to_string_lossy().to_string())
        } else {
            None
        },
        tools_dir: dir.to_string_lossy().to_string(),
    })
}

/// Lists installed tools with metadata.
///
/// Returns a vector with entries for `yt-dlp` and `ffmpeg` (their install
/// state, version, path, and platform key). `node` is tracked in
/// `versions.json` but not listed here.
///
/// # Errors
///
/// Returns an error string when the tools directory cannot be resolved.
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

/// Downloads or updates all external tools as needed.
///
/// Emits `dependency-download-progress` and `dependency-download-complete`
/// events on the Tauri app for each step:
///
/// - `yt-dlp`: updated only if missing or version differs from latest release
/// - `ffmpeg`/`ffprobe`: downloaded and extracted on Windows/Linux when missing
///   (skipped entirely on macOS)
/// - `node`: downloaded and extracted when missing
///
/// On success the temporary `downloads` staging directory is removed.
///
/// # Errors
///
/// Returns an error string when any step fails (cannot create directories,
/// fetch a release, download a file, extract an archive, move files, or
/// persist versions); in that case the staging directory may be left behind.
pub async fn download_dependencies(app: AppHandle) -> Result<(), String> {
    let dir = tools_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create tools directory: {}", e))?;

    let downloads_dir = dir.join("downloads");
    std::fs::create_dir_all(&downloads_dir)
        .map_err(|e| format!("Failed to create downloads directory: {}", e))?;

    let mut versions = load_versions(&dir);
    let ytdlp_path = dir.join(ytdlp_binary_name());

    let latest_ytdlp = github::fetch_latest_ytdlp().await?;
    let should_update_ytdlp = !ytdlp_path.exists()
        || versions.ytdlp.as_ref().map(|v| v.version.as_str()) != Some(latest_ytdlp.version.as_str());

    if should_update_ytdlp {
        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "ytdlp",
            "progress": 0.1,
            "status": "downloading"
        }))
        .ok();

        let dest_path = downloads_dir.join(&latest_ytdlp.file_name);
        download_file(&latest_ytdlp.download_url, &dest_path, &app, "ytdlp").await?;

        let final_path = dir.join(ytdlp_binary_name());
        std::fs::rename(&dest_path, &final_path)
            .map_err(|e| format!("Failed to move yt-dlp binary: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&final_path, std::fs::Permissions::from_mode(0o755));
        }

        versions.ytdlp = Some(ToolInfo {
            version: latest_ytdlp.version,
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

    if !dir.join(ffmpeg_binary_name()).exists() {
        let platform = super::github::platform_key();
        if platform.starts_with("macos") {
            println!("[ffmpeg] macOS detected - FFmpeg must be installed manually (e.g., via Homebrew: brew install ffmpeg)");
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

            app.emit("dependency-download-progress", serde_json::json!({
                "tool": "ffmpeg",
                "progress": 0.9,
                "status": "extracting"
            }))
            .ok();

            extract_ffmpeg_zip(&dest_path, &dir)?;

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
        }
    }

    if !dir.join("node").join("node.exe").exists() {
        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "node",
            "progress": 0.0,
            "status": "fetching_release"
        }))
        .ok();

        let release = github::fetch_latest_node().await?;

        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "node",
            "progress": 0.1,
            "status": "downloading"
        }))
        .ok();

        let dest_path = downloads_dir.join(&release.file_name);
        download_file(&release.download_url, &dest_path, &app, "node").await?;

        app.emit("dependency-download-progress", serde_json::json!({
            "tool": "node",
            "progress": 0.9,
            "status": "extracting"
        }))
        .ok();

        let node_dir = dir.join("node");
        std::fs::create_dir_all(&node_dir)
            .map_err(|e| format!("Failed to create node directory: {}", e))?;
        extract_node_zip(&dest_path, &node_dir)?;

        let _ = std::fs::remove_file(&dest_path);

        versions.node = Some(ToolInfo {
            version: release.version,
            path: node_dir.join("node.exe").to_string_lossy().to_string(),
            downloaded_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
        save_versions(&dir, &versions)?;

        app.emit("dependency-download-complete", serde_json::json!({
            "tool": "node",
            "version": versions.node.as_ref().unwrap().version
        }))
        .ok();
    }

    let _ = std::fs::remove_dir_all(&downloads_dir);

    Ok(())
}

/// Streams `url` to `dest`, emitting `dependency-download-progress` events
/// with `{ tool, progress, bytes_downloaded, total_bytes, status }` whenever
/// the server reported a content length.
///
/// # Errors
///
/// Returns an error string when the request fails, the HTTP status is not
/// successful, the destination file cannot be created, the stream fails, or a
/// chunk cannot be written to disk.
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

/// Extracts only `ffmpeg` and `ffprobe` from a BtbN release ZIP into
/// `dest_dir`, skipping every other entry (docs, libraries, plugins).
///
/// On Unix the extracted binaries are marked executable (`0o755`).
///
/// # Errors
///
/// Returns an error string when the ZIP cannot be opened or read, an entry
/// cannot be extracted or written, or the `ffmpeg` binary is missing from the
/// archive.
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

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755));
            }
        }
    }

    let ffmpeg_path = dest_dir.join(&bin_name);
    if !ffmpeg_path.exists() {
        return Err("Failed to extract ffmpeg binary from zip".to_string());
    }
    let ffmpeg_size = std::fs::metadata(&ffmpeg_path).map(|m| m.len()).unwrap_or(0);
    println!("[ffmpeg] Verification: {:?} exists, size: {} bytes", ffmpeg_path, ffmpeg_size);

    Ok(())
}

/// Extracts only `node.exe` from a Node.js release ZIP into `dest_dir`.
///
/// # Errors
///
/// Returns an error string when the ZIP cannot be opened or read, an entry
/// cannot be extracted or written, or `node.exe` is missing from the archive.
fn extract_node_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let zip_file =
        std::fs::File::open(zip_path).map_err(|e| format!("Failed to open node zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to read node zip: {}", e))?;

    println!("[node] Extracting zip to {:?}", dest_dir);

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let name = file.name().to_string();
        let path = Path::new(name.as_str());

        if path.ends_with("node.exe") {
            let out_path = dest_dir.join("node.exe");
            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create node.exe: {}", e))?;
            std::io::copy(&mut file, &mut out_file)
                .map_err(|e| format!("Failed to extract node.exe: {}", e))?;
            println!("[node] Extracted node.exe");
        }
    }

    let node_path = dest_dir.join("node.exe");
    if !node_path.exists() {
        return Err("Failed to extract node.exe from zip".to_string());
    }
    let node_size = std::fs::metadata(&node_path).map(|m| m.len()).unwrap_or(0);
    println!("[node] Verification: {:?} exists, size: {} bytes", node_path, node_size);

    Ok(())
}
