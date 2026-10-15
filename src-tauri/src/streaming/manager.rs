//! Shared streaming state and the Tauri commands exposed to the frontend.
//!
//! This module owns [`StreamManager`], the single source of truth for every
//! WebRTC artifact produced by the desktop app: local media tracks, the peer
//! connections currently subscribed to each stream, connected mobile peers,
//! per-device volumes and the HTML presentation server runtime. It is stored
//! inside a [`StreamingState`] and registered as Tauri managed state during
//! setup by [`initialize_streaming_state`].
//!
//! The functions annotated with `#[tauri::command]` at the bottom of the file
//! are the **frontend API**: they are invoked from the desktop webview through
//! `@tauri-apps/api` `invoke()` and mirror the TypeScript wrappers in
//! `src/services/streaming-service.ts`. Remote devices never call these
//! commands directly; they use the WebSocket signaling helpers in
//! [`crate::streaming::signaling`].
//!
//! # Events emitted
//!
//! * `streaming_status_changed` - emitted by [`StreamManager::emit_status`]
//!   after any mutation, carrying a [`StreamingStatus`] snapshot.
//! * `mobile_stream_ended` - emitted by [`cleanup_session`] when a mobile
//!   device stops sending, carrying `{ device_id }`.

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

/// Internal bookkeeping for one connected mobile device.
///
/// Created by [`crate::streaming::signaling::handle_mobile_offer`] when the
/// device sends its SDP offer and updated as tracks arrive.
struct MobilePeer {
    /// WebRTC connection used to receive (and relay) the device media.
    pub peer: Arc<RTCPeerConnection>,
    /// Stable device id supplied by the mobile client (see `crate::devices`).
    pub device_id: String,
    /// Set to `true` once at least one video track has been received.
    pub has_video: bool,
    /// Set to `true` once at least one audio track has been received.
    pub has_audio: bool,
    /// Last reported video orientation (`"portrait"` / `"landscape"`).
    pub video_orientation: Option<String>,
}

/// Central runtime state for the live streaming subsystem.
///
/// One instance lives inside [`StreamingState`] for the whole lifetime of the
/// app. All tracks and peer maps are protected by the [`tokio::sync::Mutex`]
/// wrapping this struct, so methods that only read a single field still take
/// `&self` while mutations take `&mut self`.
pub struct StreamManager {
    /// Handle used to emit Tauri events and resolve managed state.
    pub app: AppHandle,
    /// WebRTC API (media engine + interceptors) used to create peer
    /// connections.
    pub api: Arc<webrtc::api::API>,
    /// H264 track for the desktop `preview` stream.
    pub preview_track: Arc<TrackLocalStaticSample>,
    /// H264 track for the in-app `app_preview` stream, fed by
    /// [`crate::streaming::app_preview_producer`].
    pub app_preview_track: Arc<TrackLocalStaticSample>,
    /// H264 track for the `main` program output.
    pub main_track: Arc<TrackLocalStaticSample>,
    /// RTP passthrough track that relays H264 video received from a mobile
    /// device to `mobile_preview` subscribers.
    pub mobile_preview_video_h264_track: Arc<TrackLocalStaticRTP>,
    /// Opus RTP tracks keyed by mobile device id, created on demand when a
    /// device audio stream is requested.
    pub device_audio_tracks: HashMap<String, Arc<TrackLocalStaticRTP>>,
    /// Subscribers of the `preview` stream keyed by session id.
    pub preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    /// Subscribers of the `app_preview` stream keyed by session id.
    pub app_preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    /// Subscribers of the `main` stream keyed by session id.
    pub main_peers: HashMap<String, Arc<RTCPeerConnection>>,
    /// Subscribers of the `mobile_preview` relay keyed by session id.
    pub mobile_preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    /// Active mobile ingestion peers keyed by session id.
    mobile_peers: HashMap<String, MobilePeer>,
    /// Audio-only subscribers of a given mobile device, keyed by device id
    /// and then by session id (`device_id -> session_id -> peer`).
    pub mobile_audio_peers: HashMap<String, HashMap<String, Arc<RTCPeerConnection>>>,
    /// When `Some(device_id)`, only that device's video is relayed to
    /// `mobile_preview`; `None` forwards every device. Set by
    /// [`set_mobile_preview_device`].
    pub selected_mobile_preview_device: Option<String>,
    /// Active configuration, kept in sync with the on-disk
    /// [`StreamingConfig`].
    pub config: StreamingConfig,
    /// Whether protected content is currently hidden from streams. Requires
    /// [`StreamingConfig::content_protection`] to be enabled.
    pub is_content_protected: bool,
    /// Runtime of the local HTML presentation server.
    pub html_server: HtmlServerRuntime,
}

