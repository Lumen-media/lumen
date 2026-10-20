//! Device pairing and remote-control session management.
//!
//! Remote clients (phones/tablets) connect to the local WebSocket server,
//! pair with the desktop by presenting a short-lived registration token, and
//! then receive permission-gated player, lyrics, streaming and chat events.
//! Registered devices and their permissions are persisted in the app's SQLite
//! database (`lumen.db`) so they survive restarts; the pairing token itself
//! is held only in memory and expires 15 minutes after generation.
//!
//! The Tauri commands in this module form the frontend's device-management
//! API (list devices, toggle them, edit permissions, configure remote
//! access), while the free functions are called by the WebSocket server when
//! a client registers, authenticates or sends events.

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
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

/// `CREATE TABLE` statement for the `devices` table, executed idempotently
/// on startup. Columns mirror the fields of [`Device`]; the `permissions_*`
/// columns store a [`DevicePermissions`] set as integers.
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
    permissions_chat INTEGER NOT NULL DEFAULT 0,
    permissions_presentation INTEGER NOT NULL DEFAULT 0,
    registered_at INTEGER NOT NULL,
    last_connected_at INTEGER
)
"#;

/// Feature flags that gate which remote-control events a device may send or
/// receive. Enforced for every WebSocket event through
/// [`is_permission_allowed`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePermissions {
    /// Playback control: play/pause, stop, next/previous, mute, volume, seek,
    /// loop, URL loading, metadata and progress.
    pub player: bool,
    /// Loading and displaying lyric files.
    pub lyrics: bool,
    /// Controlling the Bible view.
    pub bible: bool,
    /// Controlling media playback.
    pub media: bool,
    /// Subscribing to or publishing WebRTC audio/video streams.
    pub streaming: bool,
    /// Participating in the live chat: send, files, history, reactions,
    /// typing and read markers.
    pub chat: bool,
    /// Controlling the presentation stage: slide next/prev/goto, blackout and
    /// wallpaper.
    pub presentation: bool,
}

impl Default for DevicePermissions {
    fn default() -> Self {
        Self {
            player: true,
            lyrics: true,
            bible: true,
            media: true,
            streaming: false,
            chat: false,
            presentation: false,
        }
    }
}

/// A paired remote-control client, persisted in the `devices` table and kept
/// mirrored in [`DeviceState::devices`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    /// Stable identifier chosen by the client; primary key in the database.
    pub device_id: String,
    /// Human-readable name shown in the desktop's device list.
    pub device_name: String,
    /// Coarse client kind (for example phone or tablet) reported at
    /// registration.
    pub device_type: String,
    /// Operating system string reported by the client at registration.
    pub os: String,
    /// App version reported by the client at registration.
    pub version: String,
    /// Secret issued by the desktop on registration; required on every
    /// subsequent authentication.
    pub access_token: String,
    /// Whether the device is currently allowed to connect; toggled from the
    /// desktop UI.
    pub is_active: bool,
    /// Per-feature access flags enforced for every event from this device.
    pub permissions: DevicePermissions,
    /// Unix timestamp (seconds) of the original pairing; preserved when the
    /// device re-registers.
    pub registered_at: u64,
    /// Unix timestamp (seconds) of the most recent successful authentication,
    /// if the device has connected before.
    pub last_connected_at: Option<u64>,
}

/// A single-use pairing credential handed to the user (for example as a QR
/// code) so a remote client can register. Held only in memory; generating a
/// new token replaces any previous one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationToken {
    /// Opaque UUID v4 string the client must present in its `register`
    /// message.
    pub token: String,
    /// Unix timestamp (seconds) at which the token was generated.
    pub created_at: u64,
    /// Unix timestamp (seconds) after which the token is rejected.
    pub expires_at: u64,
    /// Marks the token as consumed so it cannot pair a second device.
    pub is_used: bool,
}

