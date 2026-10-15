//! Translation (i18n) management.
//!
//! Locale JSON files live in the app data directory under `locales/` and are
//! synced from the project's GitHub releases. `languages.json` lists the
//! available languages; each `<code>.json` maps translation keys to strings.
//! Synced files are size-capped and scanned for active content (inline
//! scripts / `javascript:` URLs) before being written to disk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::download::github;

/// Maximum size of a single downloaded locale file (1 MiB).
const MAX_FILE_BYTES: u64 = 1_048_576;

/// Bookkeeping for the last successful locale sync, persisted as
/// `locales/sync.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LocaleSync {
    /// Git tag of the synchronization that is currently installed on disk.
    pub last_synced_tag: Option<String>,
    /// Unix timestamp (seconds) of that synchronization.
    pub synced_at: Option<u64>,
}

/// One entry of `languages.json`: a language the app can display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageRef {
    /// BCP-47-ish language code used as the locale file name (`<code>.json`).
    pub code: String,
    /// Language name in English, shown in the settings UI.
    pub name: String,
    /// Language name in its own script, shown next to `name`.
    pub native_name: String,
}

/// A language together with its installation status, as reported to the
/// frontend.
#[derive(Debug, Clone, Serialize)]
pub struct LocaleInfo {
    /// Locale code (`<code>.json`).
    pub code: String,
    /// Language name in English.
    pub name: String,
    /// Language name in its own script.
    pub native_name: String,
    /// Whether the locale file exists on disk.
    pub installed: bool,
    /// Absolute path of the installed locale file, absent when not installed.
    pub path: Option<String>,
}

/// Snapshot of the locale subsystem: sync metadata plus the list of languages.
#[derive(Debug, Clone, Serialize)]
pub struct LocaleStatus {
    /// Git tag of the newest locales available upstream, when reachable.
    pub latest_tag: Option<String>,
    /// Git tag of the locales currently installed on disk.
    pub last_synced_tag: Option<String>,
    /// Unix timestamp (seconds) of the installed synchronization.
    pub synced_at: Option<u64>,
    /// Absolute path of the directory holding the locale files.
    pub locales_dir: String,
    /// Available languages with their installation status.
    pub languages: Vec<LocaleInfo>,
}

/// Resolves the `locales/` directory inside the app data directory.
fn locales_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(data_dir.join("locales"))
}

/// Path of the sync bookkeeping file inside `dir`.
fn sync_path(dir: &Path) -> PathBuf {
    dir.join("sync.json")
}

/// Reads [`LocaleSync`] from disk, falling back to defaults when missing or
/// unreadable.
fn load_sync(dir: &Path) -> LocaleSync {
    let path = sync_path(dir);
    if !path.exists() {
        return LocaleSync::default();
    }
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

/// Writes [`LocaleSync`] to `sync.json` as pretty-printed JSON.
fn save_sync(dir: &Path, sync: &LocaleSync) -> Result<(), String> {
    let data = serde_json::to_string_pretty(sync).map_err(|e| e.to_string())?;
    std::fs::write(sync_path(dir), data).map_err(|e| format!("Failed to save sync.json: {}", e))
}

/// Parses and validates a downloaded locale file.
///
/// Rejects files larger than [`MAX_FILE_BYTES`], files that are not a JSON
/// object of string values, and files containing active content (inline
/// scripts or `javascript:` URLs).
///
/// # Errors
///
/// Returns a human-readable message when the file exceeds the size cap, is
/// not valid locale JSON, or contains a suspicious value.
///
/// # Examples
///
/// ```ignore
/// use crate::locales::validate_locale_json;
///
/// let map = validate_locale_json(r#"{ "hello": "Hello" }"#, "en.json").unwrap();
/// assert_eq!(map["hello"], "Hello");
/// assert!(validate_locale_json(r#"{ "x": "<script>" }"#, "en.json").is_err());
/// ```
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

/// Loads the list of available languages, defaulting to English when
/// `languages.json` is missing or malformed.
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

/// Reports the installed languages and whether a newer set is available
/// upstream.
///
/// Frontend API: invoke `check_locales` with no arguments; resolves with a
/// [`LocaleStatus`]. A network failure while querying the latest tag does not
/// fail the call, it simply leaves `latestTag` empty.
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved.
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

/// Downloads the latest locale set from GitHub and installs it on disk.
///
/// Frontend API: invoke `sync_locales` with no arguments; resolves with the
/// refreshed [`LocaleStatus`]. When the installed tag already matches the
/// latest one, the download is skipped. `languages.json` is written first,
/// then each locale is fetched and validated individually; files that fail
/// validation are skipped rather than aborting the whole sync. Emits
/// `locales-synced` with the new tag on success.
///
/// # Errors
///
/// Returns an error string when the locales directory cannot be created,
/// `languages.json` cannot be downloaded or parsed, or the sync bookkeeping
/// cannot be written.
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

/// Reads the raw contents of an installed locale file so the frontend can
/// apply it.
///
/// Frontend API: invoke `apply_locale` with the language `lang` (locale
/// code); resolves with the file contents as a JSON string.
///
/// # Errors
///
/// Returns an error string when the locale is not installed or the file
/// cannot be read.
#[tauri::command]
pub fn apply_locale(app: AppHandle, lang: &str) -> Result<String, String> {
    let dir = locales_dir(&app)?;
    let path = dir.join(format!("{}.json", lang));
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Locale {} is not installed: {}", lang, e))
}

/// Lists the available languages with their installation status.
///
/// Frontend API: invoke `list_locales` with no arguments; resolves with an
/// array of [`LocaleInfo`] (the `languages` field of a [`LocaleStatus`]).
///
/// # Errors
///
/// Returns an error string when the app data directory cannot be resolved.
#[tauri::command]
pub async fn list_locales(app: AppHandle) -> Result<Vec<LocaleInfo>, String> {
    check_locales(app).await.map(|status| status.languages)
}
