//! Release-asset resolution for the external tools and app resources.
//!
//! All network access is done with the `reqwest` async client using a
//! `lumen-app` user agent. Two kinds of sources are used:
//!
//! - GitHub releases (`api.github.com`) for `yt-dlp` (nightly builds) and
//!   FFmpeg (BtbN builds), matched to the host platform by
//!   [`platform_key`].
//! - Other publishers: Node.js (`nodejs.org`) and the `lumen-locales`
//!   repository served through jsDelivr.
//!
//! GitHub's unauthenticated API is rate limited; a `403` is surfaced as a
//! human-readable error so the UI can ask the user to retry later.

use serde::Deserialize;

/// Subset of the GitHub release payload consumed by [`fetch_release`].
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

/// A single downloadable file attached to a GitHub release.
#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// A resolved tool download: the selected asset plus its version.
///
/// Produced by [`fetch_latest_ytdlp`], [`fetch_latest_ffmpeg`], and
/// [`fetch_latest_node`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolRelease {
    /// Release tag or version string (for example `2025.01.15` or `v22.11.0`).
    pub version: String,
    /// Direct URL of the binary/archive to download.
    pub download_url: String,
    /// File name as published by the upstream project.
    pub file_name: String,
    /// Expected size in bytes, or `0` when the source did not report it.
    pub size: u64,
}

/// Short platform identifier used to pick the right release asset.
///
/// Maps the host OS and CPU architecture to one of the keys below, or
/// `"unknown"` for unsupported combinations:
///
/// | OS | Architecture | Key |
/// |---|---|---|
/// | Windows | `x86_64` | `win_x64` |
/// | Windows | `x86` | `win_x86` |
/// | Windows | `aarch64` | `win_arm64` |
/// | Linux | `x86_64` | `linux_x64` |
/// | Linux | `aarch64` | `linux_aarch64` |
/// | macOS | `aarch64` | `macos_arm64` |
/// | macOS | `x86_64` | `macos_x64` |
pub fn platform_key() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "win_x64",
        ("windows", "aarch64") => "win_arm64",
        ("windows", "x86") => "win_x86",
        ("linux", "x86_64") => "linux_x64",
        ("linux", "aarch64") => "linux_aarch64",
        ("macos", "aarch64") => "macos_arm64",
        ("macos", "x86_64") => "macos_x64",
        _ => "unknown",
    }
}

/// Returns `true` when the host operating system is Windows.
fn is_windows() -> bool {
    std::env::consts::OS == "windows"
}

/// Picks the `yt-dlp` asset for the current platform.
///
/// Prefers the platform-specific binary name and, failing that, any
/// non-archive, non-checksum `yt-dlp*` asset.
fn match_ytdlp_asset(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    let platform = platform_key();

    match platform {
        "win_x64" => assets.iter().find(|a| a.name == "yt-dlp.exe"),
        "win_x86" => assets.iter().find(|a| a.name == "yt-dlp_x86.exe"),
        "win_arm64" => assets.iter().find(|a| a.name == "yt-dlp_arm64.exe"),
        "linux_x64" => assets.iter().find(|a| a.name == "yt-dlp_linux"),
        "linux_aarch64" => assets.iter().find(|a| a.name == "yt-dlp_linux_aarch64"),
        "macos_arm64" | "macos_x64" => assets.iter().find(|a| a.name == "yt-dlp_macos"),
        _ => None,
    }
    .or_else(|| {
        assets.iter().find(|a| {
            a.name.starts_with("yt-dlp")
                && !a.name.ends_with(".tar.gz")
                && !a.name.ends_with(".zip")
                && !a.name.contains("SHA")
                && !a.name.contains("SUMS")
        })
    })
}

/// Picks the FFmpeg archive for the current platform from the BtbN builds.
///
/// Matches the platform-specific `ffmpeg-master-latest-*-gpl` prefix, avoiding
/// `shared` and `lgpl` variants when an alternative exists. macOS is not
/// published by BtbN, so it returns `None` there.
fn match_ffmpeg_asset(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    let platform = platform_key();

    let prefix = match platform {
        "win_x64" => "ffmpeg-master-latest-win64-gpl",
        "win_x86" => "ffmpeg-master-latest-win32-gpl",
        "win_arm64" => "ffmpeg-master-latest-winarm64-gpl",
        "linux_x64" => "ffmpeg-master-latest-linux64-gpl",
        "linux_aarch64" => "ffmpeg-master-latest-linuxarm64-gpl",
        _ => return None, // macOS not available from BtbN
    };

    assets.iter().find(|a| {
        a.name.starts_with(prefix) 
            && a.name.ends_with(".zip") 
            && !a.name.contains("shared")
            && !a.name.contains("lgpl")
    })
    .or_else(|| assets.iter().find(|a| a.name.starts_with(prefix) && a.name.ends_with(".zip")))
}

/// Resolves the latest `yt-dlp` nightly build for the current platform.
///
/// # Errors
///
/// Returns an error string when the GitHub API request fails, hits the rate
/// limit (`403`), returns a non-success status, cannot be parsed, or has no
/// matching asset for the platform.
pub async fn fetch_latest_ytdlp() -> Result<ToolRelease, String> {
    let url = "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";
    fetch_release(url, match_ytdlp_asset, "yt-dlp").await
}