/// User-facing switches for remote control, persisted at
/// `config/remote-access.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAccessSettings {
    /// Master switch. When false, new WebSocket connections are rejected and
    /// every live external session is closed.
    pub remote_enabled: bool,
    /// Whether A/V transmission (streaming) is allowed while remote access is
    /// enabled.
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

/// An authenticated WebSocket connection bound to a registered device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketSession {
    /// Random identifier for this connection; also used as the streaming
    /// session key.
    pub session_id: String,
    /// The registered device that owns this connection.
    pub device_id: String,
    /// Permission snapshot taken at session creation; the client is notified
    /// of later changes via the `permissions_updated` frame.
    pub permissions: DevicePermissions,
    /// Unix timestamp (seconds) when the session was established.
    pub connected_at: u64,
    /// Unix timestamp (seconds) of the last message received; refreshed by
    /// [`touch_session`].
    pub last_activity_at: u64,
    /// Channel half used to enqueue outbound WebSocket messages; excluded
    /// from serialization.
    #[serde(skip)]
    pub sender: Option<UnboundedSender<Message>>,
}

/// Tauri-managed application state holding the in-memory mirror of the device
/// database plus live session bookkeeping.
pub struct DeviceState {
    /// Registered devices keyed by device id, kept in sync with the
    /// `devices` table.
    pub devices: Mutex<HashMap<String, Device>>,
    /// Live WebSocket sessions keyed by session id.
    pub sessions: Mutex<HashMap<String, WebSocketSession>>,
    /// The one outstanding registration token, if any.
    pub pending_token: Mutex<Option<RegistrationToken>>,
    /// Cached copy of the persisted remote-access switches.
    pub remote_settings: Mutex<RemoteAccessSettings>,
}

/// Subset of [`RegistrationToken`] returned to the frontend after a token is
/// generated.
#[derive(Serialize)]
pub struct RegistrationTokenPayload {
    /// The pairing code the client must present.
    pub token: String,
    /// Unix timestamp (seconds) at which the token stops being accepted.
    pub expires_at: u64,
}

/// `auth_ok` frame sent to a client after successful registration or
/// authentication.
#[derive(Serialize)]
pub struct AuthOkResponse {
    /// Always `"auth_ok"`; discriminates the frame on the client.
    pub event: &'static str,
    /// Identifier of the newly created WebSocket session.
    pub session_id: String,
    /// Display name of this desktop, shown on the remote client.
    pub desktop_name: String,
    /// Permission set granted to this session.
    pub permissions: DevicePermissions,
    /// Newly minted access token; present only when registering (omitted when
    /// re-authenticating).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
}

/// `auth_fail` frame carrying a machine-readable failure reason.
#[derive(Serialize)]
struct AuthFailResponse {
    event: &'static str,
    reason: String,
}

/// `permissions_updated` frame pushed to a device when its permission set
/// changes.
#[derive(Serialize)]
struct PermissionsUpdatedResponse {
    event: &'static str,
    permissions: DevicePermissions,
}

/// `permission_denied` frame sent when an event requires a permission the
/// device does not hold.
#[derive(Serialize)]
struct PermissionDeniedResponse {
    event: &'static str,
    feature: String,
}

/// Generic event wrapper broadcast from the desktop to remote clients. The
/// `event` field names the action; every other JSON field is forwarded
/// untouched as the payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSyncEnvelope {
    /// Event name understood by remote clients (for example
    /// `lyrics_changed`).
    pub event: String,
    /// Event-specific data flattened into the top level of the JSON frame.
    #[serde(flatten)]
    pub payload: Value,
}

/// Correlation identifier attached by a remote client to a request it wants
/// acknowledged. Echoed back verbatim in the matching `*_op_ok` / `*_op_fail`
/// frame so the client can pair the response with its request.
#[derive(Debug, Clone, Serialize)]
pub struct OpAck {
    /// Always the ack event name (for example `queue_op_ok`).
    pub event: &'static str,
    /// Correlation id copied from the originating request.
    pub request_id: Value,
}

