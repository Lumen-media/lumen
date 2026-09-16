use serde::Serialize;
use std::path::Path;

use crate::remote;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified_at: i64,
    pub extension: String,
}

fn media_type_dir(media_type: &str) -> Result<std::path::PathBuf, String> {
    Ok(remote::app_base_dir()?
        .join("files")
        .join("media")
        .join(media_type))
}

fn ext_from_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn scan_media_files(media_type: String) -> Result<Vec<ScannedFile>, String> {
    let dir = media_type_dir(&media_type)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut files: Vec<ScannedFile> = Vec::new();

    for entry in entries.flatten() {
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;

        files.push(ScannedFile {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
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

    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}