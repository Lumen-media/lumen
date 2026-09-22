use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::{Store, StoreExt};

/// Media types that can be remapped to folders elsewhere on the machine.
pub const MEDIA_TYPES: [&str; 8] = [
    "lyrics",
    "video",
    "image",
    "text",
    "audio",
    "files",
    "themes",
    "presentation",
];

const STORE_FILE: &str = "storage-settings.json";
const KEY_MEDIA_FOLDERS: &str = "mediaFolders";
const KEY_PENDING_MIGRATION: &str = "pendingMigration";

struct ResolvedPaths {
    base: PathBuf,
    media: HashMap<String, PathBuf>,
}

static RESOLVED: RwLock<Option<ResolvedPaths>> = RwLock::new(None);

pub fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not resolve executable directory".to_string())
}

/// Base directory for application data (database, config, cache, notes).
/// Always derived from the executable directory so data lives alongside the app.
pub fn app_base_dir() -> Result<PathBuf, String> {
    Ok(exe_dir()?.join("lumen"))
}

pub fn db_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("lumen.db"))
}

/// Resolved folder for a media type, honoring the user override when set.
pub fn media_dir(media_type: &str) -> Result<PathBuf, String> {
    let guard = RESOLVED
        .read()
        .map_err(|e| format!("failed to read resolved paths: {e}"))?;
    guard
        .as_ref()
        .and_then(|r| r.media.get(media_type))
        .cloned()
        .ok_or_else(|| format!("media folders are not initialized (missing type: {media_type})"))
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingMigration {
    media_type: String,
    from: String,
    to: String,
    mode: String,
    prev: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPathsPayload {
    pub base: String,
    pub db: String,
    pub media: HashMap<String, String>,
}

fn load_store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>, String> {
    app.store(STORE_FILE).map_err(|e| e.to_string())
}

fn read_media_folders<R: Runtime>(store: &Store<R>) -> HashMap<String, Option<String>> {
    let value = store.get(KEY_MEDIA_FOLDERS);
    let Some(value) = value else {
        return HashMap::new();
    };
    let Some(folders) = value.as_object() else {
        return HashMap::new();
    };
    folders
        .iter()
        .map(|(key, value)| {
            let path = value
                .as_str()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            (key.clone(), path)
        })
        .collect()
}

fn write_media_folders<R: Runtime>(store: &Store<R>, folders: &HashMap<String, Option<String>>) {
    let map: serde_json::Map<String, serde_json::Value> = folders
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                value
                    .clone()
                    .map_or(serde_json::Value::Null, serde_json::Value::String),
            )
        })
        .collect();
    store.set(KEY_MEDIA_FOLDERS, serde_json::Value::Object(map));
}

fn has_entries(path: &Path) -> Result<bool, String> {
    let mut entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    Ok(entries.next().is_some())
}

fn validate_target(media_type: &str, target: &Path) -> Result<(), String> {
    if !target.is_absolute() {
        return Err("folder path must be absolute".to_string());
    }
    let guard = RESOLVED
        .read()
        .map_err(|e| format!("failed to read resolved paths: {e}"))?;
    let resolved = guard
        .as_ref()
        .ok_or_else(|| "paths are not initialized".to_string())?;
    for (other, resolved_path) in &resolved.media {
        if other == media_type {
            continue;
        }
        if target == resolved_path {
            return Err(format!("folder is already used by media type \"{other}\""));
        }
        if target.starts_with(resolved_path) {
            return Err(format!("folder contains the \"{other}\" media folder"));
        }
        if resolved_path.starts_with(target) {
            return Err(format!("folder is inside the \"{other}\" media folder"));
        }
    }
    Ok(())
}

fn resolve_media_map<R: Runtime>(store: &Store<R>, base: &Path) -> HashMap<String, PathBuf> {
    let overrides = read_media_folders(store);
    let mut media = HashMap::new();
    for media_type in MEDIA_TYPES {
        let folder = overrides
            .get(media_type)
            .and_then(|value| value.clone())
            .map(PathBuf::from)
            .unwrap_or_else(|| base.join("files").join("media").join(media_type));
        media.insert(media_type.to_string(), folder);
    }
    media
}

/// Resolve all media folders once, honoring overrides from the settings store.
/// Runs before any database or file initialization.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let base = app_base_dir()?;
    let store = load_store(app)?;

    if let Some(pending) = store
        .get(KEY_PENDING_MIGRATION)
        .and_then(|value| serde_json::from_value::<PendingMigration>(value).ok())
    {
        run_pending_migration(&store, pending);
    }

    let media = resolve_media_map(&store, &base);

    let mut guard = RESOLVED
        .write()
        .map_err(|e| format!("failed to write resolved paths: {e}"))?;
    *guard = Some(ResolvedPaths { base, media });
    Ok(())
}

fn run_pending_migration<R: Runtime>(store: &Store<R>, pending: PendingMigration) {
    let from = PathBuf::from(&pending.from);
    let to = PathBuf::from(&pending.to);

    let outcome: Result<(), String> = (|| {
        if !from.exists() {
            return Ok(());
        }
        let (moved, skipped) = migrate_contents(&from, &to, &pending.mode)?;
        if pending.mode == "move" {
            let empty = fs::read_dir(&from)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if empty {
                let _ = fs::remove_dir(&from);
            }
        }
        log::info!(
            "media folder migration finished: {moved} moved, {skipped} skipped (kept in place)"
        );
        Ok(())
    })();

    match outcome {
        Ok(()) => {
            store.delete(KEY_PENDING_MIGRATION);
        }
        Err(err) => {
            log::warn!("media folder migration failed ({err}); reverting to previous value");
            let mut folders = read_media_folders(store);
            folders.insert(pending.media_type.clone(), pending.prev);
            write_media_folders(store, &folders);
            store.delete(KEY_PENDING_MIGRATION);
        }
    }

    if let Err(err) = store.save() {
        log::warn!("failed to persist storage settings: {err}");
    }
}

