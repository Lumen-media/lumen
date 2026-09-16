use serde::{Deserialize, Serialize};

use crate::remote;

fn profiles_dir() -> Result<std::path::PathBuf, String> {
    let dir = remote::app_base_dir()?.join("config").join("profiles");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub language: Option<String>,
    pub color_mode: String,
    pub accent_id: String,
    pub default_background: Option<DefaultBackground>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBackground {
    #[serde(rename = "type")]
    pub kind: String,
    pub src: String,
    pub name: String,
}

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

#[tauri::command]
pub async fn profile_save(profile: Profile) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{}.json", profile.id));
    let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn profile_delete(id: String) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}