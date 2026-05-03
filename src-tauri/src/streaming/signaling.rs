use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, async_runtime};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use webrtc::{
    ice_transport::{ice_candidate::RTCIceCandidateInit, ice_server::RTCIceServer},
    peer_connection::{
        RTCPeerConnection, configuration::RTCConfiguration,
        peer_connection_state::RTCPeerConnectionState,
        sdp::session_description::RTCSessionDescription,
    },
    rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication,
    rtp_transceiver::{
        RTCRtpTransceiverInit,
        rtp_codec::{RTCRtpCodecCapability, RTPCodecType},
        rtp_transceiver_direction::RTCRtpTransceiverDirection,
    },
    track::track_local::{TrackLocal, TrackLocalWriter},
};

use super::manager::{StreamingState, cleanup_session};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamType {
    Preview,
    AppPreview,
    Main,
    Mobile,
    MobilePreview,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WebRtcIceCandidatePayload {
    pub candidate: String,
    #[serde(rename = "sdpMid")]
    pub sdp_mid: Option<String>,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_mline_index: Option<u16>,
}

impl StreamType {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "preview" => Some(Self::Preview),
            "app_preview" => Some(Self::AppPreview),
            "main" => Some(Self::Main),
            "mobile" => Some(Self::Mobile),
            "mobile_preview" => Some(Self::MobilePreview),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::AppPreview => "app_preview",
            Self::Main => "main",
            Self::Mobile => "mobile",
            Self::MobilePreview => "mobile_preview",
        }
    }
}

pub fn h264_codec_capability() -> RTCRtpCodecCapability {
    RTCRtpCodecCapability {
        mime_type: "video/H264".to_string(),
        clock_rate: 90_000,
        channels: 0,
        sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
            .to_string(),
        rtcp_feedback: vec![],
    }
}

pub fn h264_passthrough_codec_capability() -> RTCRtpCodecCapability {
    RTCRtpCodecCapability {
        mime_type: "video/H264".to_string(),
        clock_rate: 90_000,
        channels: 0,
        // Passthrough for mobile relay: avoid forcing one fixed profile-level-id.
        sdp_fmtp_line: "packetization-mode=1;level-asymmetry-allowed=1".to_string(),
        rtcp_feedback: vec![],
    }
}

pub fn opus_codec_capability() -> RTCRtpCodecCapability {
    RTCRtpCodecCapability {
        mime_type: "audio/opus".to_string(),
        clock_rate: 48_000,
        channels: 2,
        sdp_fmtp_line: "minptime=10;useinbandfec=1".to_string(),
        rtcp_feedback: vec![],
    }
}

