pub mod dev_server;
pub mod install;
pub mod manifest;
pub mod net;
pub mod protocol;
pub mod registry;
pub mod themes;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use manifest::ModuleManifest;
use registry::Registry;

use self::install::Installer;

pub struct ModuleRuntime {
    pub modules_dir: PathBuf,
    pub registry: Arc<Mutex<Registry>>,
    pub http_client: Client,
    pub manifest_cache: Mutex<HashMap<String, ModuleManifest>>,
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
            manifest_cache: Mutex::new(HashMap::new()),
        })
    }

    fn cached_manifest(&self, module_id: &str, path: &std::path::Path) -> Result<ModuleManifest, String> {
        let mut cache = self.manifest_cache.lock().map_err(|e| e.to_string())?;
        if let Some(manifest) = cache.get(module_id) {
            return Ok(manifest.clone());
        }
        let manifest = manifest::load_manifest(path)?;
        cache.insert(module_id.to_string(), manifest.clone());
        Ok(manifest)
    }

    fn invalidate_manifest_cache(&self, module_id: &str) {
        if let Ok(mut cache) = self.manifest_cache.lock() {
            cache.remove(module_id);
        }
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
        match runtime.cached_manifest(&entry.id, &entry.path) {
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

    let installed = InstalledModule {
        manifest,
        source: source.into(),
        enabled: true,
    };

    runtime.invalidate_manifest_cache(&installed.manifest.id);

    let _ = app.emit("module:installed", &installed);

    Ok(installed)
}

#[tauri::command]
pub fn module_get(app: AppHandle, id: String) -> Result<Option<InstalledModule>, String> {
    let runtime = app.state::<ModuleRuntime>();
    let reg = runtime.registry.lock().map_err(|e| e.to_string())?;
    let entry = reg.get(&id).map_err(|e| e.to_string())?;

    let Some(entry) = entry else {
        return Ok(None);
    };

    let manifest = runtime.cached_manifest(&id, &entry.path)?;
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
    reg.set_enabled(&id, false).map_err(|e| e.to_string())?;

    let _ = app.emit("module:disabled", &id);

    Ok(())
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

    reg.remove(&id).map_err(|e| e.to_string())?;

    drop(reg);

    runtime.invalidate_manifest_cache(&id);

    let _ = app.emit("module:uninstalled", &id);

    Ok(())
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

// ── SQLite commands ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct Migration {
    pub version: i64,
    pub up: String,
}

/// Holds cached SQLite connections per module so each `exec`/`query`/`migrate`
/// call reuses the same connection instead of opening a new one every time.
/// Eliminates the overhead of `rusqlite::Connection::open()` + PRAGMA setup
/// on every Tauri IPC call.
pub struct SqliteConnectionCache {
    connections: Mutex<HashMap<String, rusqlite::Connection>>,
}

impl SqliteConnectionCache {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

/// Runs `f` against the cached (or newly-opened) SQLite connection for `module_id`.
/// The Mutex lock is held for the duration of the operation, serializing access
/// per module. This is safe because Tauri commands for a single module naturally
/// queue up — there is no concurrent write contention.
fn with_sqlite_conn<T>(
    cache: &SqliteConnectionCache,
    app: &AppHandle,
    module_id: &str,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut map = cache.connections.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    if !map.contains_key(module_id) {
        let path = module_data_sqlite_path(app, module_id)?;
        let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
        map.insert(module_id.to_string(), conn);
    }
    let conn = map.get(module_id).ok_or("connection not found")?;
    f(conn)
}

fn module_data_sqlite_path(app: &AppHandle, module_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("modules")
        .join(module_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("data.sqlite"))
}

#[tauri::command]
pub fn module_data_sqlite_open(
    app: AppHandle,
    state: tauri::State<'_, SqliteConnectionCache>,
    module_id: String,
) -> Result<(), String> {
    with_sqlite_conn(&state, &app, &module_id, |_| Ok(()))
}

fn params_to_rusqlite(params: &[serde_json::Value]) -> Vec<Box<dyn rusqlite::types::ToSql>> {
    params
        .iter()
        .map(|v| match v {
            serde_json::Value::Null => Box::new(rusqlite::types::Null) as Box<dyn rusqlite::types::ToSql>,
            serde_json::Value::Bool(b) => Box::new(*b) as Box<dyn rusqlite::types::ToSql>,
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Box::new(i) as Box<dyn rusqlite::types::ToSql>
                } else if let Some(f) = n.as_f64() {
                    Box::new(f) as Box<dyn rusqlite::types::ToSql>
                } else {
                    Box::new(n.to_string()) as Box<dyn rusqlite::types::ToSql>
                }
            }
            serde_json::Value::String(s) => Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>,
            serde_json::Value::Array(a) => {
                Box::new(serde_json::to_string(a).unwrap_or_default())
                    as Box<dyn rusqlite::types::ToSql>
            }
            serde_json::Value::Object(o) => {
                Box::new(serde_json::to_string(o).unwrap_or_default())
                    as Box<dyn rusqlite::types::ToSql>
            }
        })
        .collect()
}

