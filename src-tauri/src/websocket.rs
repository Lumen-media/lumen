use futures_util::{SinkExt, StreamExt as FStreamExt};
use serde::{Deserialize, Serialize};
use serde_json;
use std::net::SocketAddr;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Deserialize, Serialize, Clone)]
struct AudioEvent {
    event: String,
    value: Option<f64>,
    duration: Option<f64>,
    title: Option<String>,
    url: Option<String>,
}

pub async fn accept_connection(peer: SocketAddr, stream: tokio::net::TcpStream, app: AppHandle) {
    if let Err(error) = handle_connection(peer, stream, app).await {
        eprintln!("Error handling connection from {}: {}", peer, error);
    }
}

async fn handle_connection(
    peer: SocketAddr,
    stream: tokio::net::TcpStream,
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("WebSocket handshake error: {}", e))?;
    println!("New WebSocket connection: {}", peer);

    let (mut outgoing, mut incoming) = ws_stream.split();

    while let Some(msg) = incoming.next().await {
        match msg {
            Ok(msg) => {
                println!("Received a message from {}: {:?}", peer, msg);

                if msg.is_text() {
                    let text = msg.to_text()?;
                    match serde_json::from_str::<AudioEvent>(text) {
                        Ok(audio_event) => {
                            match audio_event.event.as_str() {
                                "set_volume" => {
                                    if let Some(volume) = audio_event.value {
                                        let volume_u8 = volume as u8;
                                        if volume_u8 <= 100 {
                                            app.emit("set-volume", volume_u8)
                                                .map_err(|e| e.to_string())?;
                                        } else {
                                            eprintln!(
                                                "Received volume value out of range (0-100): {}",
                                                volume
                                            );
                                        }
                                    } else {
                                        eprintln!("Received set_volume event without a value");
                                    }
                                }
                                "seek" => {
                                    if let Some(seconds) = audio_event.value {
                                        app.emit("seek", seconds)
                                            .map_err(|e| e.to_string())?;
                                    } else {
                                        eprintln!("Received seek event without a value");
                                    }
                                }
                                "metadata" => {
                                    app.emit(
                                        "video-metadata",
                                        serde_json::json!({
                                            "title": audio_event.title.unwrap_or_default(),
                                            "url": audio_event.url.unwrap_or_default(),
                                        }),
                                    )
                                    .map_err(|e| e.to_string())?;
                                }
                                "progress" => {
                                    if let Some(seconds) = audio_event.value {
                                        app.emit(
                                            "video-progress",
                                            serde_json::json!({
                                                "seconds": seconds,
                                                "duration": audio_event.duration.unwrap_or(0.0)
                                            }),
                                        )
                                        .map_err(|e| e.to_string())?;
                                    }
                                }
                                "mute" => app.emit("mute", ()).map_err(|e| e.to_string())?,
                                "play_pause" => {
                                    app.emit("play-pause", ()).map_err(|e| e.to_string())?
                                }
                                "stop" => app.emit("stop", ()).map_err(|e| e.to_string())?,
                                "load_url" => {
                                    app.emit(
                                        "load-url",
                                        audio_event.url.unwrap_or_default(),
                                    )
                                    .map_err(|e| e.to_string())?;
                                }
                                "set_loop" => {
                                    let enabled = audio_event.value.map(|v| v != 0.0).unwrap_or(false);
                                    app.emit("video-loop", enabled).map_err(|e| e.to_string())?;
                                }
                                "next" => app.emit("next", ()).map_err(|e| e.to_string())?,
                                "previous" => {
                                    app.emit("previous", ()).map_err(|e| e.to_string())?
                                }
                                "manual_pause" => {
                                    println!("Received manual_pause event from {}", peer)
                                }
                                _ => println!("Received unknown event: {}", audio_event.event),
                            }

                            if audio_event.event != "manual_pause" {
                                println!("Emitted {} event", audio_event.event);
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to parse message from {} as AudioEvent: {}", peer, e);
                        }
                    }
                } else if msg.is_ping() {
                    outgoing.send(Message::Pong(msg.into_data())).await?;
                } else if msg.is_close() {
                    println!("Close message received from {}", peer);
                    break;
                }
            }
            Err(e) => {
                eprintln!("Error receiving message from {}: {}", peer, e);
                break;
            }
        }
    }

    println!("Connection with {} closed", peer);
    Ok(())
}
