use crate::devices::{
    AuthPayload, DeviceState, RegisterPayload, auth_fail_message, authenticate_device,
    deactivate_device_registration, device_deactivated_message, is_permission_allowed,
    is_remote_access_enabled, map_event_permission, permission_denied_message, register_device,
    remove_session, touch_session,
};
use crate::streaming::{
    StreamErrorPayload, WebRtcIceCandidatePayload, add_webrtc_ice_candidate, handle_mobile_offer,
    handle_session_closed, set_webrtc_answer, subscribe_stream, unsubscribe_stream,
};
use futures_util::{SinkExt, StreamExt as FStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    net::SocketAddr,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Deserialize, Serialize, Clone)]
struct AudioEvent {
    event: String,
    value: Option<f64>,
    duration: Option<f64>,
    title: Option<String>,
    url: Option<String>,
    artist: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RegisterMessage {
    token: String,
    device_id: String,
    device_name: String,
    device_type: String,
    os: String,
    version: String,
}

#[derive(Debug, Deserialize)]
struct AuthMessage {
    device_id: String,
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct SubscribeStreamMessage {
    stream_type: String,
}

#[derive(Debug, Deserialize)]
struct WebRtcAnswerMessage {
    stream_type: String,
    sdp: String,
}

#[derive(Debug, Deserialize)]
struct MobileOfferMessage {
    sdp: String,
    video_orientation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WebRtcIceCandidateMessage {
    stream_type: String,
    candidate: WebRtcIceCandidatePayload,
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
    if peer.ip().is_loopback() {
        return handle_internal_connection(peer, stream, app).await;
    }

    handle_external_connection(peer, stream, app).await
}

async fn handle_internal_connection(
    peer: SocketAddr,
    stream: tokio::net::TcpStream,
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("WebSocket handshake error: {}", e))?;
    println!("New internal WebSocket connection: {}", peer);

    let (mut outgoing, mut incoming) = ws_stream.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = receiver.recv().await {
            if outgoing.send(message).await.is_err() {
                break;
            }
        }
    });
    let internal_session_id = format!("internal-{}", peer);

    while let Some(msg) = incoming.next().await {
        match msg {
            Ok(msg) => {
                if msg.is_text() {
                    let text = msg.to_text()?;
                    match serde_json::from_str::<Value>(text) {
                        Ok(value) => {
                            if let Some(event_name) = value.get("event").and_then(Value::as_str) {
                                if handle_streaming_event(
                                    &app,
                                    &sender,
                                    &internal_session_id,
                                    "internal",
                                    event_name,
                                    &value,
                                )
                                .await?
                                {
                                    continue;
                                }
                            }

                            match serde_json::from_value::<AudioEvent>(value) {
                                Ok(audio_event) => {
                                    handle_audio_event(&app, &peer.to_string(), &audio_event)?
                                }
                                Err(error) => {
                                    eprintln!(
                                        "Failed to parse internal message from {}: {}",
                                        peer, error
                                    );
                                }
                            }
                        }
                        Err(error) => {
                            eprintln!("Failed to parse internal message from {}: {}", peer, error);
                        }
                    }
                } else if msg.is_ping() {
                    let _ = sender.send(Message::Pong(msg.into_data()));
                } else if msg.is_close() {
                    break;
                }
            }
            Err(error) => {
                eprintln!("Internal WebSocket receive error from {}: {}", peer, error);
                break;
            }
        }
    }

    let _ = handle_session_closed(&app, &internal_session_id).await;
    writer.abort();
    println!("Internal connection with {} closed", peer);
    Ok(())
}