/// Tauri managed state wrapping the shared [`StreamManager`].
///
/// Obtained inside commands with `State<'_, StreamingState>`. The inner mutex
/// must be locked with `.lock().await`; helpers such as
/// [`crate::streaming::signaling::subscribe_stream`] clone the
/// [`Arc`] to keep the lock scope short.
#[derive(Clone)]
pub struct StreamingState {
    /// Shared manager guarded by an async mutex.
    pub manager: Arc<Mutex<StreamManager>>,
}

impl StreamManager {
    /// Builds a [`StreamingStatus`] snapshot from the current state.
    ///
    /// Subscriber counts are saturated at [`u8::MAX`] and the HTML server URL
    /// is included only while the server is running and the local IP can be
    /// resolved.
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

    /// Emits the `streaming_status_changed` Tauri event with a fresh
    /// [`Self::status`] snapshot.
    ///
    /// Called after every mutation that the frontend should observe.
    /// Emission failures are ignored.
    pub fn emit_status(&self) {
        let _ = self.app.emit("streaming_status_changed", self.status());
    }

    /// Starts or stops the HTML presentation server to match
    /// [`StreamingConfig::html_server_enabled`], binding
    /// [`StreamingConfig::html_server_port`] when enabled.
    ///
    /// Safe to call repeatedly: [`HtmlServerRuntime::start`] is a no-op when
    /// the server is already running on the requested port.
    pub fn apply_html_server_config(&mut self) {
        if self.config.html_server_enabled {
            self.html_server.start(self.config.html_server_port);
        } else {
            self.html_server.stop();
        }
    }

    /// Returns the WebRTC peer for a connected mobile device, or `None` if the
    /// given session id is not found.
    ///
    /// Used by [`crate::streaming::signaling`] helpers (e.g.
    /// [`crate::streaming::signaling::add_webrtc_ice_candidate`]) to reach
    /// mobile ingestion peers.
    pub fn get_mobile_peer(&self, session_id: &str) -> Option<Arc<RTCPeerConnection>> {
        self.mobile_peers
            .get(session_id)
            .map(|entry| entry.peer.clone())
    }

    /// Updates track reception flags for a mobile peer.
    ///
    /// Only flips `has_video` or `has_audio` to `true` if the corresponding
    /// argument is `true`. Returns the new `(has_video, has_audio,
    /// video_orientation)` triple for the peer, or `None` if the session was
    /// not found.
    ///
    /// Called by the mobile track handler in [`crate::streaming::signaling`].
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

    /// Inserts a new mobile peer. If a peer already exists for `session_id`,
    /// it is replaced and returned.
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

    /// Whether mobile preview video from `device_id` should be forwarded to
    /// `mobile_preview` subscribers.
    ///
    /// * If [`Self::selected_mobile_preview_device`] is `Some(selected)`,
    ///   only that device id is forwarded.
    /// * If `None`, every mobile device is forwarded.
    pub fn should_forward_mobile_preview(&self, device_id: &str) -> bool {
        match self.selected_mobile_preview_device.as_deref() {
            Some(selected) => selected == device_id,
            None => true,
        }
    }

    /// Ensures an RTP audio track exists for `device_id` and returns it.
    ///
    /// The track is created on first access with Opus codec parameters from
    /// [`crate::streaming::signaling::opus_codec_capability`] and the label
    /// `mobile_audio_{device_id}`.
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

