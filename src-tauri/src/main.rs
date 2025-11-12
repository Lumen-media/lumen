#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod websocket;
mod commands;
mod conversion;

use tauri::{async_runtime, AppHandle, Manager};
use tokio::net::TcpListener;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let windows = app.webview_windows();
            
            if let Some(window) = windows.values().next() {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
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
        .invoke_handler(tauri::generate_handler![
            open_video_window,
            create_new_window,
            commands::file::select_pptx_file,
            commands::file::select_video_file,
            commands::file::save_media_database,
            commands::file::load_media_database,
            commands::conversion::get_pptx_metadata,
            commands::conversion::convert_pptx_to_pdf,
            commands::conversion::convert_pptx_to_pdf_with_retry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}

#[tauri::command]
async fn open_video_window(app: AppHandle) -> Result<(), String> {
    tauri::WindowBuilder::new(&app, "video-player")
    .title("Lumen Video Player")
    .inner_size(800.0, 600.0)
    .resizable(true)
    .fullscreen(false)
    .decorations(true)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_new_window(app: AppHandle, window_label: String, title: String) -> Result<(), String> {
    // Check if the window already exists
    if app.get_webview_window(&window_label).is_some() {
        return Err("Window already exists".to_string());
    }

    tauri::WebviewWindowBuilder::new(&app, &window_label, tauri::WebviewUrl::App("index.html".into()))
        .title(&title)
        .inner_size(800.0, 600.0)
        .resizable(true)
        .fullscreen(false)
        .decorations(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
