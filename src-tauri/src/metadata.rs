use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Serialize, Deserialize)]
pub struct MediaMetadata {
    pub duration: Option<f64>,
}

#[tauri::command]
pub async fn extract_metadata(path: String) -> Result<MediaMetadata, String> {
    // Try ffprobe first
    if let Ok(output) = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration : stream=index",
            "-of",
            "default=noprint_wrappers=1:nokey=1:nokey=1",
            &path,
        ])
        .output()
        .await
    {
        if output.status.success() && !output.stdout.is_empty() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let duration = stdout.trim().parse::<f64>().ok().map(|d| d.round());
            return Ok(MediaMetadata { duration });
        }
    }

    // Fallback to mediainfo
    if let Ok(output) = Command::new("mediainfo")
        .args(["--Inform=General;%Duration/1000%", &path])
        .output()
        .await
    {
        if output.status.success() && !output.stdout.is_empty() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let duration = stdout.trim().parse::<f64>().ok().map(|d| d.round());
            return Ok(MediaMetadata { duration });
        }
    }

    Ok(MediaMetadata { duration: None })
}