async fn handle_external_connection(
    peer: SocketAddr,
    stream: tokio::net::TcpStream,
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("WebSocket handshake error: {}", e))?;
    println!("New external WebSocket connection: {}", peer);

    let (mut outgoing, mut incoming) = ws_stream.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = receiver.recv().await {
            if outgoing.send(message).await.is_err() {
                break;
            }
        }
    });

    let state = app.state::<DeviceState>();
    let mut session_id: Option<String> = None;

    while let Some(msg) = incoming.next().await {
        match msg {
            Ok(msg) => {
                if msg.is_ping() {
                    let _ = sender.send(Message::Pong(msg.into_data()));
                    continue;
                }

                if msg.is_close() {
                    break;
                }

                if !msg.is_text() {
                    continue;
                }

                let text = msg.to_text()?;
                let value: Value = match serde_json::from_str(text) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("Failed to parse external message from {}: {}", peer, error);
                        continue;
                    }
                };

                let Some(event_name) = value.get("event").and_then(Value::as_str) else {
                    continue;
                };

                if session_id.is_none() {
                    match event_name {
                        "register" => {
                            if !is_remote_access_enabled(&state)? {
                                let _ = sender.send(auth_fail_message("unauthorized")?);
                                let _ = sender.send(close_message(4001));
                                break;
                            }

                            let payload: RegisterMessage = serde_json::from_value(value.clone())?;
                            let response = match register_device(
                                &app,
                                &state,
                                RegisterPayload {
                                    token: payload.token,
                                    device_id: payload.device_id,
                                    device_name: payload.device_name,
                                    device_type: payload.device_type,
                                    os: payload.os,
                                    version: payload.version,
                                },
                                sender.clone(),
                            ) {
                                Ok(response) => response,
                                Err(reason) => {
                                    let _ = sender.send(auth_fail_message(&reason)?);
                                    continue;
                                }
                            };

                            let _ = sender.send(json_message(&response)?);
                            session_id = Some(response.session_id);
                        }
                        "auth" => {
                            let payload: AuthMessage = serde_json::from_value(value.clone())?;
                            let response = match authenticate_device(
                                &app,
                                &state,
                                AuthPayload {
                                    device_id: payload.device_id,
                                    access_token: payload.access_token,
                                },
                                sender.clone(),
                            ) {
                                Ok(response) => response,
                                Err(reason) => {
                                    let _ = sender.send(auth_fail_message(&reason)?);
                                    if matches!(
                                        reason.as_str(),
                                        "unauthorized"
                                            | "not_registered"
                                            | "invalid_token"
                                            | "not_active"
                                    ) {
                                        let close_code = match reason.as_str() {
                                            "not_registered" => 4003,
                                            "invalid_token" => 4004,
                                            "not_active" => 4005,
                                            _ => 4001,
                                        };
                                        let _ = sender.send(close_message(close_code));
                                        break;
                                    }
                                    continue;
                                }
                            };

                            let _ = sender.send(json_message(&response)?);
                            session_id = Some(response.session_id);
                        }
                        _ => {}
                    }

                    continue;
                }

                let Some(active_session_id) = session_id.as_deref() else {
                    continue;
                };

                let Some(session) = touch_session(&state, active_session_id)? else {
                    continue;
                };

                if event_name == "forget_device" {
                    let _ = sender.send(device_deactivated_message(&session.device_id)?);
                    deactivate_device_registration(&app, &state, &session.device_id)?;
                    break;
                }

                if let Some(required_permission) = map_event_permission(event_name) {
                    if !is_permission_allowed(&session.permissions, required_permission) {
                        if is_streaming_event(event_name) {
                            let _ = sender.send(stream_error_message(
                                stream_type_for_event(event_name, &value),
                                "no_permission",
                            )?);
                        } else {
                            let _ = sender.send(permission_denied_message(event_name)?);
                        }
                        continue;
                    }
                }

                if handle_streaming_event(
                    &app,
                    &sender,
                    &session.session_id,
                    &session.device_id,
                    event_name,
                    &value,
                )
                .await?
                {
                    continue;
                }

                match serde_json::from_value::<AudioEvent>(value.clone()) {
                    Ok(audio_event) => {
                        handle_audio_event(&app, &peer.to_string(), &audio_event)?;
                    }
                    Err(error) => {
                        eprintln!(
                            "Failed to parse external audio event from {}: {}",
                            peer, error
                        );
                    }
                }
            }
            Err(error) => {
                eprintln!("External WebSocket receive error from {}: {}", peer, error);
                break;
            }
        }
    }

    if let Some(active_session_id) = session_id {
        let _ = handle_session_closed(&app, &active_session_id).await;
        let _ = remove_session(&state, &active_session_id);
    }

    writer.abort();
    println!("External connection with {} closed", peer);
    Ok(())
}

