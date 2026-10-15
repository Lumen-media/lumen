//! Small shared helpers for remote-facing features.
//!
//! Remote control, URL media and device discovery all need the same things:
//! a directory for cached thumbnails, a millisecond timestamp and an HTTP
//! client that cannot hang or buffer unbounded data. Every fetch issued from
//! here is bounded by a timeout and by a maximum body size.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Upper bound for a single remote download, in bytes.
///
/// Thumbnails and other assets fetched from remote endpoints are far smaller
/// than this, so exceeding the cap means the endpoint is not serving what the
/// app asked for.
const MAX_REMOTE_BYTES: u64 = 25 * 1024 * 1024;
/// Timeout applied to every request built by [`fetch_bytes`].
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// Directory containing the running executable, re-exported from [`crate::paths`].
pub fn app_base_dir() -> Result<PathBuf, String> {
    crate::paths::app_base_dir()
}

/// Creates the thumbnail cache directory when missing and returns its path.
///
/// # Errors
///
/// Returns an error when the base directory cannot be resolved or the
/// directory cannot be created.
pub fn remote_thumbs_dir() -> Result<PathBuf, String> {
    let dir = app_base_dir()?.join("cache").join("remote-thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Current wall-clock time in milliseconds since the Unix epoch.
///
/// Returns `0` when the system clock reads a time before 1970, so callers can
/// always order events without handling a clock error.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Downloads `url` and returns the response body.
///
/// The request is bounded by [`FETCH_TIMEOUT`] and the body by
/// [`MAX_REMOTE_BYTES`], so a slow endpoint or a misbehaving server cannot
/// stall the caller indefinitely or exhaust memory.
///
/// # Errors
///
/// Returns an error when the client cannot be built, the request fails or
/// times out, the response status is not 2xx, or the body exceeds 25 MiB.
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