/// Builds a success acknowledgement frame (`{ event, request_id }`).
pub fn op_ok_message(event: &'static str, request_id: &Value) -> Result<Message, String> {
    json_message(&OpAck {
        event,
        request_id: request_id.clone(),
    })
}

/// Builds a failure acknowledgement frame (`{ event, request_id, reason }`).
pub fn op_fail_message(
    event: &'static str,
    request_id: &Value,
    reason: &str,
) -> Result<Message, String> {
    json_message(&json!({
        "event": event,
        "request_id": request_id.clone(),
        "reason": reason,
    }))
}

/// Body of the `register` WebSocket message used to pair a new device.
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterPayload {
    /// Registration token previously generated on the desktop.
    pub token: String,
    /// Client-chosen stable identifier for this device.
    pub device_id: String,
    /// Human-readable name for UI display.
    pub device_name: String,
    /// Coarse client kind (for example phone or tablet).
    pub device_type: String,
    /// Operating system reported by the client.
    pub os: String,
    /// App version reported by the client.
    pub version: String,
}

/// Body of the `auth` WebSocket message used by an already-registered device
/// to open a new session.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthPayload {
    /// Identifier the device registered with.
    pub device_id: String,
    /// Secret access token issued during registration.
    pub access_token: String,
}

/// `device_deactivated` frame sent to a client right before its registration
/// is revoked.
#[derive(Serialize)]
struct DeviceDeactivatedResponse {
    event: &'static str,
    device_id: String,
}

/// Current wall-clock time as Unix seconds.
///
/// Falls back to `0` if the system clock is earlier than the epoch.
pub fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Display name for this machine, shown in the client's "connected to" UI.
///
/// Prefers the `COMPUTERNAME` or `HOSTNAME` environment variables, then falls
/// back to the app's package name, and finally to `"Lumen Desktop"`.
pub fn resolve_desktop_name(app: &AppHandle) -> String {
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

/// Ensures the device database and config directory exist, then (re)loads
/// persisted devices and remote-access settings into [`DeviceState`].
///
/// Called once during app setup so the state is warm before any WebSocket
/// connection arrives.
///
/// # Errors
///
/// Returns an error string on filesystem, SQLite, JSON or lock failures.
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

/// Builds an empty [`DeviceState`] suitable for `app.manage(...)`.
pub fn default_device_state() -> DeviceState {
    DeviceState {
        devices: Mutex::new(HashMap::new()),
        sessions: Mutex::new(HashMap::new()),
        pending_token: Mutex::new(None),
        remote_settings: Mutex::new(RemoteAccessSettings::default()),
    }
}

/// Returns the LAN address of this machine so the frontend can render the
/// pairing URL or QR code.
///
/// Frontend API: invoke `get_local_ip` with no arguments; resolves with the
/// IP address as a string.
///
/// # Errors
///
/// Returns an error string when no local address can be determined (for
/// example when the machine is fully offline).
#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    local_ip()
        .map(|ip| ip.to_string())
        .map_err(|error| error.to_string())
}

/// Generates a fresh single-use pairing token, replacing any previous one.
///
/// Frontend API: invoke `gen_reg_token` with no arguments; resolves with
/// `{ token, expiresAt }`. The token is valid for 15 minutes and must be
/// presented by the client in its `register` WebSocket message.
///
/// # Errors
///
/// Returns an error string if the token lock is poisoned.
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

/// Lists every registered device, sorted case-insensitively by name.
///
/// Frontend API: invoke `get_devices` with no arguments; resolves with an
/// array of device objects.
///
/// # Errors
///
/// Returns an error string if the device lock is poisoned.
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

/// Reads the current remote-access switches.
///
/// Frontend API: invoke `get_remote_access_settings` with no arguments;
/// resolves with `{ remoteEnabled, transmissionEnabled }`.
///
/// # Errors
///
/// Returns an error string if the settings lock is poisoned.
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