fn handle_audio_event(
    app: &AppHandle,
    peer: &str,
    audio_event: &AudioEvent,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match audio_event.event.as_str() {
        "set_volume" => {
            if let Some(volume) = audio_event.value {
                let volume_u8 = volume as u8;
                if volume_u8 <= 100 {
                    app.emit("set-volume", volume_u8)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        "seek" => {
            if let Some(seconds) = audio_event.value {
                app.emit("seek", seconds).map_err(|e| e.to_string())?;
            }
        }
        "metadata" => {
            app.emit(
                "video-metadata",
                serde_json::json!({
                    "title": audio_event.title.clone().unwrap_or_default(),
                    "url": audio_event.url.clone().unwrap_or_default(),
                    "artist": audio_event.artist.clone().unwrap_or_default(),
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
        "play_pause" => app.emit("play-pause", ()).map_err(|e| e.to_string())?,
        "stop" => app.emit("stop", ()).map_err(|e| e.to_string())?,
        "load_url" => {
            app.emit(
                "load-url",
                serde_json::json!({
                    "url": audio_event.url.clone().unwrap_or_default(),
                    "time": audio_event.value.unwrap_or(0.0),
                }),
            )
            .map_err(|e| e.to_string())?;
        }
        "load_lyric" => {
            app.emit(
                "load-lyric",
                serde_json::json!({
                    "url": audio_event.url.clone().unwrap_or_default(),
                }),
            )
            .map_err(|e| e.to_string())?;
        }
        "set_loop" => {
            let enabled = audio_event.value.map(|value| value != 0.0).unwrap_or(false);
            app.emit("video-loop", enabled).map_err(|e| e.to_string())?;
        }
        "next" => app.emit("next", ()).map_err(|e| e.to_string())?,
        "previous" => app.emit("previous", ()).map_err(|e| e.to_string())?,
        "manual_pause" => {
            println!("Received manual_pause event from {}", peer);
        }
        _ => println!(
            "Received unknown event from {}: {}",
            peer, audio_event.event
        ),
    }

    if audio_event.event != "manual_pause" {
        println!("Emitted {} event from {}", audio_event.event, peer);
    }

    Ok(())
}

fn json_message<T: Serialize>(payload: &T) -> Result<Message, String> {
    serde_json::to_string(payload)
        .map(Message::Text)
        .map_err(|e| e.to_string())
}

fn close_message(code: u16) -> Message {
    Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
        code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(code),
        reason: "".into(),
    }))
}

fn is_streaming_event(event_name: &str) -> bool {
    matches!(
        event_name,
        "subscribe_stream"
            | "unsubscribe_stream"
            | "webrtc_answer"
            | "webrtc_ice_candidate"
            | "mobile_offer"
    )
}

fn stream_type_for_event<'a>(event_name: &'a str, value: &'a Value) -> &'a str {
    if event_name == "mobile_offer" {
        return "mobile";
    }

    value
        .get("stream_type")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
}

fn stream_error_message(stream_type: &str, reason: &str) -> Result<Message, String> {
    json_message(&StreamErrorPayload {
        event: "stream_error",
        stream_type: stream_type.to_string(),
        reason: reason.to_string(),
    })
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn emit_streaming_debug(
    app: &AppHandle,
    session_id: &str,
    device_id: &str,
    event: &str,
    payload: Value,
) {
    let _ = app.emit(
        "streaming_debug_log",
        json!({
            "ts_ms": now_unix_ms(),
            "session_id": session_id,
            "device_id": device_id,
            "event": event,
            "payload": payload,
        }),
    );
}

async fn handle_streaming_event(
    app: &AppHandle,
    sender: &mpsc::UnboundedSender<Message>,
    session_id: &str,
    device_id: &str,
    event_name: &str,
    value: &Value,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    match event_name {
        "subscribe_stream" => {
            let payload: SubscribeStreamMessage = serde_json::from_value(value.clone())?;
            emit_streaming_debug(
                app,
                session_id,
                device_id,
                "subscribe_stream",
                json!({
                    "status": "requested",
                    "stream_type": payload.stream_type,
                }),
            );
            if let Err(reason) =
                subscribe_stream(app, session_id, &payload.stream_type, sender.clone()).await
            {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "subscribe_stream",
                    json!({
                        "status": "error",
                        "stream_type": payload.stream_type,
                        "reason": reason,
                    }),
                );
                let _ = sender.send(stream_error_message(&payload.stream_type, &reason)?);
            } else {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "subscribe_stream",
                    json!({
                        "status": "ok",
                        "stream_type": payload.stream_type,
                    }),
                );
            }
            Ok(true)
        }
        "unsubscribe_stream" => {
            let payload: SubscribeStreamMessage = serde_json::from_value(value.clone())?;
            emit_streaming_debug(
                app,
                session_id,
                device_id,
                "unsubscribe_stream",
                json!({
                    "status": "requested",
                    "stream_type": payload.stream_type,
                }),
            );
            if let Err(reason) = unsubscribe_stream(app, session_id, &payload.stream_type).await {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "unsubscribe_stream",
                    json!({
                        "status": "error",
                        "stream_type": payload.stream_type,
                        "reason": reason,
                    }),
                );
                let _ = sender.send(stream_error_message(&payload.stream_type, &reason)?);
            } else {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "unsubscribe_stream",
                    json!({
                        "status": "ok",
                        "stream_type": payload.stream_type,
                    }),
                );
                let _ = sender.send(json_message(&serde_json::json!({
                    "event": "stream_stopped",
                    "stream_type": payload.stream_type,
                }))?);
            }
            Ok(true)
        }
        "webrtc_answer" => {
            let payload: WebRtcAnswerMessage = serde_json::from_value(value.clone())?;
            emit_streaming_debug(
                app,
                session_id,
                device_id,
                "webrtc_answer",
                json!({
                    "status": "requested",
                    "stream_type": payload.stream_type,
                    "sdp_len": payload.sdp.len(),
                }),
            );
            if let Err(reason) =
                set_webrtc_answer(app, session_id, &payload.stream_type, &payload.sdp).await
            {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "webrtc_answer",
                    json!({
                        "status": "error",
                        "stream_type": payload.stream_type,
                        "reason": reason,
                    }),
                );
                let _ = sender.send(stream_error_message(&payload.stream_type, &reason)?);
            } else {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "webrtc_answer",
                    json!({
                        "status": "ok",
                        "stream_type": payload.stream_type,
                    }),
                );
            }
            Ok(true)
        }
        "webrtc_ice_candidate" => {
            let payload: WebRtcIceCandidateMessage = serde_json::from_value(value.clone())?;
            emit_streaming_debug(
                app,
                session_id,
                device_id,
                "webrtc_ice_candidate",
                json!({
                    "status": "requested",
                    "stream_type": payload.stream_type,
                }),
            );
            if let Err(reason) =
                add_webrtc_ice_candidate(app, session_id, &payload.stream_type, payload.candidate)
                    .await
            {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "webrtc_ice_candidate",
                    json!({
                        "status": "error",
                        "stream_type": payload.stream_type,
                        "reason": reason,
                    }),
                );
                let _ = sender.send(stream_error_message(&payload.stream_type, &reason)?);
            } else {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "webrtc_ice_candidate",
                    json!({
                        "status": "ok",
                        "stream_type": payload.stream_type,
                    }),
                );
            }
            Ok(true)
        }
        "mobile_offer" => {
            let payload: MobileOfferMessage = serde_json::from_value(value.clone())?;
            emit_streaming_debug(
                app,
                session_id,
                device_id,
                "mobile_offer",
                json!({
                    "status": "requested",
                    "stream_type": "mobile",
                    "sdp_len": payload.sdp.len(),
                    "video_orientation": payload.video_orientation,
                }),
            );
            if let Err(reason) =
                handle_mobile_offer(
                    app,
                    session_id,
                    device_id,
                    &payload.sdp,
                    payload.video_orientation.as_deref(),
                    sender.clone(),
                )
                .await
            {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "mobile_offer",
                    json!({
                        "status": "error",
                        "stream_type": "mobile",
                        "reason": reason,
                    }),
                );
                let _ = sender.send(stream_error_message("mobile", &reason)?);
            } else {
                emit_streaming_debug(
                    app,
                    session_id,
                    device_id,
                    "mobile_offer",
                    json!({
                        "status": "ok",
                        "stream_type": "mobile",
                    }),
                );
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}