fn migrate_contents(from: &Path, to: &Path, mode: &str) -> Result<(usize, usize), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;

    let mut moved = 0usize;
    let mut skipped = 0usize;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        match mode {
            "copy" => moved += copy_entry(&src, &dst, &mut skipped)?,
            _ => moved += move_entry(&src, &dst, &mut skipped)?,
        }
    }
    Ok((moved, skipped))
}

fn copy_entry(src: &Path, dst: &Path, skipped: &mut usize) -> Result<usize, String> {
    if dst.exists() {
        *skipped += 1;
        return Ok(0);
    }
    let metadata = fs::metadata(src).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        let mut moved = 0;
        for child in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
            moved += copy_entry(&child.path(), &dst.join(child.file_name()), skipped)?;
        }
        Ok(moved)
    } else {
        fs::copy(src, dst).map_err(|e| e.to_string())?;
        Ok(1)
    }
}

fn move_entry(src: &Path, dst: &Path, skipped: &mut usize) -> Result<usize, String> {
    if dst.exists() {
        *skipped += 1;
        return Ok(0);
    }
    if fs::rename(src, dst).is_ok() {
        return Ok(1);
    }
    // rename fails across drives; fall back to copy + delete
    let moved = copy_entry(src, dst, skipped)?;
    remove_recursive(src)?;
    Ok(moved)
}

fn remove_recursive(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_app_paths() -> Result<AppPathsPayload, String> {
    let guard = RESOLVED
        .read()
        .map_err(|e| format!("failed to read resolved paths: {e}"))?;
    let resolved = guard
        .as_ref()
        .ok_or_else(|| "paths are not initialized".to_string())?;
    let media: HashMap<String, String> = resolved
        .media
        .iter()
        .map(|(key, value)| (key.clone(), value.to_string_lossy().into_owned()))
        .collect();
    Ok(AppPathsPayload {
        base: resolved.base.to_string_lossy().into_owned(),
        db: resolved.base.join("lumen.db").to_string_lossy().into_owned(),
        media,
    })
}

/// Set (or clear, when `path` is null) the folder override for a media type.
/// Migrates contents inline when requested, updates storage and in-memory paths,
/// and resyncs the media store immediately without requiring an app restart.
#[tauri::command]
pub async fn set_media_folder(
    app: AppHandle,
    media_type: String,
    path: Option<String>,
    migrate: Option<String>,
) -> Result<(), String> {
    if !MEDIA_TYPES.contains(&media_type.as_str()) {
        return Err(format!("unknown media type: {media_type}"));
    }

    let (current, base) = {
        let guard = RESOLVED
            .read()
            .map_err(|e| format!("failed to read resolved paths: {e}"))?;
        let resolved = guard
            .as_ref()
            .ok_or_else(|| "paths are not initialized".to_string())?;
        let current = resolved
            .media
            .get(&media_type)
            .cloned()
            .ok_or_else(|| format!("media folder not resolved for type: {media_type}"))?;
        (current, resolved.base.clone())
    };

    let target = match &path {
        Some(path) if !path.trim().is_empty() => {
            let target = PathBuf::from(path.trim());
            validate_target(&media_type, &target)?;
            target
        }
        _ => base.join("files").join("media").join(&media_type),
    };

    if target == current {
        return Ok(());
    }

    let store = load_store(&app)?;
    let mut folders = read_media_folders(&store);
    let prev = folders.get(&media_type).cloned().flatten();

    let mode = migrate.unwrap_or_default();
    let wants_migration = matches!(mode.as_str(), "move" | "copy")
        && current.is_dir()
        && has_entries(&current)?;

    if wants_migration {
        let pending = PendingMigration {
            media_type: media_type.clone(),
            from: current.to_string_lossy().into_owned(),
            to: target.to_string_lossy().into_owned(),
            mode: mode.clone(),
            prev,
        };
        store.set(
            KEY_PENDING_MIGRATION,
            serde_json::to_value(pending).map_err(|e| e.to_string())?,
        );
        let _ = store.save();

        let (moved, skipped) = migrate_contents(&current, &target, &mode)?;
        if mode == "move" {
            let empty = fs::read_dir(&current)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if empty {
                let _ = fs::remove_dir(&current);
            }
        }
        log::info!(
            "media folder inline migration finished for {media_type}: {moved} moved, {skipped} skipped"
        );
    } else {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    }

    folders.insert(media_type.clone(), path.map(|p| p.trim().to_string()));
    write_media_folders(&store, &folders);
    store.delete(KEY_PENDING_MIGRATION);
    store.save().map_err(|e| e.to_string())?;

    let new_media = resolve_media_map(&store, &base);
    {
        let mut guard = RESOLVED
            .write()
            .map_err(|e| format!("failed to write resolved paths: {e}"))?;
        if let Some(ref mut resolved) = *guard {
            resolved.media = new_media;
        } else {
            *guard = Some(ResolvedPaths {
                base,
                media: new_media,
            });
        }
    }

    let media_store = app.state::<crate::media::MediaStore>();
    crate::media::resync_media_type(&media_store, &media_type).await?;

    Ok(())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    for (_, window) in app.webview_windows() {
        let _ = window.eval("window.location.reload()");
    }
}