/// Persists new remote-access switches and applies them immediately.
///
/// Frontend API: invoke `update_remote_access_settings` with the
/// `remoteEnabled` and `transmissionEnabled` booleans; resolves with the
/// updated settings. Turning remote access off closes every live external
/// session with WebSocket code `4001` and emits `remote_access_disabled` to
/// the frontend.
///
/// # Errors
///
/// Returns an error string on filesystem, serialization or lock failures.
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

/// Activates or deactivates a registered device.
///
/// Frontend API: invoke `toggle_device` with `deviceId` and `isActive`.
/// Deactivating a device immediately closes its live sessions with WebSocket
/// code `4005`. Emits `device_updated` to the frontend on success.
///
/// # Errors
///
/// Returns an error string if the device does not exist or a lock/database
/// operation fails.
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

/// Replaces the permission set of a registered device.
///
/// Frontend API: invoke `update_device_permissions` with `deviceId` and a
/// `permissions` object. The device's live sessions receive a
/// `permissions_updated` frame, and the frontend receives `device_updated`.
///
/// # Errors
///
/// Returns an error string if the device is unknown or a lock/database
/// operation fails.
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

/// Forgets a paired device entirely.
///
/// Frontend API: invoke `remove_device` with `deviceId`. The device is
/// deleted from the database, its live sessions are closed with WebSocket
/// code `4003`, and the frontend receives `device_removed`.
///
/// # Errors
///
/// Returns an error string if the device is unknown or a lock/database
/// operation fails.
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

/// Sends a JSON event to every connected device that holds the required
/// permission.
///
/// Frontend API: invoke `broadcast_remote_event` with an `envelope`
/// (`{ event, ...payload }`) and an optional `requiredPermission` (one of
/// `player`, `lyrics`, `bible`, `media`, `streaming`, `chat`,
/// `presentation`). Sessions that lack the permission are skipped silently.
///
/// # Errors
///
/// Returns an error string if the payload fails to serialize or the session
/// lock is poisoned.
#[tauri::command]
pub fn broadcast_remote_event(
    state: State<'_, DeviceState>,
    envelope: RemoteSyncEnvelope,
    required_permission: Option<String>,
) -> Result<(), String> {
    broadcast_remote_event_inner(&state, &envelope, required_permission.as_deref())
}

/// Pairs a new device (or re-pairs a known one) using the pending
/// registration token.
///
/// Consumes the token, upserts the device in memory and in SQLite, opens a
/// WebSocket session for `sender`, and notifies the frontend with
/// `device_registered` (new device) or `device_updated` (re-registration),
/// plus `device_authenticated` in both cases. Re-registering a known
/// `device_id` keeps its permissions and original `registered_at` but issues
/// a new access token.
///
/// # Errors
///
/// Returns a machine-readable reason on failure: `"token_expired"` (missing,
/// expired or mismatched token), `"token_used"`, or a database/lock error
/// string.
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

/// Validates an existing device's access token and opens a new session.
///
/// Rejects the attempt when remote access is disabled or when the device is
/// unknown, holds a stale token, or has been deactivated. On success the
/// device's `last_connected_at` is refreshed, a session is registered for
/// `sender`, and `device_authenticated` is emitted to the frontend. The
/// response omits `access_token` because the client already owns it.
///
/// # Errors
///
/// Returns one of `"unauthorized"`, `"not_registered"`, `"invalid_token"`,
/// `"not_active"`, or a database/lock error string.
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

/// Marks a device inactive and closes all of its live sessions with WebSocket
/// code `4005`, emitting `device_updated` to the frontend.
///
/// # Errors
///
/// Returns an error string if the device is unknown or a lock/database
/// operation fails.
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

/// Refreshes `last_activity_at` for a live session and returns a copy of it.
///
/// Returns `Ok(None)` when the session id is unknown (for example because it
/// was closed concurrently).
///
/// # Errors
///
/// Returns an error string if the session lock is poisoned.
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

/// Drops a session from the live-session table, if present.
///
/// # Errors
///
/// Returns an error string if the session lock is poisoned.
pub fn remove_session(state: &State<'_, DeviceState>, session_id: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(session_id);
    Ok(())
}