#[tauri::command]
pub fn module_data_sqlite_exec(
    app: AppHandle,
    state: tauri::State<'_, SqliteConnectionCache>,
    module_id: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<(), String> {
    with_sqlite_conn(&state, &app, &module_id, |conn| {
        let rusqlite_params = params_to_rusqlite(&params);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            rusqlite_params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn module_data_sqlite_query(
    app: AppHandle,
    state: tauri::State<'_, SqliteConnectionCache>,
    module_id: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    with_sqlite_conn(&state, &app, &module_id, |conn| {
        let rusqlite_params = params_to_rusqlite(&params);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            rusqlite_params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let col_count = stmt.column_count();
        let col_names: Vec<String> = (0..col_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut map = serde_json::Map::new();
                for (i, name) in col_names.iter().enumerate() {
                    let value = row_to_json(row, i);
                    map.insert(name.clone(), value);
                }
                Ok(serde_json::Value::Object(map))
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    })
}

fn row_to_json(row: &rusqlite::Row<'_>, i: usize) -> serde_json::Value {
    use rusqlite::types::ValueRef;
    match row.get_ref(i) {
        Ok(ValueRef::Null) => serde_json::Value::Null,
        Ok(ValueRef::Integer(v)) => serde_json::Value::Number(v.into()),
        Ok(ValueRef::Real(v)) => {
            if let Some(n) = serde_json::Number::from_f64(v) {
                serde_json::Value::Number(n)
            } else {
                serde_json::Value::Null
            }
        }
        Ok(ValueRef::Text(v)) => {
            let s = String::from_utf8_lossy(v).to_string();
            serde_json::Value::String(s)
        }
        Ok(ValueRef::Blob(v)) => serde_json::Value::String(base64_encode(v)),
        Err(_) => serde_json::Value::Null,
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[tauri::command]
pub fn module_data_sqlite_migrate(
    app: AppHandle,
    state: tauri::State<'_, SqliteConnectionCache>,
    module_id: String,
    versions: Vec<Migration>,
) -> Result<(), String> {
    with_sqlite_conn(&state, &app, &module_id, |conn| {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
        )
        .map_err(|e| e.to_string())?;

        for migration in &versions {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM _migrations WHERE version = ?",
                    [migration.version],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            if exists {
                continue;
            }

            conn.execute_batch(&migration.up)
                .map_err(|e| format!("migration v{} failed: {}", migration.version, e))?;

            conn.execute(
                "INSERT INTO _migrations (version) VALUES (?)",
                [migration.version],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    })
}

#[tauri::command]
pub fn module_data_sqlite_close(
    state: tauri::State<'_, SqliteConnectionCache>,
    module_id: String,
) -> Result<(), String> {
    let mut map = state.connections.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
    map.remove(&module_id);
    Ok(())
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

pub(crate) fn app_base_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "could not resolve executable directory".to_string())?;
    Ok(parent.join("lumen"))
}
