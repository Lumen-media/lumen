use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use std::io;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSelectionResult {
    pub path: Option<String>,
    pub cancelled: bool,
}

#[tauri::command]
pub async fn select_pptx_file(app: AppHandle) -> Result<FileSelectionResult, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("PowerPoint Files", &["pptx", "ppt"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_buf = path.as_path().ok_or("Failed to get file path")?;
            let path_str = path_buf.to_string_lossy().to_string();

            if !path_buf.exists() {
                return Err("Selected file does not exist".to_string());
            }

            if !path_buf.is_file() {
                return Err("Selected path is not a file".to_string());
            }

            let extension = path_buf
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|s| s.to_lowercase());

            match extension.as_deref() {
                Some("pptx") | Some("ppt") => {
                    Ok(FileSelectionResult {
                        path: Some(path_str),
                        cancelled: false,
                    })
                }
                _ => Err("Invalid file format. Please select a .pptx or .ppt file".to_string()),
            }
        }
        None => {
            Ok(FileSelectionResult {
                path: None,
                cancelled: true,
            })
        }
    }
}

#[tauri::command]
pub async fn select_video_file(app: AppHandle) -> Result<FileSelectionResult, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Video Files", &["mp4", "avi", "mov", "webm", "mkv", "flv", "wmv"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_buf = path.as_path().ok_or("Failed to get file path")?;
            let path_str = path_buf.to_string_lossy().to_string();

            if !path_buf.exists() {
                return Err("Selected file does not exist".to_string());
            }

            if !path_buf.is_file() {
                return Err("Selected path is not a file".to_string());
            }

            let extension = path_buf
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|s| s.to_lowercase());

            let valid_extensions = ["mp4", "avi", "mov", "webm", "mkv", "flv", "wmv"];
            match extension.as_deref() {
                Some(ext) if valid_extensions.contains(&ext) => {
                    Ok(FileSelectionResult {
                        path: Some(path_str),
                        cancelled: false,
                    })
                }
                _ => Err("Invalid file format. Please select a supported video file".to_string()),
            }
        }
        None => {
            Ok(FileSelectionResult {
                path: None,
                cancelled: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_selection_result_serialization() {
        let result = FileSelectionResult {
            path: Some("/path/to/file.pptx".to_string()),
            cancelled: false,
        };
        
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("path"));
        assert!(json.contains("cancelled"));
    }

    #[test]
    fn test_file_selection_cancelled() {
        let result = FileSelectionResult {
            path: None,
            cancelled: true,
        };
        
        assert!(result.cancelled);
        assert!(result.path.is_none());
    }
}

const DATABASE_VERSION: &str = "1.0.0";

fn get_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(app_data_dir.join("media_database.json"))
}

#[tauri::command]
pub async fn save_media_database(app: AppHandle, data: String) -> Result<(), String> {
    let db_path = get_database_path(&app)?;

    let mut json_value: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("Invalid JSON data: {}", e))?;

    if let Some(obj) = json_value.as_object_mut() {
        if !obj.contains_key("version") {
            obj.insert("version".to_string(), serde_json::Value::String(DATABASE_VERSION.to_string()));
        }
    }

    let formatted_data = serde_json::to_string_pretty(&json_value)
        .map_err(|e| format!("Failed to format JSON: {}", e))?;

    fs::write(&db_path, formatted_data)
        .map_err(|e| {
            match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: Cannot write to database file at {:?}", db_path)
                }
                io::ErrorKind::NotFound => {
                    format!("Directory not found: Cannot create database file at {:?}", db_path)
                }
                _ => {
                    format!("Failed to save database: {} (path: {:?})", e, db_path)
                }
            }
        })?;

    log::info!("Media database saved successfully to {:?}", db_path);
    Ok(())
}

#[tauri::command]
pub async fn load_media_database(app: AppHandle) -> Result<String, String> {
    let db_path = get_database_path(&app)?;

    if !db_path.exists() {
        log::info!("Database file does not exist, returning empty database");
        let default_db = serde_json::json!({
            "version": DATABASE_VERSION,
            "mediaItems": [],
            "settings": {
                "defaultDisplay": 1,
                "autoStartPresentation": false,
                "cacheDirectory": "/cache"
            }
        });
        return Ok(serde_json::to_string(&default_db)
            .map_err(|e| format!("Failed to create default database: {}", e))?);
    }

    let data = fs::read_to_string(&db_path)
        .map_err(|e| {
            match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: Cannot read database file at {:?}", db_path)
                }
                io::ErrorKind::NotFound => {
                    format!("Database file not found at {:?}", db_path)
                }
                _ => {
                    format!("Failed to load database: {} (path: {:?})", e, db_path)
                }
            }
        })?;

    let json_value: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| {
            format!("Database file is corrupted or contains invalid JSON: {}. Please check the file at {:?}", e, db_path)
        })?;

    if let Some(obj) = json_value.as_object() {
        let version = obj.get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        
        if version != DATABASE_VERSION {
            log::warn!("Database version mismatch: found {}, expected {}. Migration may be needed.", version, DATABASE_VERSION);
        }
    }

    log::info!("Media database loaded successfully from {:?}", db_path);
    Ok(data)
}

#[cfg(test)]
mod database_tests {
    use super::*;

    #[test]
    fn test_database_version_constant() {
        assert_eq!(DATABASE_VERSION, "1.0.0");
    }

    #[test]
    fn test_json_validation() {
        let valid_json = r#"{"version":"1.0.0","mediaItems":[]}"#;
        let result: Result<serde_json::Value, _> = serde_json::from_str(valid_json);
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_json() {
        let invalid_json = r#"{"version":"1.0.0","mediaItems":"#;
        let result: Result<serde_json::Value, _> = serde_json::from_str(invalid_json);
        assert!(result.is_err());
    }
}
