use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_REMOTE_BYTES: u64 = 25 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

pub fn app_base_dir() -> Result<PathBuf, String> {
    crate::paths::app_base_dir()
}

pub fn remote_thumbs_dir() -> Result<PathBuf, String> {
    let dir = app_base_dir()?.join("cache").join("remote-thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

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