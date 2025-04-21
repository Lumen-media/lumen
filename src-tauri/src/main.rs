#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::net::SocketAddr;
use tauri::{AppHandle, Manager, Emitter};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let app_handle_clone = app_handle.clone();
            tokio::spawn(async move {
                let listener = TcpListener::bind("127.0.0.1:8080").await.unwrap();
                println!("WebSocket server listening on ws://127.0.0.1:8080");

                while let Ok((stream, _)) = listener.accept().await {
                    let peer = stream
                        .peer_addr()
                        .expect("connected streams should have a peer address");
                    println!("Peer address: {}", peer);

                    tokio::spawn(accept_connection(peer, stream, app_handle_clone.clone()));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}

async fn accept_connection(
    peer: SocketAddr,
    stream: tokio::net::TcpStream,
    app: AppHandle,
) {
    if let Err(error) = handle_connection(peer, stream, app).await {
        match error {
            _ => println!("error during connection: {}", error),
        }
    }
}

async fn handle_connection(
    peer: SocketAddr,
    stream: tokio::net::TcpStream,
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .expect("Error during the websocket handshake occurred");
    println!("New WebSocket connection: {}", peer);

    let (mut outgoing, mut incoming) = ws_stream.split();

    while let Some(msg) = incoming.next().await {
        let msg = msg?;
        println!("Received a message from {}: {:?}", peer, msg);

        if msg.is_text() || msg.is_binary() {
            outgoing
                .send(msg.clone())
                .await
                .expect("Failed to send message");

            app.emit("websocket-message", msg.to_text().unwrap().to_string())?;
        } else if msg.is_ping() {
            outgoing.send(Message::Pong(msg.into_data())).await?;
        } else if msg.is_close() {
            println!("Closing connection with {}", peer);
            break;
        }
    }

    println!("Connection with {} closed", peer);
    Ok(())
}
