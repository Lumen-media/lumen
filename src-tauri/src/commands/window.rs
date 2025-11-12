use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoState {
    pub playing: bool,
    pub current_time: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationState {
    pub media_id: String,
    pub media_type: String, // "text" | "video" | "pptx"
    pub current_slide: Option<u32>,
    pub video_state: Option<VideoState>,
    pub text_content: Option<String>,
}

#[tauri::command]
pub async fn create_media_window(
    app: AppHandle,
    display_id: Option<u32>,
) -> Result<String, String> {
    let window_label = "media-window";

    if let Some(existing_window) = app.get_webview_window(window_label) {
        existing_window.set_focus().map_err(|e| e.to_string())?;
        return Ok(window_label.to_string());
    }

    let displays = get_available_displays_internal(&app)?;
    
    let target_display = if let Some(id) = display_id {
        displays.iter().find(|d| d.id == id)
    } else {
        displays.iter().find(|d| !d.is_primary).or_else(|| displays.first())
    };

    let target_display = target_display.ok_or("No display available")?;

    let window = WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::App("/media".into())
    )
    .title("Media Display")
    .fullscreen(true)
    .decorations(false)
    .resizable(false)
    .visible(true)
    .build()
    .map_err(|e| format!("Failed to create media window: {}", e))?;

    let position = PhysicalPosition::new(target_display.x, target_display.y);
    window.set_position(position).map_err(|e| e.to_string())?;

    let size = PhysicalSize::new(target_display.width, target_display.height);
    window.set_size(size).map_err(|e| e.to_string())?;

    window.set_fullscreen(true).map_err(|e| e.to_string())?;

    Ok(window_label.to_string())
}

#[tauri::command]
pub async fn get_available_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    get_available_displays_internal(&app)
}

fn get_available_displays_internal(app: &AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary_monitor = app.primary_monitor().map_err(|e| e.to_string())?;
    
    let primary_name = primary_monitor.as_ref().and_then(|m| m.name());

    let displays: Vec<DisplayInfo> = monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let name = monitor.name().map(|s| s.to_string()).unwrap_or_else(|| format!("Display {}", index + 1));
            let size = monitor.size();
            let position = monitor.position();
            let scale_factor = monitor.scale_factor();
            let is_primary = primary_name.as_ref().map_or(false, |pn| **pn == name);

            DisplayInfo {
                id: index as u32,
                name,
                width: size.width,
                height: size.height,
                x: position.x,
                y: position.y,
                is_primary,
                scale_factor,
            }
        })
        .collect();

    Ok(displays)
}

#[tauri::command]
pub async fn close_media_window(app: AppHandle) -> Result<(), String> {
    let window_label = "media-window";
    
    if let Some(window) = app.get_webview_window(window_label) {
        window.close().map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn move_window_to_display(
    app: AppHandle,
    window_label: String,
    display_id: u32,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("Window '{}' not found", window_label))?;

    let displays = get_available_displays_internal(&app)?;
    let target_display = displays
        .iter()
        .find(|d| d.id == display_id)
        .ok_or_else(|| format!("Display with id {} not found", display_id))?;

    let position = PhysicalPosition::new(target_display.x, target_display.y);
    window.set_position(position).map_err(|e| e.to_string())?;

    let size = PhysicalSize::new(target_display.width, target_display.height);
    window.set_size(size).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn sync_presentation_state(
    app: AppHandle,
    state: PresentationState,
) -> Result<(), String> {
    let window_label = "media-window";
    
    if let Some(window) = app.get_webview_window(window_label) {
        window
            .emit("presentation-state-update", state.clone())
            .map_err(|e| format!("Failed to emit state update: {}", e))?;
        
        app.emit("presentation-state-changed", state)
            .map_err(|e| format!("Failed to emit global state: {}", e))?;
    } else {
        return Err("Media window not found".to_string());
    }
    
    Ok(())
}

#[tauri::command]
pub async fn is_media_window_open(app: AppHandle) -> Result<bool, String> {
    Ok(app.get_webview_window("media-window").is_some())
}
