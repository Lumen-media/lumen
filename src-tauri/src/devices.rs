use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use local_ip_address::local_ip;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

const DEVICES_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    os TEXT NOT NULL,
    version TEXT NOT NULL,
    access_token TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    permissions_player INTEGER NOT NULL DEFAULT 1,
    permissions_lyrics INTEGER NOT NULL DEFAULT 1,
    permissions_bible INTEGER NOT NULL DEFAULT 1,
    permissions_media INTEGER NOT NULL DEFAULT 1,
    permissions_streaming INTEGER NOT NULL DEFAULT 0,
    registered_at INTEGER NOT NULL,
    last_connected_at INTEGER
)
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePermissions {
    pub player: bool,
    pub lyrics: bool,
    pub bible: bool,
    pub media: bool,
    pub streaming: bool,
}

impl Default for DevicePermissions {
    fn default() -> Self {
        Self {
            player: true,
            lyrics: true,
            bible: true,
            media: true,
            streaming: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub device_id: String,
    pub device_name: String,
    pub device_type: String,
    pub os: String,
    pub version: String,
    pub access_token: String,
    pub is_active: bool,
    pub permissions: DevicePermissions,
    pub registered_at: u64,
    pub last_connected_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationToken {
    pub token: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub is_used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAccessSettings {
    pub remote_enabled: bool,
    pub transmission_enabled: bool,
}

impl Default for RemoteAccessSettings {
    fn default() -> Self {
        Self {
            remote_enabled: true,
            transmission_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketSession {
    pub session_id: String,
    pub device_id: String,
    pub permissions: DevicePermissions,
    pub connected_at: u64,
    pub last_activity_at: u64,
    #[serde(skip)]
    pub sender: Option<UnboundedSender<Message>>,
}

pub struct DeviceState {
    pub devices: Mutex<HashMap<String, Device>>,
    pub sessions: Mutex<HashMap<String, WebSocketSession>>,
    pub pending_token: Mutex<Option<RegistrationToken>>,
    pub remote_settings: Mutex<RemoteAccessSettings>,
}

#[derive(Serialize)]
pub struct RegistrationTokenPayload {
    pub token: String,
    pub expires_at: u64,
}

#[derive(Serialize)]
pub struct AuthOkResponse {
    pub event: &'static str,
    pub session_id: String,
    pub desktop_name: String,
    pub permissions: DevicePermissions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
}

#[derive(Serialize)]
struct AuthFailResponse {
    event: &'static str,
    reason: String,
}

#[derive(Serialize)]
struct PermissionsUpdatedResponse {
    event: &'static str,
    permissions: DevicePermissions,
}

#[derive(Serialize)]
struct PermissionDeniedResponse {
    event: &'static str,
    feature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSyncEnvelope {
    pub event: String,
    #[serde(flatten)]
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegisterPayload {
    pub token: String,
    pub device_id: String,
    pub device_name: String,
    pub device_type: String,
    pub os: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthPayload {
    pub device_id: String,
    pub access_token: String,
}

#[derive(Serialize)]
struct DeviceDeactivatedResponse {
    event: &'static str,
    device_id: String,
}

pub fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn resolve_desktop_name(app: &AppHandle) -> String {
    for key in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    let app_name = app.package_info().name.trim();
    if app_name.is_empty() {
        "Lumen Desktop".to_string()
    } else {
        app_name.to_string()
    }
}

pub fn ensure_remote_access_ready(app: &AppHandle) -> Result<RemoteAccessSettings, String> {
    ensure_device_storage()?;
    ensure_devices_table()?;
    let settings = load_remote_access_settings()?;
    let devices = load_devices_from_db()?;

    let state = app.state::<DeviceState>();
    {
        let mut state_devices = state.devices.lock().map_err(|e| e.to_string())?;
        *state_devices = devices;
    }
    {
        let mut remote = state.remote_settings.lock().map_err(|e| e.to_string())?;
        *remote = settings.clone();
    }

    Ok(settings)
}

pub fn default_device_state() -> DeviceState {
    DeviceState {
        devices: Mutex::new(HashMap::new()),
        sessions: Mutex::new(HashMap::new()),
        pending_token: Mutex::new(None),
        remote_settings: Mutex::new(RemoteAccessSettings::default()),
    }
}

#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    local_ip()
        .map(|ip| ip.to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn gen_reg_token(state: State<'_, DeviceState>) -> Result<RegistrationTokenPayload, String> {
    let created_at = now_ts();
    let token = RegistrationToken {
        token: Uuid::new_v4().to_string(),
        created_at,
        expires_at: created_at + 900,
        is_used: false,
    };

    let payload = RegistrationTokenPayload {
        token: token.token.clone(),
        expires_at: token.expires_at,
    };

    let mut pending = state.pending_token.lock().map_err(|e| e.to_string())?;
    *pending = Some(token);

    Ok(payload)
}

#[tauri::command]
pub fn get_devices(state: State<'_, DeviceState>) -> Result<Vec<Device>, String> {
    let devices = state.devices.lock().map_err(|e| e.to_string())?;
    let mut values = devices.values().cloned().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        left.device_name
            .to_lowercase()
            .cmp(&right.device_name.to_lowercase())
    });
    Ok(values)
}

#[tauri::command]
pub fn get_remote_access_settings(
    state: State<'_, DeviceState>,
) -> Result<RemoteAccessSettings, String> {
    state
        .remote_settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_remote_access_settings(
    app: AppHandle,
    state: State<'_, DeviceState>,
    remote_enabled: bool,
    transmission_enabled: bool,
) -> Result<RemoteAccessSettings, String> {
    let next = RemoteAccessSettings {
        remote_enabled,
        transmission_enabled,
    };

    save_remote_access_settings(&next)?;
    {
        let mut settings = state.remote_settings.lock().map_err(|e| e.to_string())?;
        *settings = next.clone();
    }

    if !next.remote_enabled {
        close_all_external_sessions(
            &app,
            &state,
            Some("remote_disabled".to_string()),
            Some(4001),
        )?;
    }

    Ok(next)
}

#[tauri::command]
pub fn toggle_device(
    app: AppHandle,
    state: State<'_, DeviceState>,
    device_id: String,
    is_active: bool,
) -> Result<(), String> {
    let updated = set_device_active_state(&state, &device_id, is_active)?;
    if !updated.is_active {
        close_device_sessions(
            &state,
            &device_id,
            Some(auth_fail_message("not_active")?),
            Some(4005),
        )?;
    }
    let _ = app.emit("device_updated", updated);
    Ok(())
}

#[tauri::command]
pub fn update_device_permissions(
    app: AppHandle,
    state: State<'_, DeviceState>,
    device_id: String,
    permissions: DevicePermissions,
) -> Result<(), String> {
    let updated = {
        let mut devices = state.devices.lock().map_err(|e| e.to_string())?;
        let device = devices
            .get_mut(&device_id)
            .ok_or_else(|| format!("Device not found: {}", device_id))?;
        device.permissions = permissions.clone();
        update_device_in_db(device)?;
        device.clone()
    };

    notify_device_permissions_changed(&state, &device_id, permissions)?;
    let _ = app.emit("device_updated", updated);
    Ok(())
}

#[tauri::command]
pub fn remove_device(
    app: AppHandle,
    state: State<'_, DeviceState>,
    device_id: String,
) -> Result<(), String> {
    {
        let mut devices = state.devices.lock().map_err(|e| e.to_string())?;
        devices
            .remove(&device_id)
            .ok_or_else(|| format!("Device not found: {}", device_id))?;
    }

    delete_device_from_db(&device_id)?;
    close_device_sessions(
        &state,
        &device_id,
        Some(auth_fail_message("not_registered")?),
        Some(4003),
    )?;
    let _ = app.emit("device_removed", device_id);
    Ok(())
}

#[tauri::command]
pub fn broadcast_remote_event(
    state: State<'_, DeviceState>,
    envelope: RemoteSyncEnvelope,
    required_permission: Option<String>,
) -> Result<(), String> {
    broadcast_remote_event_inner(&state, &envelope, required_permission.as_deref())
}

pub fn register_device(
    app: &AppHandle,
    state: &State<'_, DeviceState>,
    payload: RegisterPayload,
    sender: UnboundedSender<Message>,
) -> Result<AuthOkResponse, String> {
    let now = now_ts();
    {
        let mut pending = state.pending_token.lock().map_err(|e| e.to_string())?;
        let token = pending
            .as_mut()
            .ok_or_else(|| "token_expired".to_string())?;

        if token.expires_at < now {
            return Err("token_expired".to_string());
        }

        if token.is_used {
            return Err("token_used".to_string());
        }

        if token.token != payload.token {
            return Err("token_expired".to_string());
        }

        token.is_used = true;
    }

    let existing = {
        let devices = state.devices.lock().map_err(|e| e.to_string())?;
        devices.get(&payload.device_id).cloned()
    };

    let device = Device {
        device_id: payload.device_id,
        device_name: payload.device_name,
        device_type: payload.device_type,
        os: payload.os,
        version: payload.version,
        access_token: Uuid::new_v4().to_string(),
        is_active: true,
        permissions: existing
            .as_ref()
            .map(|d| d.permissions.clone())
            .unwrap_or_default(),
        registered_at: existing.as_ref().map(|d| d.registered_at).unwrap_or(now),
        last_connected_at: Some(now),
    };

    insert_or_replace_device_in_db(&device)?;

    {
        let mut devices = state.devices.lock().map_err(|e| e.to_string())?;
        devices.insert(device.device_id.clone(), device.clone());
    }

    let session_id = create_or_replace_session(
        state,
        device.device_id.clone(),
        device.permissions.clone(),
        sender,
    )?;

    let event_name = if existing.is_some() {
        "device_updated"
    } else {
        "device_registered"
    };
    let _ = app.emit(event_name, device.clone());
    let _ = app.emit("device_authenticated", device.clone());

    Ok(AuthOkResponse {
        event: "auth_ok",
        session_id,
        desktop_name: resolve_desktop_name(app),
        permissions: device.permissions.clone(),
        access_token: Some(device.access_token),
    })
}

pub fn authenticate_device(
    app: &AppHandle,
    state: &State<'_, DeviceState>,
    payload: AuthPayload,
    sender: UnboundedSender<Message>,
) -> Result<AuthOkResponse, String> {
    let settings = state
        .remote_settings
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if !settings.remote_enabled {
        return Err("unauthorized".to_string());
    }

    let device = {
        let devices = state.devices.lock().map_err(|e| e.to_string())?;
        devices
            .get(&payload.device_id)
            .cloned()
            .ok_or_else(|| "not_registered".to_string())?
    };

    if device.access_token != payload.access_token {
        return Err("invalid_token".to_string());
    }

    if !device.is_active {
        return Err("not_active".to_string());
    }

    let mut updated_device = device.clone();
    updated_device.last_connected_at = Some(now_ts());
    update_device_in_db(&updated_device)?;

    {
        let mut devices = state.devices.lock().map_err(|e| e.to_string())?;
        devices.insert(updated_device.device_id.clone(), updated_device.clone());
    }

    let session_id = create_or_replace_session(
        state,
        updated_device.device_id.clone(),
        updated_device.permissions.clone(),
        sender,
    )?;

    let _ = app.emit("device_authenticated", updated_device.clone());

    Ok(AuthOkResponse {
        event: "auth_ok",
        session_id,
        desktop_name: resolve_desktop_name(app),
        permissions: updated_device.permissions,
        access_token: None,
    })
}

pub fn deactivate_device_registration(
    app: &AppHandle,
    state: &State<'_, DeviceState>,
    device_id: &str,
) -> Result<(), String> {
    let updated = set_device_active_state(state, device_id, false)?;
    close_device_sessions(
        state,
        device_id,
        Some(auth_fail_message("not_active")?),
        Some(4005),
    )?;
    let _ = app.emit("device_updated", updated);
    Ok(())
}

pub fn touch_session(
    state: &State<'_, DeviceState>,
    session_id: &str,
) -> Result<Option<WebSocketSession>, String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(session_id) {
        session.last_activity_at = now_ts();
        return Ok(Some(session.clone()));
    }
    Ok(None)
}

pub fn remove_session(state: &State<'_, DeviceState>, session_id: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(session_id);
    Ok(())
}

pub fn is_remote_access_enabled(state: &State<'_, DeviceState>) -> Result<bool, String> {
    state
        .remote_settings
        .lock()
        .map(|settings| settings.remote_enabled)
        .map_err(|e| e.to_string())
}

pub fn auth_fail_message(reason: &str) -> Result<Message, String> {
    json_message(&AuthFailResponse {
        event: "auth_fail",
        reason: reason.to_string(),
    })
}

pub fn permission_denied_message(feature: &str) -> Result<Message, String> {
    json_message(&PermissionDeniedResponse {
        event: "permission_denied",
        feature: feature.to_string(),
    })
}

pub fn device_deactivated_message(device_id: &str) -> Result<Message, String> {
    json_message(&DeviceDeactivatedResponse {
        event: "device_deactivated",
        device_id: device_id.to_string(),
    })
}

pub fn broadcast_remote_event_inner(
    state: &State<'_, DeviceState>,
    envelope: &RemoteSyncEnvelope,
    required_permission: Option<&str>,
) -> Result<(), String> {
    let message = json_message(envelope)?;
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;

    for session in sessions.values() {
        if let Some(permission) = required_permission {
            if !is_permission_allowed(&session.permissions, permission) {
                continue;
            }
        }

        if let Some(sender) = &session.sender {
            let _ = sender.send(message.clone());
        }
    }

    Ok(())
}

fn notify_device_permissions_changed(
    state: &State<'_, DeviceState>,
    device_id: &str,
    permissions: DevicePermissions,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let message = json_message(&PermissionsUpdatedResponse {
        event: "permissions_updated",
        permissions,
    })?;

    for session in sessions.values() {
        if session.device_id == device_id {
            if let Some(sender) = &session.sender {
                let _ = sender.send(message.clone());
            }
        }
    }

    Ok(())
}

fn set_device_active_state(
    state: &State<'_, DeviceState>,
    device_id: &str,
    is_active: bool,
) -> Result<Device, String> {
    let mut devices = state.devices.lock().map_err(|e| e.to_string())?;
    let device = devices
        .get_mut(device_id)
        .ok_or_else(|| format!("Device not found: {}", device_id))?;
    device.is_active = is_active;
    update_device_in_db(device)?;
    Ok(device.clone())
}

fn close_all_external_sessions(
    app: &AppHandle,
    state: &State<'_, DeviceState>,
    auth_fail_reason: Option<String>,
    close_code: Option<u16>,
) -> Result<(), String> {
    let device_ids = {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions
            .values()
            .map(|session| session.device_id.clone())
            .collect::<Vec<_>>()
    };

    for device_id in device_ids {
        close_device_sessions(
            state,
            &device_id,
            auth_fail_reason
                .as_deref()
                .map(auth_fail_message)
                .transpose()?,
            close_code,
        )?;
    }

    let _ = app.emit("remote_access_disabled", ());
    Ok(())
}

fn close_device_sessions(
    state: &State<'_, DeviceState>,
    device_id: &str,
    auth_fail_message: Option<Message>,
    close_code: Option<u16>,
) -> Result<(), String> {
    let session_ids = {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions
            .iter()
            .filter_map(|(session_id, session)| {
                if session.device_id == device_id {
                    Some(session_id.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    };

    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session_id in session_ids {
        if let Some(session) = sessions.remove(&session_id) {
            if let Some(sender) = session.sender {
                if let Some(message) = auth_fail_message.clone() {
                    let _ = sender.send(message);
                }
                if let Some(code) = close_code {
                    let _ = sender.send(close_message(code));
                }
            }
        }
    }

    Ok(())
}

fn create_or_replace_session(
    state: &State<'_, DeviceState>,
    device_id: String,
    permissions: DevicePermissions,
    sender: UnboundedSender<Message>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let session = WebSocketSession {
        session_id: session_id.clone(),
        device_id,
        permissions,
        connected_at: now_ts(),
        last_activity_at: now_ts(),
        sender: Some(sender),
    };

    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.insert(session_id.clone(), session);
    Ok(session_id)
}

fn ensure_device_storage() -> Result<(), String> {
    let base_dir = app_base_dir()?;
    fs::create_dir_all(base_dir.join("config")).map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_devices_table() -> Result<(), String> {
    let connection = open_device_db()?;
    connection
        .execute(DEVICES_TABLE_SQL, [])
        .map_err(|e| e.to_string())?;
    ensure_devices_schema(&connection)?;
    Ok(())
}

fn ensure_devices_schema(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(devices)")
        .map_err(|e| e.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;

    let mut has_permissions_streaming = false;
    for column in columns {
        let column = column.map_err(|e| e.to_string())?;
        if column == "permissions_streaming" {
            has_permissions_streaming = true;
            break;
        }
    }

    if !has_permissions_streaming {
        connection
            .execute(
                "ALTER TABLE devices ADD COLUMN permissions_streaming INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn open_device_db() -> Result<Connection, String> {
    let path = device_db_path()?;
    Connection::open(path).map_err(|e| e.to_string())
}

fn app_base_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "Could not resolve executable directory".to_string())?;
    Ok(parent.join("lumen"))
}

fn device_db_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("lumen.db"))
}

fn remote_settings_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("config").join("remote-access.json"))
}

fn load_remote_access_settings() -> Result<RemoteAccessSettings, String> {
    let path = remote_settings_path()?;
    if !path.exists() {
        let default_settings = RemoteAccessSettings::default();
        save_remote_access_settings(&default_settings)?;
        return Ok(default_settings);
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn save_remote_access_settings(settings: &RemoteAccessSettings) -> Result<(), String> {
    let path = remote_settings_path()?;
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn load_devices_from_db() -> Result<HashMap<String, Device>, String> {
    let connection = open_device_db()?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                device_id,
                device_name,
                device_type,
                os,
                version,
                access_token,
                is_active,
                permissions_player,
                permissions_lyrics,
                permissions_bible,
                permissions_media,
                permissions_streaming,
                registered_at,
                last_connected_at
            FROM devices
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Device {
                device_id: row.get(0)?,
                device_name: row.get(1)?,
                device_type: row.get(2)?,
                os: row.get(3)?,
                version: row.get(4)?,
                access_token: row.get(5)?,
                is_active: row.get::<_, i64>(6)? == 1,
                permissions: DevicePermissions {
                    player: row.get::<_, i64>(7)? == 1,
                    lyrics: row.get::<_, i64>(8)? == 1,
                    bible: row.get::<_, i64>(9)? == 1,
                    media: row.get::<_, i64>(10)? == 1,
                    streaming: row.get::<_, i64>(11)? == 1,
                },
                registered_at: row.get::<_, u64>(12)?,
                last_connected_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut devices = HashMap::new();
    for row in rows {
        let device = row.map_err(|e| e.to_string())?;
        devices.insert(device.device_id.clone(), device);
    }

    Ok(devices)
}

fn insert_or_replace_device_in_db(device: &Device) -> Result<(), String> {
    let connection = open_device_db()?;
    connection
        .execute(
            r#"
            INSERT OR REPLACE INTO devices (
                device_id,
                device_name,
                device_type,
                os,
                version,
                access_token,
                is_active,
                permissions_player,
                permissions_lyrics,
                permissions_bible,
                permissions_media,
                permissions_streaming,
                registered_at,
                last_connected_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            params![
                device.device_id,
                device.device_name,
                device.device_type,
                device.os,
                device.version,
                device.access_token,
                i64::from(device.is_active),
                i64::from(device.permissions.player),
                i64::from(device.permissions.lyrics),
                i64::from(device.permissions.bible),
                i64::from(device.permissions.media),
                i64::from(device.permissions.streaming),
                device.registered_at,
                device.last_connected_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn update_device_in_db(device: &Device) -> Result<(), String> {
    insert_or_replace_device_in_db(device)
}

fn delete_device_from_db(device_id: &str) -> Result<(), String> {
    let connection = open_device_db()?;
    connection
        .execute("DELETE FROM devices WHERE device_id = ?1", [device_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn json_message<T: Serialize>(payload: &T) -> Result<Message, String> {
    serde_json::to_string(payload)
        .map(Message::Text)
        .map_err(|e| e.to_string())
}

fn close_message(code: u16) -> Message {
    Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
        code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Library(code),
        reason: "".into(),
    }))
}

pub fn map_event_permission(event: &str) -> Option<&'static str> {
    match event {
        "play_pause" | "stop" | "next" | "previous" | "mute" | "set_volume" | "seek"
        | "set_loop" | "load_url" | "metadata" | "progress" => Some("player"),
        "load_lyric" => Some("lyrics"),
        "subscribe_stream"
        | "unsubscribe_stream"
        | "webrtc_answer"
        | "webrtc_ice_candidate"
        | "mobile_offer" => Some("streaming"),
        _ => None,
    }
}

pub fn is_permission_allowed(permissions: &DevicePermissions, permission: &str) -> bool {
    match permission {
        "player" => permissions.player,
        "lyrics" => permissions.lyrics,
        "bible" => permissions.bible,
        "media" => permissions.media,
        "streaming" => permissions.streaming,
        _ => false,
    }
}
