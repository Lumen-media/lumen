//! Persistent streaming settings and the runtime status snapshot.
//!
//! [`StreamingConfig`] is the user-editable configuration stored as
//! `config/streaming.json` under the app base directory. It is round-tripped
//! through the Tauri commands in [`crate::streaming::manager`] and is always
//! passed through [`sanitize_config`] before being saved or applied, so out of
//! range values coming from the frontend can never reach the runtime.
//!
//! [`StreamingStatus`] is a read-only projection of the live
//! [`crate::streaming::manager::StreamManager`] (subscriber counts, mobile
//! connection state, HTML server URL and current volumes) that the frontend
//! polls or receives through the `streaming_status_changed` event.
//!
//! All fallible functions return `Result<_, String>` carrying a raw I/O or
//! serialization error message.

use std::{collections::HashMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};

/// User-editable streaming configuration persisted to `config/streaming.json`.
///
/// The struct is serialized to and from the frontend, so field names use
/// `snake_case`. Values are normalized by [`sanitize_config`] on load and on
/// every update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingConfig {
    /// Whether remote subscribers may open the desktop `preview` stream.
    pub preview_enabled: bool,
    /// Target frame rate for the main output. Valid values are `1`, `15`,
    /// `24`, `30` and `60`; any other value falls back to `1`.
    pub main_fps: u8,
    /// Target resolution for the main output. Valid values are `"720p"`,
    /// `"1080p"`, `"1440p"` and `"4K"`; any other value falls back to
    /// `"1080p"`.
    pub main_resolution: String,
    /// Whether the local HTML presentation server should be running.
    pub html_server_enabled: bool,
    /// TCP port bound by the HTML presentation server on all interfaces.
    /// `0` is normalized to the default `8090`.
    pub html_server_port: u16,
    /// Whether hardware video encoding should be preferred when available.
    pub hardware_encoding: bool,
    /// Master switch for content protection (e.g. keeping protected content
    /// out of captures). Effective only while also enabled at runtime through
    /// [`crate::streaming::manager::set_stream_content_protected`].
    pub content_protection: bool,
    /// Master output volume, `0..=100`. Defaults to `80` when absent from the
    /// stored JSON.
    #[serde(default = "default_master_volume")]
    pub master_volume: u8,
    /// Per-device output volumes keyed by mobile device id, each in
    /// `0..=100`. Missing ids are treated as using the master volume.
    #[serde(default)]
    pub device_volumes: HashMap<String, u8>,
}

/// Default master volume applied when the persisted config omits the field.
fn default_master_volume() -> u8 {
    80
}

impl Default for StreamingConfig {
    fn default() -> Self {
        Self {
            preview_enabled: true,
            main_fps: 1,
            main_resolution: "1080p".to_string(),
            html_server_enabled: false,
            html_server_port: 8090,
            hardware_encoding: false,
            content_protection: true,
            master_volume: 80,
            device_volumes: HashMap::new(),
        }
    }
}

/// Read-only snapshot of the live streaming state sent to the frontend.
///
/// Produced by [`crate::streaming::manager::StreamManager::status`] and
/// forwarded whenever the state changes, either as the return value of the
/// `get_streaming_status` command or through the `streaming_status_changed`
/// Tauri event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingStatus {
    /// Number of sessions subscribed to the desktop `preview` or
    /// `app_preview` streams, saturated at [`u8::MAX`].
    pub preview_subs: u8,
    /// Number of sessions subscribed to the `main` output, saturated at
    /// [`u8::MAX`].
    pub main_subs: u8,
    /// Whether at least one mobile device is currently sending media.
    pub mobile_connected: bool,
    /// Whether the HTML presentation server is currently running.
    pub html_active: bool,
    /// URL of the HTML presentation page, or `None` while the server is
    /// stopped or the local IP address cannot be resolved.
    pub html_url: Option<String>,
    /// Current master output volume, `0..=100`.
    #[serde(default = "default_master_volume")]
    pub master_volume: u8,
    /// Current per-device output volumes keyed by mobile device id.
    #[serde(default)]
    pub device_volumes: HashMap<String, u8>,
}

impl Default for StreamingStatus {
    fn default() -> Self {
        Self {
            preview_subs: 0,
            main_subs: 0,
            mobile_connected: false,
            html_active: false,
            html_url: None,
            master_volume: 80,
            device_volumes: HashMap::new(),
        }
    }
}

/// Clamps and repairs a [`StreamingConfig`] so it is safe to apply at runtime.
///
/// The normalization rules are:
///
/// * `main_fps` must be one of `1`, `15`, `24`, `30`, `60`, else it becomes
///   `1`.
/// * `main_resolution` must be one of `"720p"`, `"1080p"`, `"1440p"`,
///   `"4K"`, else it becomes `"1080p"`.
/// * `html_server_port` `0` becomes `8090`.
/// * `master_volume` and every entry in `device_volumes` are clamped to
///   `100`.
///
/// This function never fails; it always returns a usable configuration.
pub fn sanitize_config(mut config: StreamingConfig) -> StreamingConfig {
    if !matches!(config.main_fps, 1 | 15 | 24 | 30 | 60) {
        config.main_fps = 1;
    }

    if !matches!(
        config.main_resolution.as_str(),
        "720p" | "1080p" | "1440p" | "4K"
    ) {
        config.main_resolution = "1080p".to_string();
    }

    if config.html_server_port == 0 {
        config.html_server_port = 8090;
    }

    config.master_volume = config.master_volume.min(100);
    for volume in config.device_volumes.values_mut() {
        *volume = (*volume).min(100);
    }

    config
}

/// Creates the directory that stores the streaming config file.
///
/// Called during startup (see
/// [`crate::streaming::manager::initialize_streaming_state`]) before the
/// config is first written.
///
/// # Errors
///
/// Returns the underlying error message when the base directory cannot be
/// resolved or the `config` directory cannot be created.
pub fn ensure_streaming_storage() -> Result<(), String> {
    let path = streaming_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Loads the persisted [`StreamingConfig`], creating it if missing.
///
/// When `config/streaming.json` does not exist, the default configuration is
/// written to disk and returned. When it exists, it is parsed and passed
/// through [`sanitize_config`] before being returned.
///
/// # Errors
///
/// Returns the underlying error message when the path cannot be resolved, the
/// file cannot be read or written, or the JSON is malformed.
pub fn load_streaming_config() -> Result<StreamingConfig, String> {
    let path = streaming_config_path()?;
    if !path.exists() {
        let default_config = StreamingConfig::default();
        save_streaming_config(&default_config)?;
        return Ok(default_config);
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed: StreamingConfig =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(sanitize_config(parsed))
}

/// Serializes `config` as pretty JSON and writes it to
/// `config/streaming.json`, replacing any previous contents.
///
/// The config file is stored in a `config` directory that may be written to at
/// any time, so callers should ensure the returned value is already
/// sanitized.
///
/// # Errors
///
/// Returns the underlying error message when the path cannot be resolved,
/// serialization fails, or the file cannot be written.
pub fn save_streaming_config(config: &StreamingConfig) -> Result<(), String> {
    let path = streaming_config_path()?;
    let content = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

/// Resolves the application base directory that hosts all Lumen data.
fn app_base_dir() -> Result<PathBuf, String> {
    crate::paths::app_base_dir()
}

/// Returns the absolute path of the streaming config file
/// (`<app_base_dir>/config/streaming.json`).
fn streaming_config_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("config").join("streaming.json"))
}
