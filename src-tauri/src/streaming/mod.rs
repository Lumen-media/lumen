//! Live streaming subsystem for Lumen events.
//!
//! The streaming stack turns the desktop app into a small WebRTC media hub:
//! it publishes local tracks (desktop preview, app preview, main output,
//! mobile preview relay and per-device audio) to subscribers, ingests the
//! camera/microphone feeds sent by mobile devices, and can mirror the current
//! slide to a plain HTML page for external displays or projectors.
//!
//! # Module layout
//!
//! * [`config`] - persistent [`config::StreamingConfig`] and the derived
//!   [`config::StreamingStatus`] snapshot shared with the frontend.
//! * [`manager`] - [`manager::StreamManager`], the shared state that owns
//!   tracks, peer connections, volumes and the HTML server runtime, plus the
//!   Tauri commands used by the desktop webview.
//! * [`signaling`] - WebSocket-facing helpers: stream type negotiation, SDP
//!   offer/answer exchange, ICE candidate relay, mobile offer handling and
//!   the codec capabilities used to build every track.
//! * [`html_server`] - local HTTP/WebSocket server that renders the current
//!   slide as a full-screen HTML presentation.
//! * [`app_preview_producer`] - background producer that captures the app
//!   window, encodes it with OpenH264 and writes it to the app preview track.
//!
//! # Frontend API
//!
//! The desktop webview drives this module through the Tauri commands defined
//! in [`manager`] (`get_streaming_config`, `update_streaming_config`,
//! `get_streaming_status`, `set_stream_content_protected`,
//! `set_stream_master_volume`, `set_stream_device_volume`,
//! `push_stream_slide`, `push_stream_blank` and `set_mobile_preview_device`).
//! Remote devices negotiate media over WebSocket using the `subscribe_stream`,
//! `unsubscribe_stream`, `webrtc_answer`, `webrtc_ice_candidate` and
//! `mobile_offer` events dispatched by `crate::websocket`.
//!
//! # Events
//!
//! The subsystem emits these Tauri events to the desktop webview:
//!
//! * `streaming_status_changed` - status snapshot after any state change.
//! * `mobile_stream_started`, `mobile_stream_ended`,
//!   `mobile_stream_orientation_changed` - mobile ingestion lifecycle.
//! * `mobile_preview_forward_stats` - periodic RTP forwarding counters.
//! * `streaming_debug_log` - diagnostics from the signaling layer and the
//!   app preview producer.

mod app_preview_producer;
mod config;
mod html_server;
pub mod manager;
mod signaling;

pub use manager::initialize_streaming_state;
pub use signaling::{
    StreamErrorPayload, WebRtcIceCandidatePayload, add_webrtc_ice_candidate, handle_mobile_offer,
    handle_session_closed, set_webrtc_answer, subscribe_stream, unsubscribe_stream,
};
