use std::{collections::HashMap, sync::Arc};

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use webrtc::{
    api::{
        APIBuilder, interceptor_registry::register_default_interceptors, media_engine::MediaEngine,
    },
    interceptor::registry::Registry,
    peer_connection::RTCPeerConnection,
    track::track_local::{
        track_local_static_rtp::TrackLocalStaticRTP,
        track_local_static_sample::TrackLocalStaticSample,
    },
};

use super::{
    config::{
        StreamingConfig, StreamingStatus, ensure_streaming_storage, load_streaming_config,
        sanitize_config, save_streaming_config,
    },
    html_server::{HtmlServerRuntime, SlideUpdate},
};

struct MobilePeer {
    pub peer: Arc<RTCPeerConnection>,
    pub device_id: String,
    pub has_video: bool,
    pub has_audio: bool,
    pub video_orientation: Option<String>,
}

pub struct StreamManager {
    pub app: AppHandle,
    pub api: Arc<webrtc::api::API>,
    pub preview_track: Arc<TrackLocalStaticSample>,
    pub app_preview_track: Arc<TrackLocalStaticSample>,
    pub main_track: Arc<TrackLocalStaticSample>,
    pub mobile_preview_video_h264_track: Arc<TrackLocalStaticRTP>,
    pub device_audio_tracks: HashMap<String, Arc<TrackLocalStaticRTP>>,
    pub preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    pub app_preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    pub main_peers: HashMap<String, Arc<RTCPeerConnection>>,
    pub mobile_preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    mobile_peers: HashMap<String, MobilePeer>,
    pub mobile_audio_peers: HashMap<String, HashMap<String, Arc<RTCPeerConnection>>>,
    pub selected_mobile_preview_device: Option<String>,
    pub config: StreamingConfig,
    pub is_content_protected: bool,
    pub html_server: HtmlServerRuntime,
}

#[derive(Clone)]
pub struct StreamingState {
    pub manager: Arc<Mutex<StreamManager>>,
}

impl StreamManager {
    pub fn status(&self) -> StreamingStatus {
        let total_preview_subs = self.preview_peers.len() + self.app_preview_peers.len();
        StreamingStatus {
            preview_subs: total_preview_subs.min(u8::MAX as usize) as u8,
            main_subs: self.main_peers.len().min(u8::MAX as usize) as u8,
            mobile_connected: !self.mobile_peers.is_empty(),
            html_active: self.html_server.is_active(),
            html_url: self.html_server.url(),
            master_volume: self.config.master_volume,
            device_volumes: self.config.device_volumes.clone(),
        }
    }

    pub fn emit_status(&self) {
        let _ = self.app.emit("streaming_status_changed", self.status());
    }

    pub fn apply_html_server_config(&mut self) {
        if self.config.html_server_enabled {
            self.html_server.start(self.config.html_server_port);
        } else {
            self.html_server.stop();
        }
    }

    pub fn get_mobile_peer(&self, session_id: &str) -> Option<Arc<RTCPeerConnection>> {
        self.mobile_peers
            .get(session_id)
            .map(|entry| entry.peer.clone())
    }

    pub fn set_mobile_track_state(
        &mut self,
        session_id: &str,
        video_received: bool,
        audio_received: bool,
    ) -> Option<(bool, bool, Option<String>)> {
        if let Some(entry) = self.mobile_peers.get_mut(session_id) {
            if video_received {
                entry.has_video = true;
            }
            if audio_received {
                entry.has_audio = true;
            }
            return Some((
                entry.has_video,
                entry.has_audio,
                entry.video_orientation.clone(),
            ));
        }
        None
    }

    pub fn insert_mobile_peer(
        &mut self,
        session_id: String,
        device_id: String,
        peer: Arc<RTCPeerConnection>,
        video_orientation: Option<String>,
    ) -> Option<Arc<RTCPeerConnection>> {
        let previous = self.mobile_peers.insert(
            session_id,
            MobilePeer {
                peer,
                device_id,
                has_video: false,
                has_audio: false,
                video_orientation,
            },
        );
        previous.map(|entry| entry.peer)
    }

    pub fn should_forward_mobile_preview(&self, device_id: &str) -> bool {
        match self.selected_mobile_preview_device.as_deref() {
            Some(selected) => selected == device_id,
            None => true,
        }
    }