pub async fn subscribe_stream(
    app: &AppHandle,
    session_id: &str,
    stream_type: &str,
    sender: UnboundedSender<Message>,
) -> Result<(), String> {
    let stream_type =
        StreamType::from_str(stream_type).ok_or_else(|| "invalid_stream_type".to_string())?;
    if stream_type == StreamType::Mobile {
        return Err("invalid_stream_type".to_string());
    }

    let state = app.state::<StreamingState>();
    let manager_arc = state.manager.clone();

    let (
        api,
        preview_track,
        app_preview_track,
        main_track,
        mobile_preview_video_h264_track,
        mobile_preview_audio_track,
        preview_enabled,
    ) = {
        let manager = manager_arc.lock().await;
        (
            manager.api.clone(),
            manager.preview_track.clone(),
            manager.app_preview_track.clone(),
            manager.main_track.clone(),
            manager.mobile_preview_video_h264_track.clone(),
            manager.mobile_preview_audio_track.clone(),
            manager.config.preview_enabled,
        )
    };

    if stream_type == StreamType::Preview && !preview_enabled {
        return Err("not_enabled".to_string());
    }

    // TODO: Desktop capture -> preview/main encoder pipeline is not wired yet.
    // Avoid completing a "successful" handshake with zero media frames.
    if matches!(stream_type, StreamType::Preview | StreamType::Main) {
        return Err("capture_not_ready".to_string());
    }

    let peer = create_peer_connection(api).await?;

    {
        let sender_clone = sender.clone();
        let stream_type_label = stream_type.as_str().to_string();
        peer.on_ice_candidate(Box::new(move |candidate| {
            let sender_clone = sender_clone.clone();
            let stream_type_label = stream_type_label.clone();
            Box::pin(async move {
                let Some(candidate) = candidate else {
                    return;
                };

                let Ok(candidate_json) = candidate.to_json() else {
                    return;
                };

                let payload = json!({
                    "event": "stream_ice_candidate",
                    "stream_type": stream_type_label,
                    "candidate": {
                        "candidate": candidate_json.candidate,
                        "sdpMid": candidate_json.sdp_mid,
                        "sdpMLineIndex": candidate_json.sdp_mline_index,
                    }
                });

                let _ = sender_clone.send(Message::Text(payload.to_string()));
            })
        }));
    }

    {
        let manager_arc_clone = manager_arc.clone();
        let session_id = session_id.to_string();
        peer.on_peer_connection_state_change(Box::new(move |state| {
            let manager_arc_clone = manager_arc_clone.clone();
            let session_id = session_id.clone();
            Box::pin(async move {
                if matches!(
                    state,
                    RTCPeerConnectionState::Disconnected
                        | RTCPeerConnectionState::Failed
                        | RTCPeerConnectionState::Closed
                ) {
                    cleanup_session(manager_arc_clone, &session_id).await;
                }
            })
        }));
    }

    match stream_type {
        StreamType::Preview => {
            let local_track = preview_track as Arc<dyn TrackLocal + Send + Sync>;
            let _ = peer
                .add_track(local_track)
                .await
                .map_err(|error| error.to_string())?;
        }
        StreamType::AppPreview => {
            let local_track = app_preview_track as Arc<dyn TrackLocal + Send + Sync>;
            let _ = peer
                .add_track(local_track)
                .await
                .map_err(|error| error.to_string())?;
        }
        StreamType::Main => {
            let local_track = main_track as Arc<dyn TrackLocal + Send + Sync>;
            let _ = peer
                .add_track(local_track)
                .await
                .map_err(|error| error.to_string())?;
        }
        StreamType::MobilePreview => {
            let h264_video_track =
                mobile_preview_video_h264_track as Arc<dyn TrackLocal + Send + Sync>;
            let audio_track = mobile_preview_audio_track as Arc<dyn TrackLocal + Send + Sync>;
            let _ = peer
                .add_track(h264_video_track)
                .await
                .map_err(|error| error.to_string())?;
            let _ = peer
                .add_track(audio_track)
                .await
                .map_err(|error| error.to_string())?;
        }
        StreamType::Mobile => unreachable!(),
    }

    let offer = peer
        .create_offer(None)
        .await
        .map_err(|error| error.to_string())?;
    peer.set_local_description(offer.clone())
        .await
        .map_err(|error| error.to_string())?;

    let previous_peer = {
        let mut manager = manager_arc.lock().await;
        let old = match stream_type {
            StreamType::Preview => manager.preview_peers.remove(session_id),
            StreamType::AppPreview => manager.app_preview_peers.remove(session_id),
            StreamType::Main => manager.main_peers.remove(session_id),
            StreamType::MobilePreview => manager.mobile_preview_peers.remove(session_id),
            StreamType::Mobile => None,
        };
        match stream_type {
            StreamType::Preview => {
                manager
                    .preview_peers
                    .insert(session_id.to_string(), peer.clone());
            }
            StreamType::AppPreview => {
                manager
                    .app_preview_peers
                    .insert(session_id.to_string(), peer.clone());
            }
            StreamType::Main => {
                manager
                    .main_peers
                    .insert(session_id.to_string(), peer.clone());
            }
            StreamType::MobilePreview => {
                manager
                    .mobile_preview_peers
                    .insert(session_id.to_string(), peer.clone());
            }
            StreamType::Mobile => unreachable!(),
        }
        manager.emit_status();
        old
    };

    if let Some(previous_peer) = previous_peer {
        let _ = previous_peer.close().await;
    }

    let payload = json!({
        "event": "stream_offer",
        "stream_type": stream_type.as_str(),
        "sdp": offer.sdp,
    });
    let _ = sender.send(Message::Text(payload.to_string()));

    Ok(())
}

pub async fn unsubscribe_stream(
    app: &AppHandle,
    session_id: &str,
    stream_type: &str,
) -> Result<(), String> {
    let stream_type =
        StreamType::from_str(stream_type).ok_or_else(|| "invalid_stream_type".to_string())?;
    if stream_type == StreamType::Mobile {
        return Err("invalid_stream_type".to_string());
    }

    let state = app.state::<StreamingState>();
    let peer = {
        let mut manager = state.manager.lock().await;
        let peer = match stream_type {
            StreamType::Preview => manager.preview_peers.remove(session_id),
            StreamType::AppPreview => manager.app_preview_peers.remove(session_id),
            StreamType::Main => manager.main_peers.remove(session_id),
            StreamType::MobilePreview => manager.mobile_preview_peers.remove(session_id),
            StreamType::Mobile => None,
        };
        manager.emit_status();
        peer
    };

    if let Some(peer) = peer {
        let _ = peer.close().await;
    }

    Ok(())
}