/// Resolves the latest FFmpeg build (BtbN) for the current platform.
///
/// # Errors
///
/// Returns an error string when the GitHub API request fails, hits the rate
/// limit (`403`), returns a non-success status, cannot be parsed, or has no
/// matching asset for the platform (macOS is unsupported).
pub async fn fetch_latest_ffmpeg() -> Result<ToolRelease, String> {
    let url = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest";
    fetch_release(url, match_ffmpeg_asset, "ffmpeg").await
}

/// Subset of the GitHub release payload used to read the locales tag.
#[derive(Debug, Deserialize)]
struct LocalRelease {
    tag_name: String,
}

/// Returns the tag of the latest `lumen-locales` release.
///
/// # Errors
///
/// Returns an error string when the GitHub API request fails, hits the rate
/// limit (`403`), returns a non-success status, or the JSON cannot be parsed.
pub async fn fetch_latest_locales_tag() -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/repos/Lumen-media/lumen-locales/releases/latest")
        .header("User-Agent", "lumen-app")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch locales release: {}", e))?;

    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("GitHub API rate limit exceeded. Try again later.".to_string());
    }

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned status {} for locales",
            response.status()
        ));
    }

    let release: LocalRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse locales release JSON: {}", e))?;

    Ok(release.tag_name)
}

/// Downloads a single locale file from the `lumen-locales` repository at `tag`
/// through jsDelivr.
///
/// `path` is repository-relative (for example `pt-BR.json`). Responses larger
/// than 1 MiB are rejected based on `Content-Length` when present.
///
/// # Errors
///
/// Returns an error string when the request fails, jsDelivr returns a
/// non-success status, the content length exceeds the 1 MiB cap, or the body
/// cannot be read as text.
pub async fn fetch_locale_file(tag: &str, path: &str) -> Result<String, String> {
    let url = format!("https://cdn.jsdelivr.net/gh/Lumen-media/lumen-locales@{}/{}", tag, path);
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("User-Agent", "lumen-app")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {}: {}", path, e))?;

    if !response.status().is_success() {
        return Err(format!("jsDelivr returned status {} for {}", response.status(), path));
    }

    if let Some(len) = response.content_length() {
        if len > 1_048_576 {
            return Err(format!("{} exceeds the 1 MB size cap", path));
        }
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Subset of the Node.js `dist/index.json` entry consumed here.
#[derive(Debug, Deserialize)]
struct NodeRelease {
    version: String,
    lts: Option<serde_json::Value>,
}

/// Resolves the latest Node.js LTS release for Windows x64.
///
/// Prefers the newest LTS entry and falls back to the newest release overall.
/// The returned [`ToolRelease`] points at the Windows x64 ZIP; the asset size
/// is fetched with a `HEAD` request and defaults to `0` when unavailable.
///
/// # Errors
///
/// Returns an error string when the Node.js API request fails, returns a
/// non-success status, cannot be parsed, or contains no releases.
pub async fn fetch_latest_node() -> Result<ToolRelease, String> {
    let url = "https://nodejs.org/dist/index.json";
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("User-Agent", "lumen-app")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Node release: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Node.js dist API returned status {}",
            response.status()
        ));
    }

    let releases: Vec<NodeRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Node releases JSON: {}", e))?;

    let release = releases
        .iter()
        .find(|r| r.lts.is_some() && matches!(r.lts, Some(serde_json::Value::String(_)) | Some(serde_json::Value::Bool(true))))
        .or_else(|| releases.first())
        .ok_or_else(|| "No Node.js releases found".to_string())?;

    let version_trimmed = release.version.trim_start_matches('v').to_string();
    let file_name = format!("node-v{}-win-x64.zip", version_trimmed);
    let download_url = format!("https://nodejs.org/dist/{}/{}", release.version, file_name);

    let size = fetch_content_length(&download_url, &client).await.unwrap_or(0);

    Ok(ToolRelease {
        version: release.version.clone(),
        download_url,
        file_name,
        size,
    })
}

/// Issues a `HEAD` request and returns the reported content length, or `None`
/// when the request fails or the header is missing.
async fn fetch_content_length(url: &str, client: &reqwest::Client) -> Option<u64> {
    client
        .head(url)
        .send()
        .await
        .ok()?
        .content_length()
}

/// Fetches a GitHub release and selects the asset returned by `matcher`.
///
/// Shared by [`fetch_latest_ytdlp`] and [`fetch_latest_ffmpeg`]; `tool_name`
/// is only used in error messages.
///
/// # Errors
///
/// Returns an error string when the request fails, hits the rate limit
/// (`403`), returns a non-success status, cannot be parsed, or `matcher`
/// finds no suitable asset for the platform.
async fn fetch_release(
    url: &str,
    matcher: fn(&[GitHubAsset]) -> Option<&GitHubAsset>,
    tool_name: &str,
) -> Result<ToolRelease, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("User-Agent", "lumen-app")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {} release: {}", tool_name, e))?;

    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(format!(
            "GitHub API rate limit exceeded. Try again later."
        ));
    }

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API returned status {} for {}",
            response.status(),
            tool_name
        ));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse {} release JSON: {}", tool_name, e))?;

    let asset = matcher(&release.assets)
        .ok_or_else(|| format!("No matching {} binary found for platform {}", tool_name, platform_key()))?;

    Ok(ToolRelease {
        version: release.tag_name,
        download_url: asset.browser_download_url.clone(),
        file_name: asset.name.clone(),
        size: asset.size,
    })
}
