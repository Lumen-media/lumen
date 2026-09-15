use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_REMOTE_BYTES: u64 = 25 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

pub fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "Could not resolve executable directory".to_string())?;
    Ok(parent.to_path_buf())
}

/// Base directory for all app data (media files + database).
/// Mirrors the TS `getAppBasePath()`: `<exe_dir>/lumen`.
pub fn app_base_dir() -> Result<PathBuf, String> {
    Ok(exe_dir()?.join("lumen"))
}

/// Cache folder for remote thumbnails (`<base>/cache/remote-thumbs`).
pub fn remote_thumbs_dir() -> Result<PathBuf, String> {
    let dir = app_base_dir()?.join("cache").join("remote-thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Milliseconds since the UNIX epoch (matches JS `Date.now()`).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Downloads a remote resource with a size cap so a malicious/unexpected URL
/// cannot balloon the process memory.
pub async fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("request failed: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_REMOTE_BYTES {
        return Err("remote content is too large".into());
    }

    Ok(bytes.to_vec())
}