pub async fn set_webrtc_answer(
    app: &AppHandle,
    session_id: &str,
    stream_type: &str,
    sdp: &str,
) -> Result<(), String> {
    let stream_type =
        StreamType::from_str(stream_type).ok_or_else(|| "invalid_stream_type".to_string())?;
    if stream_type == StreamType::Mobile {
        return Err("invalid_stream_type".to_string());
    }

    let state = app.state::<StreamingState>();
    let peer = {
        let manager = state.manager.lock().await;
        match stream_type {
            StreamType::Preview => manager.preview_peers.get(session_id).cloned(),
            StreamType::AppPreview => manager.app_preview_peers.get(session_id).cloned(),
            StreamType::Main => manager.main_peers.get(session_id).cloned(),
            StreamType::MobilePreview => manager.mobile_preview_peers.get(session_id).cloned(),
            StreamType::Mobile => None,
        }
    }
    .ok_or_else(|| "peer_not_found".to_string())?;

    let answer =
        RTCSessionDescription::answer(sdp.to_string()).map_err(|error| error.to_string())?;
    peer.set_remote_description(answer)
        .await
        .map_err(|error| error.to_string())
}

pub async fn add_webrtc_ice_candidate(
    app: &AppHandle,
    session_id: &str,
    stream_type: &str,
    candidate: WebRtcIceCandidatePayload,
) -> Result<(), String> {
    let stream_type =
        StreamType::from_str(stream_type).ok_or_else(|| "invalid_stream_type".to_string())?;
    let state = app.state::<StreamingState>();

    let peer = {
        let manager = state.manager.lock().await;
        match stream_type {
            StreamType::Preview => manager.preview_peers.get(session_id).cloned(),
            StreamType::AppPreview => manager.app_preview_peers.get(session_id).cloned(),
            StreamType::Main => manager.main_peers.get(session_id).cloned(),
            StreamType::MobilePreview => manager.mobile_preview_peers.get(session_id).cloned(),
            StreamType::Mobile => manager.get_mobile_peer(session_id),
        }
    }
    .ok_or_else(|| "peer_not_found".to_string())?;

    let candidate_init = RTCIceCandidateInit {
        candidate: candidate.candidate,
        sdp_mid: candidate.sdp_mid,
        sdp_mline_index: candidate.sdp_mline_index,
        username_fragment: None,
    };

    peer.add_ice_candidate(candidate_init)
        .await
        .map_err(|error| error.to_string())
}