/// Reports whether the master remote-access switch is currently on.
///
/// # Errors
///
/// Returns an error string if the settings lock is poisoned.
pub fn is_remote_access_enabled(state: &State<'_, DeviceState>) -> Result<bool, String> {
    state
        .remote_settings
        .lock()
        .map(|settings| settings.remote_enabled)
        .map_err(|e| e.to_string())
}

/// Builds the `auth_fail` WebSocket frame carrying a machine-readable
/// `reason` (for example `"token_expired"` or `"not_active"`).
///
/// # Errors
///
/// Returns an error string if the frame fails to serialize.
pub fn auth_fail_message(reason: &str) -> Result<Message, String> {
    json_message(&AuthFailResponse {
        event: "auth_fail",
        reason: reason.to_string(),
    })
}

/// Builds the `permission_denied` frame sent when a device lacks the
/// permission required by an event.
///
/// # Errors
///
/// Returns an error string if the frame fails to serialize.
pub fn permission_denied_message(feature: &str) -> Result<Message, String> {
    json_message(&PermissionDeniedResponse {
        event: "permission_denied",
        feature: feature.to_string(),
    })
}

/// Builds the `device_deactivated` frame sent to a client right before its
/// registration is revoked.
///
/// # Errors
///
/// Returns an error string if the frame fails to serialize.
pub fn device_deactivated_message(device_id: &str) -> Result<Message, String> {
    json_message(&DeviceDeactivatedResponse {
        event: "device_deactivated",
        device_id: device_id.to_string(),
    })
}

/// Implementation shared by the [`broadcast_remote_event`] command and other
/// server-side callers: serializes `envelope` once and fans it out to every
/// session whose permissions satisfy `required_permission`. Sessions without
/// a sender or without the permission are skipped silently.
///
/// # Errors
///
/// Returns an error string if serialization fails or the session lock is
/// poisoned.
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

/// Pushes a `permissions_updated` frame to every live session of `device_id`.
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

/// Flips `is_active` for a device, persists the change, and returns the
/// updated device.
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

/// Closes the sessions of every connected device (used when remote access is
/// switched off) and emits `remote_access_disabled` to the frontend.
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

/// Removes every session of a device, optionally sending it an `auth_fail`
/// frame and a close frame with `close_code` first.
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

/// Registers a fresh session for `device_id`, keyed by a new random session
/// id, and returns that id.
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

/// Creates the app config directory if it does not exist yet.
fn ensure_device_storage() -> Result<(), String> {
    let base_dir = app_base_dir()?;
    fs::create_dir_all(base_dir.join("config")).map_err(|e| e.to_string())?;
    Ok(())
}

/// Creates the `devices` table and applies any pending schema migrations.
fn ensure_devices_table() -> Result<(), String> {
    let connection = open_device_db()?;
    connection
        .execute(DEVICES_TABLE_SQL, [])
        .map_err(|e| e.to_string())?;
    ensure_devices_schema(&connection)?;
    Ok(())
}

