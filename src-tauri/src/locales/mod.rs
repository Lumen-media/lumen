use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::download::github;

const MAX_FILE_BYTES: u64 = 1_048_576;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LocaleSync {
    pub last_synced_tag: Option<String>,
    pub synced_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageRef {
    pub code: String,
    pub name: String,
    pub native_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocaleInfo {
    pub code: String,
    pub name: String,
    pub native_name: String,
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocaleStatus {
    pub latest_tag: Option<String>,
    pub last_synced_tag: Option<String>,
    pub synced_at: Option<u64>,
    pub locales_dir: String,
    pub languages: Vec<LocaleInfo>,
}

fn locales_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("locales"))
}

fn sync_path(dir: &Path) -> PathBuf {
    dir.join("sync.json")
}

fn load_sync(dir: &Path) -> LocaleSync {
    let path = sync_path(dir);
    if !path.exists() {
        return LocaleSync::default();
    }
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_sync(dir: &Path, sync: &LocaleSync) -> Result<(), String> {
    let data = serde_json::to_string_pretty(sync).map_err(|e| e.to_string())?;
    std::fs::write(sync_path(dir), data).map_err(|e| format!("Failed to save sync.json: {}", e))
}

fn validate_locale_json(raw: &str, file: &str) -> Result<HashMap<String, String>, String> {
    if raw.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("{} exceeds the 1 MB size cap", file));
    }
    let map: HashMap<String, String> =
        serde_json::from_str(raw).map_err(|e| format!("{} is not valid locale JSON: {}", file, e))?;
    for value in map.values() {
        let lower = value.to_lowercase();
        if lower.contains("<script") || lower.contains("javascript:") {
            return Err(format!("{} contains active-content value", file));
        }
    }
    Ok(map)
}

fn load_languages(dir: &Path) -> Vec<LanguageRef> {
    let path = dir.join("languages.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_else(|_| {
        vec![LanguageRef {
            code: "en".to_string(),
            name: "English".to_string(),
            native_name: "English".to_string(),
        }]
    })
}

#[tauri::command]
pub async fn check_locales(app: AppHandle) -> Result<LocaleStatus, String> {
    let dir = locales_dir(&app)?;
    let sync = load_sync(&dir);
    let latest_tag = github::fetch_latest_locales_tag().await.ok();

    let languages = load_languages(&dir)
        .into_iter()
        .map(|lang| {
            let path = dir.join(format!("{}.json", lang.code));
            let installed = path.exists();
            LocaleInfo {
                code: lang.code,
                name: lang.name,
                native_name: lang.native_name,
                installed,
                path: if installed {
                    Some(path.to_string_lossy().to_string())
                } else {
                    None
                },
            }
        })
        .collect();

    Ok(LocaleStatus {
        latest_tag,
        last_synced_tag: sync.last_synced_tag,
        synced_at: sync.synced_at,
        locales_dir: dir.to_string_lossy().to_string(),
        languages,
    })
}

#[tauri::command]
pub async fn sync_locales(app: AppHandle) -> Result<LocaleStatus, String> {
    let dir = locales_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create locales directory: {}", e))?;

    let tag = github::fetch_latest_locales_tag().await?;
    let sync = load_sync(&dir);
    if sync.last_synced_tag.as_deref() == Some(tag.as_str()) {
        return check_locales(app).await;
    }

    let languages_raw = github::fetch_locale_file(&tag, "languages.json").await?;
    let languages: Vec<LanguageRef> = serde_json::from_str(&languages_raw)
        .map_err(|e| format!("languages.json is not valid: {}", e))?;

    for lang in &languages {
        let remote_path = format!("locales/{}.json", lang.code);
        if let Ok(raw) = github::fetch_locale_file(&tag, &remote_path).await {
            if validate_locale_json(&raw, &remote_path).is_ok() {
                let _ = std::fs::write(dir.join(format!("{}.json", lang.code)), &raw);
            }
        }
    }

    let _ = std::fs::write(dir.join("languages.json"), &languages_raw);
    save_sync(
        &dir,
        &LocaleSync {
            last_synced_tag: Some(tag.clone()),
            synced_at: Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            ),
        },
    )?;

    app.emit(
        "locales-synced",
        serde_json::json!({ "last_synced_tag": tag }),
    )
    .ok();

    check_locales(app).await
}

#[tauri::command]
pub fn apply_locale(app: AppHandle, lang: &str) -> Result<String, String> {
    let dir = locales_dir(&app)?;
    let path = dir.join(format!("{}.json", lang));
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Locale {} is not installed: {}", lang, e))
}

#[tauri::command]
pub async fn list_locales(app: AppHandle) -> Result<Vec<LocaleInfo>, String> {
    check_locales(app).await.map(|status| status.languages)
}