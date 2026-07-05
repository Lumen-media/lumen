pub mod dev_server;
pub mod install;
pub mod manifest;
pub mod net;
pub mod protocol;
pub mod registry;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use manifest::ModuleManifest;
use registry::Registry;

use self::install::Installer;

pub struct ModuleRuntime {
    pub modules_dir: PathBuf,
    pub registry: Arc<Mutex<Registry>>,
    pub http_client: Client,
}

impl ModuleRuntime {
    pub fn init(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("modules");

        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

        let db_path = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("lumen.sqlite");

        let registry =
            Registry::open(&db_path).map_err(|e| format!("registry open failed: {e}"))?;

        let http_client = Client::builder()
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("Lumen/0.4.0")
            .build()
            .map_err(|e| format!("failed to create HTTP client: {e}"))?;

        Ok(Self {
            modules_dir: data_dir,
            registry: Arc::new(Mutex::new(registry)),
            http_client,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct InstalledModule {
    pub manifest: ModuleManifest,
    pub source: String,
    pub enabled: bool,
}

#[tauri::command]
pub fn module_list_installed(
    app: AppHandle,
) -> Result<Vec<InstalledModule>, String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    let entries = reg.list_enabled().map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for entry in entries {
        match manifest::load_manifest(&entry.path) {
            Ok(manifest) => {
                result.push(InstalledModule {
                    manifest,
                    source: entry.source,
                    enabled: entry.enabled,
                });
            }
            Err(e) => {
                log::warn!("skipping module {}: {e}", entry.id);
            }
        }
    }
    Ok(result)
}

#[derive(Debug, Deserialize)]
pub struct InstallModuleArgs {
    pub path: String,
    #[serde(default)]
    pub dev_mode: bool,
}

#[tauri::command]
pub fn module_install(
    app: AppHandle,
    path: String,
    dev_mode: bool,
) -> Result<InstalledModule, String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    let installer = Installer::new(&runtime.modules_dir, &reg);

    let source_path = std::path::Path::new(&path);
    let manifest = installer.install_from_path(source_path, dev_mode)?;

    let source = if dev_mode {
        "dev"
    } else if source_path.extension().and_then(|e| e.to_str()) == Some("lumenpack") {
        "sideload"
    } else {
        "sideload"
    };

    Ok(InstalledModule {
        manifest,
        source: source.into(),
        enabled: true,
    })
}

#[tauri::command]
pub fn module_get(app: AppHandle, id: String) -> Result<Option<InstalledModule>, String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    let entry = reg.get(&id).map_err(|e| e.to_string())?;

    let Some(entry) = entry else {
        return Ok(None);
    };

    let manifest = manifest::load_manifest(&entry.path)?;
    Ok(Some(InstalledModule {
        manifest,
        source: entry.source,
        enabled: entry.enabled,
    }))
}

#[tauri::command]
pub fn module_enable(app: AppHandle, id: String) -> Result<(), String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    reg.set_enabled(&id, true).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_disable(app: AppHandle, id: String) -> Result<(), String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    reg.set_enabled(&id, false).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;

    let entry = reg.get(&id).map_err(|e| e.to_string())?;
    if let Some(entry) = entry {
        if entry.source != "dev" && entry.path.exists() {
            std::fs::remove_dir_all(&entry.path)
                .map_err(|e| format!("failed to remove module dir: {e}"))?;
        }
    }

    reg.remove(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_data_json_load(
    app: AppHandle,
    module_id: String,
) -> Result<serde_json::Value, String> {
    let data_path = module_data_json_path(&app, &module_id)?;
    if !data_path.exists() {
        return Ok(serde_json::Value::Object(Default::default()));
    }
    let content = std::fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_data_json_save(
    app: AppHandle,
    module_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let data_path = module_data_json_path(&app, &module_id)?;
    let content = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&data_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_data_json_set(
    app: AppHandle,
    module_id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let data_path = module_data_json_path(&app, &module_id)?;
    let mut data: serde_json::Map<String, serde_json::Value> = if data_path.exists() {
        let content = std::fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        Default::default()
    };
    data.insert(key, value);
    let content =
        serde_json::to_string_pretty(&serde_json::Value::Object(data)).map_err(|e| e.to_string())?;
    std::fs::write(&data_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_data_json_delete(
    app: AppHandle,
    module_id: String,
    key: String,
) -> Result<(), String> {
    let data_path = module_data_json_path(&app, &module_id)?;
    if !data_path.exists() {
        return Ok(());
    }
    let content = std::fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
    let mut data: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    data.remove(&key);
    let content =
        serde_json::to_string_pretty(&serde_json::Value::Object(data)).map_err(|e| e.to_string())?;
    std::fs::write(&data_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_fs_read(app: AppHandle, module_id: String, path: String) -> Result<Vec<u8>, String> {
    let full = scoped_module_path(&app, &module_id, &path)?;
    std::fs::read(&full).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_fs_write(
    app: AppHandle,
    module_id: String,
    path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let full = scoped_module_path(&app, &module_id, &path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn module_fs_exists(app: AppHandle, module_id: String, path: String) -> Result<bool, String> {
    let full = scoped_module_path(&app, &module_id, &path)?;
    Ok(full.exists())
}

#[tauri::command]
pub fn module_fs_list(
    app: AppHandle,
    module_id: String,
    path: String,
) -> Result<Vec<String>, String> {
    let full = scoped_module_path(&app, &module_id, &path)?;
    let entries = std::fs::read_dir(&full).map_err(|e| e.to_string())?;
    let names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    Ok(names)
}

#[tauri::command]
pub fn module_fs_remove(
    app: AppHandle,
    module_id: String,
    path: String,
) -> Result<(), String> {
    let full = scoped_module_path(&app, &module_id, &path)?;
    if full.is_dir() {
        std::fs::remove_dir_all(&full).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&full).map_err(|e| e.to_string())
    }
}

fn module_data_json_path(app: &AppHandle, module_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("modules")
        .join(module_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("data.json"))
}

fn scoped_module_path(
    app: &AppHandle,
    module_id: &str,
    relative: &str,
) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("modules")
        .join(module_id);

    let full = base.join(relative);

    if !full.starts_with(&base) {
        return Err("path traversal attempt blocked".into());
    }

    Ok(full)
}
