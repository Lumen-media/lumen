use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolRelease {
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub size: u64,
}

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

fn is_windows() -> bool {
    std::env::consts::OS == "windows"
}

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

pub async fn fetch_latest_ytdlp() -> Result<ToolRelease, String> {
    let url = "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";
    fetch_release(url, match_ytdlp_asset, "yt-dlp").await
}

pub async fn fetch_latest_ffmpeg() -> Result<ToolRelease, String> {
    let url = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest";
    fetch_release(url, match_ffmpeg_asset, "ffmpeg").await
}

#[derive(Debug, Deserialize)]
struct NodeRelease {
    version: String,
    lts: Option<serde_json::Value>,
}

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

async fn fetch_content_length(url: &str, client: &reqwest::Client) -> Option<u64> {
    client
        .head(url)
        .send()
        .await
        .ok()?
        .content_length()
}

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