/// Adds the `permissions_streaming`, `permissions_chat` and
/// `permissions_presentation` columns to older databases that predate them.
fn ensure_devices_schema(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(devices)")
        .map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let has_permissions_streaming = columns.iter().any(|c| c == "permissions_streaming");

    if !has_permissions_streaming {
        connection
            .execute(
                "ALTER TABLE devices ADD COLUMN permissions_streaming INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
    }

    let has_permissions_chat = columns.iter().any(|c| c == "permissions_chat");

    if !has_permissions_chat {
        connection
            .execute(
                "ALTER TABLE devices ADD COLUMN permissions_chat INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
    }

    let has_permissions_presentation = columns
        .iter()
        .any(|c| c == "permissions_presentation");

    if !has_permissions_presentation {
        connection
            .execute(
                "ALTER TABLE devices ADD COLUMN permissions_presentation INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Opens a connection to the devices database (`lumen.db`).
fn open_device_db() -> Result<Connection, String> {
    let path = device_db_path()?;
    Connection::open(path).map_err(|e| e.to_string())
}

/// Resolves the base directory that holds the app database and config.
fn app_base_dir() -> Result<PathBuf, String> {
    crate::paths::app_base_dir()
}

/// Full path of the SQLite database that stores registered devices.
fn device_db_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("lumen.db"))
}

/// Full path of the JSON file that stores [`RemoteAccessSettings`].
fn remote_settings_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("config").join("remote-access.json"))
}

/// Loads [`RemoteAccessSettings`] from disk, writing the default settings on
/// first run.
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

/// Serializes [`RemoteAccessSettings`] to disk as pretty-printed JSON.
fn save_remote_access_settings(settings: &RemoteAccessSettings) -> Result<(), String> {
    let path = remote_settings_path()?;
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Reads every registered device from the database, keyed by device id.
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
                permissions_chat,
                permissions_presentation,
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
                    chat: row.get::<_, i64>(12)? == 1,
                    presentation: row.get::<_, i64>(13)? == 1,
                },
                registered_at: row.get::<_, u64>(14)?,
                last_connected_at: row.get(15)?,
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

/// Inserts or replaces a device row, keyed by `device_id`.
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
                permissions_chat,
                permissions_presentation,
                registered_at,
                last_connected_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
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
                i64::from(device.permissions.chat),
                i64::from(device.permissions.presentation),
                device.registered_at,
                device.last_connected_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists changes to an existing device (same as an upsert).
fn update_device_in_db(device: &Device) -> Result<(), String> {
    insert_or_replace_device_in_db(device)
}

/// Deletes a device row from the database.
fn delete_device_from_db(device_id: &str) -> Result<(), String> {
    let connection = open_device_db()?;
    connection
        .execute("DELETE FROM devices WHERE device_id = ?1", [device_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Serializes a payload into a WebSocket text message.
fn json_message<T: Serialize>(payload: &T) -> Result<Message, String> {
    serde_json::to_string(payload)
        .map(Message::Text)
        .map_err(|e| e.to_string())
}

/// Builds a WebSocket close frame with an application-specific close code.
fn close_message(code: u16) -> Message {
    Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
        code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Library(code),
        reason: "".into(),
    }))
}

/// Maps a remote-control event name to the permission required to emit it.
///
/// Returns `None` for events that are either handled before the permission
/// check (such as `register` and `auth`) or unknown to the desktop.
///
/// # Examples
///
/// ```ignore
/// use crate::devices::map_event_permission;
///
/// assert_eq!(map_event_permission("play_pause"), Some("player"));
/// assert_eq!(map_event_permission("chat_send"), Some("chat"));
/// assert_eq!(map_event_permission("register"), None);
/// ```
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
        "chat_send" | "chat_file_send" | "chat_history" | "chat_reaction" | "chat_typing" | "chat_read" => Some("chat"),
        "queue_add" | "queue_remove" | "queue_move" | "queue_jump" | "queue_shuffle"
        | "queue_clear" => Some("player"),
        "slide_next" | "slide_prev" | "slide_goto" | "blackout" | "wallpaper" => {
            Some("presentation")
        }
        _ => None,
    }
}

/// Checks a named permission against a device's permission set.
///
/// Unknown permission names are treated as denied.
///
/// # Examples
///
/// ```ignore
/// use crate::devices::{DevicePermissions, is_permission_allowed};
///
/// let permissions = DevicePermissions::default();
/// assert!(is_permission_allowed(&permissions, "player"));
/// assert!(!is_permission_allowed(&permissions, "chat"));
/// assert!(!is_permission_allowed(&permissions, "bogus"));
/// ```
pub fn is_permission_allowed(permissions: &DevicePermissions, permission: &str) -> bool {
    match permission {
        "player" => permissions.player,
        "lyrics" => permissions.lyrics,
        "bible" => permissions.bible,
        "media" => permissions.media,
        "streaming" => permissions.streaming,
        "chat" => permissions.chat,
        "presentation" => permissions.presentation,
        _ => false,
    }
}