    pub fn ensure_device_audio_track(&mut self, device_id: &str) -> Arc<TrackLocalStaticRTP> {
        self.device_audio_tracks
            .entry(device_id.to_string())
            .or_insert_with(|| {
                Arc::new(TrackLocalStaticRTP::new(
                    super::signaling::opus_codec_capability(),
                    format!("mobile_audio_{device_id}"),
                    "lumen".to_string(),
                ))
            })
            .clone()
    }

    pub fn has_mobile_audio_subscriber(&self, device_id: &str) -> bool {
        self.mobile_audio_peers
            .get(device_id)
            .map(|sessions| !sessions.is_empty())
            .unwrap_or(false)
    }

    pub fn insert_mobile_audio_peer(
        &mut self,
        device_id: &str,
        session_id: &str,
        peer: Arc<RTCPeerConnection>,
    ) -> Option<Arc<RTCPeerConnection>> {
        self.mobile_audio_peers
            .entry(device_id.to_string())
            .or_default()
            .insert(session_id.to_string(), peer)
    }

    pub fn get_mobile_audio_peer(
        &self,
        device_id: &str,
        session_id: &str,
    ) -> Option<Arc<RTCPeerConnection>> {
        self.mobile_audio_peers
            .get(device_id)
            .and_then(|sessions| sessions.get(session_id))
            .cloned()
    }

    pub fn remove_mobile_audio_peer(
        &mut self,
        device_id: &str,
        session_id: &str,
    ) -> Option<Arc<RTCPeerConnection>> {
        let removed = self
            .mobile_audio_peers
            .get_mut(device_id)
            .and_then(|sessions| sessions.remove(session_id));
        if self
            .mobile_audio_peers
            .get(device_id)
            .is_none_or(|sessions| sessions.is_empty())
        {
            self.mobile_audio_peers.remove(device_id);
        }
        removed
    }

    pub fn remove_mobile_audio_session(
        &mut self,
        session_id: &str,
    ) -> Vec<Arc<RTCPeerConnection>> {
        let mut closed = Vec::new();
        let mut empty_devices = Vec::new();
        for (device_id, sessions) in self.mobile_audio_peers.iter_mut() {
            if let Some(peer) = sessions.remove(session_id) {
                closed.push(peer);
            }
            if sessions.is_empty() {
                empty_devices.push(device_id.clone());
            }
        }
        for device_id in empty_devices {
            self.mobile_audio_peers.remove(&device_id);
        }
        closed
    }

    pub fn remove_session(
        &mut self,
        session_id: &str,
    ) -> (
        Option<Arc<RTCPeerConnection>>,
        Option<Arc<RTCPeerConnection>>,
        Option<Arc<RTCPeerConnection>>,
        Option<Arc<RTCPeerConnection>>,
        Option<(Arc<RTCPeerConnection>, String)>,
    ) {
        let preview = self.preview_peers.remove(session_id);
        let app_preview = self.app_preview_peers.remove(session_id);
        let main = self.main_peers.remove(session_id);
        let mobile_preview = self.mobile_preview_peers.remove(session_id);
        let mobile = self
            .mobile_peers
            .remove(session_id)
            .map(|entry| (entry.peer, entry.device_id));
        (preview, app_preview, main, mobile_preview, mobile)
    }
}

pub fn initialize_streaming_state(app: &AppHandle) -> Result<StreamingState, String> {
    ensure_streaming_storage()?;

    let mut media_engine = MediaEngine::default();
    media_engine
        .register_default_codecs()
        .map_err(|error| error.to_string())?;

    let mut interceptor_registry = Registry::new();
    interceptor_registry = register_default_interceptors(interceptor_registry, &mut media_engine)
        .map_err(|error| error.to_string())?;

    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(interceptor_registry)
        .build();

    let config = load_streaming_config()?;
    let mut manager = StreamManager {
        app: app.clone(),
        api: Arc::new(api),
        preview_track: Arc::new(TrackLocalStaticSample::new(
            super::signaling::h264_codec_capability(),
            "preview".to_string(),
            "lumen".to_string(),
        )),
        app_preview_track: Arc::new(TrackLocalStaticSample::new(
            super::signaling::h264_codec_capability(),
            "app_preview".to_string(),
            "lumen".to_string(),
        )),
        main_track: Arc::new(TrackLocalStaticSample::new(
            super::signaling::h264_codec_capability(),
            "main".to_string(),
            "lumen".to_string(),
        )),
        mobile_preview_video_h264_track: Arc::new(TrackLocalStaticRTP::new(
            super::signaling::h264_passthrough_codec_capability(),
            "mobile_preview_video_h264".to_string(),
            "lumen".to_string(),
        )),
        device_audio_tracks: HashMap::new(),
        preview_peers: HashMap::new(),
        app_preview_peers: HashMap::new(),
        main_peers: HashMap::new(),
        mobile_preview_peers: HashMap::new(),
        mobile_peers: HashMap::new(),
        mobile_audio_peers: HashMap::new(),
        selected_mobile_preview_device: None,
        is_content_protected: false,
        html_server: HtmlServerRuntime::new(),
        config,
    };

    manager.apply_html_server_config();
    manager.emit_status();

    let state = StreamingState {
        manager: Arc::new(Mutex::new(manager)),
    };

    super::app_preview_producer::start_app_preview_producer(state.manager.clone());

    Ok(state)
}

