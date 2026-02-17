#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod websocket;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{async_runtime, Emitter, Manager, State};
use tokio::net::TcpListener;

struct WindowState {
    positions: Mutex<HashMap<String, (i32, i32)>>,
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn create_window(
    app_handle: tauri::AppHandle,
    label: String,
    title: String,
    window_state: State<'_, WindowState>,
) -> Result<(), String> {
    let main_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    
    let saved_position = {
        let positions = window_state.positions.lock().unwrap();
        positions.get(&label).cloned()
    };
    
    let target_position = if let Some((saved_x, saved_y)) = saved_position {
        tauri::PhysicalPosition { x: saved_x, y: saved_y }
    } else {
        let current_monitor = main_window
            .current_monitor()
            .map_err(|e| format!("Failed to get current monitor: {}", e))?
            .ok_or_else(|| "Current monitor not found".to_string())?;
        
        let monitors = main_window
            .available_monitors()
            .map_err(|e| format!("Failed to get monitors: {}", e))?;
        
        let target_monitor = if monitors.len() > 1 {
            monitors
                .into_iter()
                .find(|m| {
                    let pos1 = m.position();
                    let pos2 = current_monitor.position();
                    pos1.x != pos2.x || pos1.y != pos2.y
                })
                .unwrap_or(current_monitor)
        } else {
            current_monitor
        };
        
        let monitor_position = target_monitor.position();
        
        tauri::PhysicalPosition { 
            x: monitor_position.x, 
            y: monitor_position.y 
        }
    };
    
    let window = tauri::WebviewWindowBuilder::new(&app_handle, &label, tauri::WebviewUrl::App("/media-window".into()))
        .title(&title)
        .decorations(false)
        .fullscreen(true)
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    
    window
        .set_position(tauri::Position::Physical(target_position))
        .map_err(|e| format!("Failed to set window position: {}", e))?;
    
    window
        .set_fullscreen(true)
        .map_err(|e| format!("Failed to set fullscreen: {}", e))?;
    
    {
        let mut positions = window_state.positions.lock().unwrap();
        positions.insert(label.clone(), (target_position.x, target_position.y));
    }
    
    Ok(())
}

#[tauri::command]
async fn save_window_position(
    label: String,
    x: i32,
    y: i32,
    window_state: State<'_, WindowState>,
) -> Result<(), String> {
    let mut positions = window_state.positions.lock().unwrap();
    positions.insert(label, (x, y));
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .manage(WindowState {
            positions: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            println!("Single instance callback:");
            println!("  args: {:?}", args);
            println!("  cwd: {:?}", cwd);
            
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                let _ = window.show();
            }
            
            let _ = app.emit("single-instance", args);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_handle = app.handle();
            let app_handle_clone = app_handle.clone();
            async_runtime::spawn(async move {
                let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
                while let Ok((stream, _)) = listener.accept().await {
                    let peer = stream
                        .peer_addr()
                        .expect("connected streams should have a peer address");

                    async_runtime::spawn(websocket::accept_connection(
                        peer,
                        stream,
                        app_handle_clone.clone(),
                    ));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_folder, create_window, save_window_position])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
