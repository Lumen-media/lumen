use std::{collections::HashMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingConfig {
    pub preview_enabled: bool,
    pub main_fps: u8,
    pub main_resolution: String,
    pub html_server_enabled: bool,
    pub html_server_port: u16,
    pub hardware_encoding: bool,
    pub content_protection: bool,
    #[serde(default = "default_master_volume")]
    pub master_volume: u8,
    #[serde(default)]
    pub device_volumes: HashMap<String, u8>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingStatus {
    pub preview_subs: u8,
    pub main_subs: u8,
    pub mobile_connected: bool,
    pub html_active: bool,
    pub html_url: Option<String>,
    #[serde(default = "default_master_volume")]
    pub master_volume: u8,
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

pub fn ensure_streaming_storage() -> Result<(), String> {
    let path = streaming_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

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

pub fn save_streaming_config(config: &StreamingConfig) -> Result<(), String> {
    let path = streaming_config_path()?;
    let content = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn app_base_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "Could not resolve executable directory".to_string())?;
    Ok(parent.join("lumen"))
}

fn streaming_config_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("config").join("streaming.json"))
}
