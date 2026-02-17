#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod websocket;

use tauri::{async_runtime, Emitter, Manager};
use tokio::net::TcpListener;

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
    url: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let _window = tauri::WebviewWindowBuilder::new(&app_handle, &label, tauri::WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(400.0, 400.0)
        .center()
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;
    
    println!("Janela '{}' criada com sucesso", label);
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
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
                println!("WebSocket server listening on ws://0.0.0.0:8080");

                while let Ok((stream, _)) = listener.accept().await {
                    let peer = stream
                        .peer_addr()
                        .expect("connected streams should have a peer address");
                    println!("Peer address: {}", peer);

                    async_runtime::spawn(websocket::accept_connection(
                        peer,
                        stream,
                        app_handle_clone.clone(),
                    ));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_folder, create_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