#[tauri::command]
pub async fn get_streaming_config(
    state: State<'_, StreamingState>,
) -> Result<StreamingConfig, String> {
    Ok(state.manager.lock().await.config.clone())
}

#[tauri::command]
pub async fn update_streaming_config(
    state: State<'_, StreamingState>,
    config: StreamingConfig,
) -> Result<StreamingConfig, String> {
    let next = sanitize_config(config);
    save_streaming_config(&next)?;

    let mut manager = state.manager.lock().await;
    let was_content_protected = manager.is_content_protected;
    manager.config = next.clone();
    manager.is_content_protected = manager.config.content_protection && was_content_protected;
    manager.apply_html_server_config();
    manager.emit_status();

    Ok(next)
}

#[tauri::command]
pub async fn get_streaming_status(
    state: State<'_, StreamingState>,
) -> Result<StreamingStatus, String> {
    Ok(state.manager.lock().await.status())
}

#[tauri::command]
pub async fn set_stream_content_protected(
    state: State<'_, StreamingState>,
    is_protected: bool,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;
    manager.is_content_protected = manager.config.content_protection && is_protected;
    Ok(())
}

#[tauri::command]
pub async fn set_stream_master_volume(
    state: State<'_, StreamingState>,
    volume: u8,
) -> Result<u8, String> {
    let mut manager = state.manager.lock().await;
    let next = volume.min(100);
    manager.config.master_volume = next;
    save_streaming_config(&manager.config)?;
    manager.emit_status();
    Ok(next)
}

#[tauri::command]
pub async fn set_stream_device_volume(
    state: State<'_, StreamingState>,
    device_id: String,
    volume: u8,
) -> Result<u8, String> {
    let mut manager = state.manager.lock().await;
    let next = volume.min(100);
    manager.config.device_volumes.insert(device_id, next);
    save_streaming_config(&manager.config)?;
    manager.emit_status();
    Ok(next)
}

#[tauri::command]
pub async fn push_stream_slide(
    state: State<'_, StreamingState>,
    update: SlideUpdate,
) -> Result<(), String> {
    let manager = state.manager.lock().await;
    manager.html_server.push_slide(update);
    Ok(())
}

#[tauri::command]
pub async fn push_stream_blank(state: State<'_, StreamingState>) -> Result<(), String> {
    let manager = state.manager.lock().await;
    manager.html_server.push_blank();
    Ok(())
}

#[tauri::command]
pub async fn set_mobile_preview_device(
    state: State<'_, StreamingState>,
    device_id: Option<String>,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;
    manager.selected_mobile_preview_device = device_id;
    Ok(())
}

pub async fn cleanup_session(state: Arc<Mutex<StreamManager>>, session_id: &str) {
    let app = {
        let manager = state.lock().await;
        manager.app.clone()
    };

    let ((preview, app_preview, main, mobile_preview, mobile), mobile_audio_peers) = {
        let mut manager = state.lock().await;
        let removed = manager.remove_session(session_id);
        let mobile_audio_peers = manager.remove_mobile_audio_session(session_id);
        manager.emit_status();
        (removed, mobile_audio_peers)
    };

    if let Some(preview) = preview {
        let _ = preview.close().await;
    }

    if let Some(app_preview) = app_preview {
        let _ = app_preview.close().await;
    }

    if let Some(main) = main {
        let _ = main.close().await;
    }

    if let Some(mobile_preview) = mobile_preview {
        let _ = mobile_preview.close().await;
    }

    for mobile_audio_peer in mobile_audio_peers {
        let _ = mobile_audio_peer.close().await;
    }

    if let Some((mobile, device_id)) = mobile {
        let _ = mobile.close().await;
        let _ = app.emit("mobile_stream_ended", json!({ "device_id": device_id }));
    }
}