    /// Whether there is at least one audio subscriber for `device_id`.
    pub fn has_mobile_audio_subscriber(&self, device_id: &str) -> bool {
        self.mobile_audio_peers
            .get(device_id)
            .map(|sessions| !sessions.is_empty())
            .unwrap_or(false)
    }

    /// Inserts an audio-only peer for a specific device. Returns the
    /// previous peer for that `(device_id, session_id)` if any.
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

    /// Returns the audio peer for `(device_id, session_id)` or `None` if not
    /// found.
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

    /// Removes an audio-only peer for `(device_id, session_id)`. If the
    /// device's subscriber map becomes empty, the device entry is pruned.
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

    /// Removes all audio-only peers tied to `session_id` (from any device)
    /// and returns the closed peer connections. Empty device maps are cleaned
    /// up.
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

    /// Removes all peer connections owned by `session_id` across all stream
    /// types.
    ///
    /// Returns a tuple:
    /// `(preview, app_preview, main, mobile_preview, mobile)` where
    /// `mobile` is `Some((peer, device_id))` if the session was a mobile
    /// ingestion peer, else `None`.
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

/// Initializes the streaming subsystem and registers its state with Tauri.
///
/// Boot sequence:
/// 1. Ensures the `config` directory exists.
/// 2. Creates the WebRTC [`MediaEngine`] and interceptor registry and builds
///    the [`webrtc::api::API`].
/// 3. Loads or creates the persisted [`StreamingConfig`] and starts the
///    [`HtmlServerRuntime`] if enabled.
/// 4. Creates all static local tracks (H264 for preview/app_preview/main and
///    the RTP passthrough for mobile preview video).
/// 5. Stores the [`StreamManager`] inside an [`Arc<Mutex<_>>`] wrapped by
///    [`StreamingState`].
/// 6. Starts the [`crate::streaming::app_preview_producer`] background task.
/// 7. Emits the initial `streaming_status_changed` event.
///
/// # Errors
///
/// Returns the underlying error message if storage cannot be prepared, WebRTC
/// setup fails, or the config cannot be loaded/written.
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

/// Tauri command: returns the current [`StreamingConfig`].
///
/// **Frontend API:** `invoke('get_streaming_config')`.
///
/// This is a read of the in-memory config (which mirrors the persisted file).
///
/// # Examples
///
/// ```ts
/// const cfg = await invoke<StreamingConfig>('get_streaming_config');
/// ```
#[tauri::command]
pub async fn get_streaming_config(
    state: State<'_, StreamingState>,
) -> Result<StreamingConfig, String> {
    Ok(state.manager.lock().await.config.clone())
}

/// Tauri command: updates and persists the streaming configuration.
///
/// **Frontend API:** `invoke('update_streaming_config', { config })`.
///
/// Behavior:
/// 1. Runs [`sanitize_config`] on the provided value.
/// 2. Persists the sanitized config via [`save_streaming_config`].
/// 3. Applies it to the running [`StreamManager`]: restarts the HTML server
///    if its enablement/port changed and recalculates
///    `is_content_protected` (it remains true only if both the new config
///    has `content_protection` enabled and the runtime flag was already
///    true; use [`set_stream_content_protected`] to toggle runtime state).
/// 4. Emits `streaming_status_changed`.
///
/// Returns the sanitized config that was stored/applied.
///
/// # Errors
///
/// Returns the underlying error message if the config cannot be saved.
///
/// # Examples
///
/// ```ts
/// const updated = await invoke<StreamingConfig>('update_streaming_config', {
///   config: nextCfg,
/// });
/// ```
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

/// Tauri command: returns a [`StreamingStatus`] snapshot.
///
/// **Frontend API:** `invoke('get_streaming_status')`.
#[tauri::command]
pub async fn get_streaming_status(
    state: State<'_, StreamingState>,
) -> Result<StreamingStatus, String> {
    Ok(state.manager.lock().await.status())
}

/// Tauri command: toggles the runtime `content_protected` flag.
///
/// **Frontend API:** `invoke('set_stream_content_protected', { isProtected })`.
///
/// The effective state used to hide protected content is the logical AND of
/// [`StreamingConfig::content_protection`] and this runtime flag. Calling
/// this will not change the persisted config; callers should update the
/// config via [`update_streaming_config`] if needed.
///
/// # Examples
///
/// ```ts
/// await invoke('set_stream_content_protected', { isProtected: true });
/// ```
#[tauri::command]
pub async fn set_stream_content_protected(
    state: State<'_, StreamingState>,
    is_protected: bool,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;
    manager.is_content_protected = manager.config.content_protection && is_protected;
    Ok(())
}

/// Tauri command: sets the master output volume, clamped to `0..=100`.
///
/// **Frontend API:** `invoke('set_stream_master_volume', { volume })`.
///
/// The new volume is persisted to the config and `streaming_status_changed`
/// is emitted. Returns the volume actually applied.
///
/// # Examples
///
/// ```ts
/// const v = await invoke<number>('set_stream_master_volume', { volume: 50 });
/// ```
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

/// Tauri command: sets the output volume for a specific mobile device,
/// clamped to `0..=100`.
///
/// **Frontend API:** `invoke('set_stream_device_volume', { deviceId, volume })`.
///
/// Stored under [`StreamingConfig::device_volumes`] and persisted. Emits
/// `streaming_status_changed`. Returns the volume applied.
///
/// # Examples
///
/// ```ts
/// const v = await invoke<number>('set_stream_device_volume', { deviceId, volume: 80 });
/// ```
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

/// Tauri command: pushes a slide update to the HTML presentation server.
///
/// **Frontend API:** `invoke('push_stream_slide', { update: SlideUpdate })`.
///
/// The `update` is serialized to JSON and broadcast to all connected HTML
/// presentation clients over WebSocket; the latest snapshot is also kept so
/// new clients receive it on connect.
///
/// # Errors
///
/// Never fails; this is a best-effort broadcast. The server must be active
/// for clients to receive it.
#[tauri::command]
pub async fn push_stream_slide(
    state: State<'_, StreamingState>,
    update: SlideUpdate,
) -> Result<(), String> {
    let manager = state.manager.lock().await;
    manager.html_server.push_slide(update);
    Ok(())
}

/// Tauri command: pushes a blank (black) frame to the HTML presentation
/// server.
///
/// **Frontend API:** `invoke('push_stream_blank')`.
///
/// Broadcasts `{ "type": "blank" }` to all HTML presentation clients and
/// updates the latest snapshot.
#[tauri::command]
pub async fn push_stream_blank(state: State<'_, StreamingState>) -> Result<(), String> {
    let manager = state.manager.lock().await;
    manager.html_server.push_blank();
    Ok(())
}

/// Tauri command: selects which mobile device's video is relayed to the
/// `mobile_preview` stream.
///
/// **Frontend API:** `invoke('set_mobile_preview_device', { deviceId })`.
///
/// Passing `None` forwards video from all mobile devices that are currently
/// sending. The choice affects only what is relayed to subscribers of
/// `mobile_preview`; it does not stop devices from ingesting.
/// `mobile_stream_started`/`ended` events are still emitted.
#[tauri::command]
pub async fn set_mobile_preview_device(
    state: State<'_, StreamingState>,
    device_id: Option<String>,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;
    manager.selected_mobile_preview_device = device_id;
    Ok(())
}

/// Closes all peer connections associated with `session_id` and emits lifecycle
/// events.
///
/// Called whenever a WebRTC session terminates (disconnect, fail, close) from
/// the peer state change handlers, and by
/// [`crate::streaming::signaling::handle_session_closed`]. It is an async
/// helper that takes the `Arc<Mutex<StreamManager>>` directly (rather than
/// `&mut self`) so it can drop the lock between lookups and `await`ing
/// `peer.close()`.
///
/// Actions:
/// 1. Extracts the app handle while holding the lock.
/// 2. Removes every peer tied to `session_id` (all stream types plus mobile
///    audio) and collects them.
/// 3. Emits `streaming_status_changed`.
/// 4. Closes all collected peers (preview/app_preview/main/mobile_preview
///    and every mobile audio peer).
/// 5. If a mobile ingestion peer was removed, closes it and emits
///    `mobile_stream_ended` with `{ device_id }`.
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
