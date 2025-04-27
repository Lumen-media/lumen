#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod websocket;

use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let app_handle_clone = app_handle.clone();
            tokio::spawn(async move {
                let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
                println!("WebSocket server listening on ws://0.0.0.0:8080");

                while let Ok((stream, _)) = listener.accept().await {
                    let peer = stream
                        .peer_addr()
                        .expect("connected streams should have a peer address");
                    println!("Peer address: {}", peer);

                    tokio::spawn(websocket::accept_connection(peer, stream, app_handle_clone.clone()));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
