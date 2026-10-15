//! Recursive listing of media folders for the frontend.
//!
//! The file browser receives a flat, alphabetically sorted list of every file
//! under a media type's folder, carrying enough metadata (size, modification
//! time, extension, subfolder) to filter, group and re-sort on the client
//! without further disk access.

use serde::Serialize;
use std::path::Path;

/// A single file discovered by [`scan_media_files`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    /// File name including its extension.
    pub name: String,
    /// Absolute path of the file.
    pub path: String,
    /// Folder containing the file, relative to the media root; empty for
    /// files sitting at the root itself.
    pub folder: String,
    /// File size in bytes.
    pub size: i64,
    /// Last modification time in Unix milliseconds, `0` when unavailable.
    pub modified_at: i64,
    /// Extension without the leading dot, or an empty string.
    pub extension: String,
}

/// Resolves the root folder of a media type through [`crate::paths`].
fn media_type_dir(media_type: &str) -> Result<std::path::PathBuf, String> {
    crate::paths::media_dir(media_type)
}

/// Extension of `name` without the leading dot, or an empty string when the
/// name carries none.
fn ext_from_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Lists every file under a media type's folder for the frontend.
///
/// The tree is walked depth-first; symlinks and other non-regular entries are
/// skipped, and results are sorted case-insensitively by name. A media folder
/// that does not exist resolves to an empty list instead of an error.
///
/// # Errors
///
/// Returns an error when the media type is unknown or paths have not been
/// initialized, or when a directory, an entry type or file metadata cannot be
/// read.
#[tauri::command]
pub async fn scan_media_files(media_type: String) -> Result<Vec<ScannedFile>, String> {
    let dir = media_type_dir(&media_type)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files: Vec<ScannedFile> = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, String)> = vec![(dir.clone(), String::new())];

    while let Some((current_dir, folder)) = stack.pop() {
        let entries = std::fs::read_dir(&current_dir).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if file_type.is_dir() {
                let child = if folder.is_empty() {
                    name.clone()
                } else {
                    format!("{folder}/{name}")
                };
                stack.push((path, child));
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;

            files.push(ScannedFile {
                name: name.clone(),
                path: path.to_string_lossy().to_string(),
                folder: folder.clone(),
                size: meta.len() as i64,
                modified_at: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
                extension: ext_from_name(&name),
            });
        }
    }

    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}