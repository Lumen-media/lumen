//! Media duration probing through external command-line tools.
//!
//! Container durations are read far more reliably by `ffprobe` and
//! `mediainfo` than by any pure-Rust option, so this module shells out to
//! them and parses their stdout. Helper processes are spawned without a
//! visible window on Windows so no console flashes over the live interface.

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Windows creation flag that keeps a spawned helper process from opening a
/// console window.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Applies [`CREATE_NO_WINDOW`] on Windows; a no-op on other platforms.
fn hidden(mut cmd: Command) -> Command {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Duration of a media file as reported by an external probe.
#[derive(Serialize, Deserialize)]
pub struct MediaMetadata {
    /// Length in seconds rounded to the nearest whole second, or `None` when
    /// no tool reported a parsable duration.
    pub duration: Option<f64>,
}

/// Reports the duration of a media file to the frontend.
///
/// `ffprobe` is tried first and `mediainfo` as a fallback, both executed with
/// hidden windows on Windows. The command never returns an error: a missing
/// tool, an unreadable file or unparsable output resolves with
/// `duration: None`, so a media item without timing information still loads.
#[tauri::command]
pub async fn extract_metadata(path: String) -> Result<MediaMetadata, String> {
    // Try ffprobe first
    if let Ok(output) = hidden(Command::new("ffprobe"))
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
    if let Ok(output) = hidden(Command::new("mediainfo"))
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