pub async fn handle_mobile_offer(
    app: &AppHandle,
    session_id: &str,
    device_id: &str,
    sdp: &str,
    video_orientation: Option<&str>,
    sender: UnboundedSender<Message>,
) -> Result<(), String> {
    let state = app.state::<StreamingState>();
    let manager_arc = state.manager.clone();
    let api = {
        let manager = manager_arc.lock().await;
        manager.api.clone()
    };

    let peer = create_peer_connection(api).await?;

    {
        let sender_clone = sender.clone();
        peer.on_ice_candidate(Box::new(move |candidate| {
            let sender_clone = sender_clone.clone();
            Box::pin(async move {
                let Some(candidate) = candidate else {
                    return;
                };

                let Ok(candidate_json) = candidate.to_json() else {
                    return;
                };

                let payload = json!({
                    "event": "stream_ice_candidate",
                    "stream_type": "mobile",
                    "candidate": {
                        "candidate": candidate_json.candidate,
                        "sdpMid": candidate_json.sdp_mid,
                        "sdpMLineIndex": candidate_json.sdp_mline_index,
                    }
                });

                let _ = sender_clone.send(Message::Text(payload.to_string()));
            })
        }));
    }

    {
        let manager_arc_clone = manager_arc.clone();
        let session_id = session_id.to_string();
        peer.on_peer_connection_state_change(Box::new(move |state| {
            let manager_arc_clone = manager_arc_clone.clone();
            let session_id = session_id.clone();
            Box::pin(async move {
                if matches!(
                    state,
                    RTCPeerConnectionState::Disconnected
                        | RTCPeerConnectionState::Failed
                        | RTCPeerConnectionState::Closed
                ) {
                    cleanup_session(manager_arc_clone, &session_id).await;
                }
            })
        }));
    }

    {
        let manager_arc_clone = manager_arc.clone();
        let session_id = session_id.to_string();
        let device_id = device_id.to_string();
        let app = app.clone();
        let peer_for_pli = peer.clone();

        peer.on_track(Box::new(move |track, _, _| {
            let manager_arc_clone = manager_arc_clone.clone();
            let manager_arc_forward = manager_arc_clone.clone();
            let session_id = session_id.clone();
            let device_id = device_id.clone();
            let device_id_forward = device_id.clone();
            let codec_mime = track.codec().capability.mime_type.to_lowercase();
            let app = app.clone();
            let app_for_stats = app.clone();
            let peer_for_pli = peer_for_pli.clone();
            Box::pin(async move {
                let track_kind = track.kind();
                let track_ssrc = track.ssrc();

                if track_kind == RTPCodecType::Video {
                    async_runtime::spawn(async move {
                        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
                        loop {
                            interval.tick().await;
                            let pli = PictureLossIndication {
                                sender_ssrc: 0,
                                media_ssrc: track_ssrc,
                            };
                            if peer_for_pli.write_rtcp(&[Box::new(pli)]).await.is_err() {
                                break;
                            }
                        }
                    });
                }

                let track_reader = track.clone();
                async_runtime::spawn(async move {
                    let mut forwarded_packets: u64 = 0;
                    while let Ok((packet, _)) = track_reader.read_rtp().await {
                        let maybe_relay_track = {
                            let manager = manager_arc_forward.lock().await;
                            if !manager.should_forward_mobile_preview(&device_id_forward) {
                                None
                            } else if track_kind == RTPCodecType::Video {
                                if codec_mime.contains("h264") {
                                    Some(manager.mobile_preview_video_h264_track.clone())
                                } else {
                                    None
                                }
                            } else if track_kind == RTPCodecType::Audio {
                                Some(manager.mobile_preview_audio_track.clone())
                            } else {
                                None
                            }
                        };

                        if let Some(relay_track) = maybe_relay_track {
                            let _ = relay_track.write_rtp(&packet).await;
                            forwarded_packets += 1;
                            if forwarded_packets % 120 == 0 {
                                let _ = app_for_stats.emit(
                                    "mobile_preview_forward_stats",
                                    json!({
                                        "device_id": device_id_forward,
                                        "kind": if track_kind == RTPCodecType::Video { "video" } else if track_kind == RTPCodecType::Audio { "audio" } else { "other" },
                                        "codec": codec_mime,
                                        "packets": forwarded_packets,
                                    }),
                                );
                            }
                        }
                    }
                });

                let track_state = {
                    let mut manager = manager_arc_clone.lock().await;
                    manager.set_mobile_track_state(
                        &session_id,
                        track_kind == RTPCodecType::Video,
                        track_kind == RTPCodecType::Audio,
                    )
                };

                if let Some((has_video, has_audio, video_orientation)) = track_state {
                    let _ = app.emit(
                        "mobile_stream_started",
                        json!({
                            "device_id": device_id,
                            "has_video": has_video,
                            "has_audio": has_audio,
                            "video_orientation": video_orientation,
                        }),
                    );
                }
            })
        }));
    }

    peer.add_transceiver_from_kind(
        RTPCodecType::Audio,
        Some(RTCRtpTransceiverInit {
            direction: RTCRtpTransceiverDirection::Recvonly,
            send_encodings: vec![],
        }),
    )
    .await
    .map_err(|error| error.to_string())?;

    peer.add_transceiver_from_kind(
        RTPCodecType::Video,
        Some(RTCRtpTransceiverInit {
            direction: RTCRtpTransceiverDirection::Recvonly,
            send_encodings: vec![],
        }),
    )
    .await
    .map_err(|error| error.to_string())?;

    let previous_mobile_peer = {
        let mut manager = manager_arc.lock().await;
        let old =
            manager.insert_mobile_peer(
                session_id.to_string(),
                device_id.to_string(),
                peer.clone(),
                video_orientation.map(|value| value.to_string()),
            );
        manager.emit_status();
        old
    };

    if let Some(video_orientation) = video_orientation {
        let _ = app.emit(
            "mobile_stream_orientation_changed",
            json!({
                "device_id": device_id,
                "video_orientation": video_orientation,
            }),
        );
    }

    if let Some(previous_mobile_peer) = previous_mobile_peer {
        let _ = previous_mobile_peer.close().await;
    }

    let offer = RTCSessionDescription::offer(sdp.to_string()).map_err(|error| error.to_string())?;
    peer.set_remote_description(offer)
        .await
        .map_err(|error| error.to_string())?;

    let answer = peer
        .create_answer(None)
        .await
        .map_err(|error| error.to_string())?;
    peer.set_local_description(answer.clone())
        .await
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "event": "mobile_answer",
        "sdp": answer.sdp,
    });
    let _ = sender.send(Message::Text(payload.to_string()));

    Ok(())
}

pub async fn handle_session_closed(app: &AppHandle, session_id: &str) -> Result<(), String> {
    let state = app.state::<StreamingState>();
    cleanup_session(state.manager.clone(), session_id).await;
    Ok(())
}

async fn create_peer_connection(
    api: Arc<webrtc::api::API>,
) -> Result<Arc<RTCPeerConnection>, String> {
    let config = RTCConfiguration {
        ice_servers: vec![RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".to_string()],
            ..Default::default()
        }],
        ..Default::default()
    };

    api.new_peer_connection(config)
        .await
        .map(Arc::new)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamErrorPayload {
    pub event: &'static str,
    pub stream_type: String,
    pub reason: String,
}
