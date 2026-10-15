//! User profiles: per-user appearance settings persisted as JSON.
//!
//! Each profile is one pretty-printed `<id>.json` file under
//! `<base>/config/profiles/`, so profiles can be backed up, copied or synced
//! by the user without going through the app. Listings skip files that do
//! not parse instead of failing the whole read.

use serde::{Deserialize, Serialize};

use crate::remote;

/// Creates the profile directory when missing and returns its path.
fn profiles_dir() -> Result<std::path::PathBuf, String> {
    let dir = remote::app_base_dir()?.join("config").join("profiles");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A saved user profile, stored as one JSON file per profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Stable identifier, also used as the profile's file name.
    pub id: String,
    /// Display name chosen by the user.
    pub name: String,
    /// UI locale pinned by the profile, when set.
    pub language: Option<String>,
    /// Color scheme, `"dark"` or `"light"`.
    pub color_mode: String,
    /// Accent color identifier from the theme presets.
    pub accent_id: String,
    /// Background used when a media item brings none of its own.
    pub default_background: Option<DefaultBackground>,
    /// Creation time in Unix milliseconds, used to order listings.
    pub created_at: i64,
}

/// Reference to a background asset used when nothing else is set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBackground {
    /// Kind of background (`"theme"`, `"image"` or `"video"`), serialized as `type`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Path or URL of the background asset.
    pub src: String,
    /// Display name of the asset.
    pub name: String,
}

/// Returns every valid profile, oldest first.
///
/// Files that cannot be read abort the listing, while files that do not
/// deserialize are skipped silently so one corrupt profile does not hide the
/// rest.
///
/// # Errors
///
/// Returns an error when the profile directory cannot be created, cannot be
/// listed, or one of the profile files cannot be read.
#[tauri::command]
pub async fn profile_list() -> Result<Vec<Profile>, String> {
    let dir = profiles_dir()?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut profiles: Vec<Profile> = Vec::new();

    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.ends_with(".json") {
            continue;
        }

        let path = entry.path();
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        match serde_json::from_str::<Profile>(&raw) {
            Ok(profile) => profiles.push(profile),
            Err(_) => {}
        }
    }

    profiles.sort_by_key(|p| p.created_at);
    Ok(profiles)
}

/// Persists a profile as `<id>.json`, creating or overwriting the file.
///
/// # Errors
///
/// Returns an error when the profile directory cannot be created, the
/// profile cannot be serialized, or the file cannot be written.
#[tauri::command]
pub async fn profile_save(profile: Profile) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{}.json", profile.id));
    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes the profile file for `id`.
///
/// Removing a profile that no longer exists succeeds silently, so the
/// frontend can enforce deletions without a prior existence check.
///
/// # Errors
///
/// Returns an error when the file exists but cannot be removed.
#[tauri::command]
pub async fn profile_delete(id: String) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}