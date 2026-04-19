# Broadcast Streaming — Architecture Design

## Media Flows

```
┌──────────────────────────────────────────────────────────────────┐
│                          LUMEN (Desktop)                          │
│                                                                    │
│  ┌──────────────┐   capture    ┌─────────────────────────────┐   │
│  │ media-window │─────────────►│  DXGI → H.264               │   │
│  └──────────────┘              │  preview_track  (fixed 1fps) │   │
│                                │  main_track     (cfg fps)   │   │
│                                └──────────────┬──────────────┘   │
│                                               │  video only      │
│  ┌──────────────┐                             ▼                   │
│  │ AudioEngine  │◄── audio            ┌──────────────┐           │
│  │ (playback)   │                     │  WebRTC Peers│           │
│  └──────────────┘    video ◄──────────│              │◄── mobile │
│                                       └──────────────┘           │
│                                                                    │
│  lyric-slide-changed ──────────────► [HTML Server :8090]         │
└──────────────────────────────────────────────────────────────────┘
```

**Desktop → Devices:** video only (H.264) — audio is managed by the local player and irrelevant for transmission.

**Mobile → Desktop:** audio + optional video from the device camera/microphone, received as an input source for the presentation.

---

## Rust Modules

```
src-tauri/src/
├── streaming/
│   ├── mod.rs          — StreamManager, AppState, StreamingConfig
│   ├── capture.rs      — DXGI Desktop Duplication (Windows)
│   ├── encoder.rs      — BGRA → YUV420p → H.264 pipeline (openh264)
│   ├── peer.rs         — RTCPeerConnection lifecycle (outbound + inbound)
│   └── signaling.rs    — WS message handlers for WebRTC
├── html_server.rs      — axum HTTP/WS server for HTML presentation
```

---

## StreamManager

Central state held in `Arc<Mutex<StreamManager>>` inside `AppState`.

```rust
pub struct StreamManager {
    preview_track: Arc<TrackLocalStaticSample>,
    main_track:    Arc<TrackLocalStaticSample>,

    preview_peers: HashMap<String, Arc<RTCPeerConnection>>,
    main_peers:    HashMap<String, Arc<RTCPeerConnection>>,
    mobile_peers:  HashMap<String, Arc<RTCPeerConnection>>,  // inbound: audio (+ optional video)

    capture_handle: Option<JoinHandle<()>>,
    config:         StreamingConfig,
    is_protected:   bool,

    app: AppHandle,
}
```

`preview_track` and `main_track` are created once. Each new peer receives the same `Arc<TrackLocalStaticSample>`. `write_sample()` fans out to all peers without re-encoding — encoding happens exactly once per frame regardless of how many devices are connected.

---

## Capture and Encoding (Desktop → Devices)

### Capture Loop

```rust
async fn capture_loop(
    preview_track: Arc<TrackLocalStaticSample>,
    main_track:    Arc<TrackLocalStaticSample>,
    state:         Arc<Mutex<StreamManager>>,
) {
    let interval = Duration::from_millis(1000 / fps as u64);
    let mut ticker = tokio::time::interval(interval);

    loop {
        ticker.tick().await;

        let (encoded, is_protected, has_main) = {
            let s = state.lock().await;
            if s.preview_peers.is_empty() && s.main_peers.is_empty() { break; }
            (
                if s.is_protected { black_frame(&s.config) }
                else { capture_and_encode(&s.config) },
                s.is_protected,
                !s.main_peers.is_empty(),
            )
        };

        let _ = preview_track.write_sample(&Sample { data: encoded.clone(), .. }).await;

        if has_main {
            let _ = main_track.write_sample(&Sample { data: encoded, .. }).await;
        }
    }
}
```

The loop only runs while there are active peers. When the last subscriber disconnects, the `JoinHandle` is aborted and no capture or encoding resources are consumed.

### Encoding Pipeline

Two paths selected at runtime by the `hardware_encoding` flag:

**Software (fallback):**
```
DXGI texture (GPU)
    │
    ▼  copy to CPU (BGRA)
    │
    ▼  bgra_to_yuv420p()              — color conversion on CPU
    │
    ▼  openh264::Encoder::encode()    — H.264 encode on CPU
    │  ~15-25% CPU at 1080p@30fps
    │
NAL units → TrackLocalStaticSample::write_sample()
```

**Hardware (when `hardware_encoding: true`):**
```
DXGI texture (GPU — ID3D11Texture2D)
    │
    ▼  IMFDXGIBuffer                  — zero-copy: texture goes directly into MF
    │
    ▼  GPU shader BGRA → NV12        — color conversion on GPU
    │
    ▼  IMFTransform (hardware encoder)
    │  Windows Media Foundation automatically selects:
    │    · NVENC      (NVIDIA)
    │    · Quick Sync (Intel)
    │    · AMF        (AMD)
    │  ~1-3% CPU | ~5% GPU (dedicated block, does not affect graphics)
    │  Latency: ~1-5ms vs ~10-30ms software
    │
NAL units → TrackLocalStaticSample::write_sample()
```

The frame never leaves the GPU in the hardware path — DXGI delivers an `ID3D11Texture2D`, and `IMFDXGIBuffer` passes it directly to the encoder via a shared surface. The CPU only touches the final NAL units for RTP packetization.

`IMFTransform` with category `MFT_CATEGORY_VIDEO_ENCODER` is the unified Windows API that abstracts NVENC/QSV/AMF. If no hardware encoder is available, MF automatically falls back to the Windows native software encoder — but in that case `openh264` is preferred for better bitrate control.

### Platform Support

| | Windows | macOS | Linux |
|---|---|---|---|
| **Screen capture** | DXGI Desktop Duplication | ScreenCaptureKit (12.3+) | PipeWire (X11 + Wayland) |
| **Hardware encoding API** | Windows Media Foundation | VideoToolbox | VAAPI |
| **Automatic GPU selection** | Yes — MF picks NVENC/QSV/AMF | Yes — VT uses Media Engine or GPU | No — requires detection |
| **NVIDIA hardware** | NVENC via MF | — | NVENC (needs proprietary driver) |
| **AMD hardware** | AMF via MF | Discrete GPU via VT (Intel Macs) | VAAPI via Mesa |
| **Intel hardware** | Quick Sync via MF | Quick Sync via VT (Intel Macs) | VAAPI |
| **Apple Silicon** | — | Dedicated Media Engine (M1+) | — |
| **Software fallback** | openh264 | openh264 | openh264 |

**macOS — VideoToolbox:** native API equivalent to Media Foundation. On Apple Silicon (M1+) it uses the Media Engine block — dedicated hardware separate from shader cores that runs encoding in parallel with everything else. The zero-copy integration is analogous to Windows: `ScreenCaptureKit` delivers an `IOSurface` (GPU memory texture) that `VTCompressionSession` accepts directly via `CVPixelBuffer`, without a CPU round-trip.

**Linux — VAAPI:** Intel and AMD have solid support via open source Mesa. NVIDIA requires proprietary drivers. `libva` is a system library present on any distro with an Intel/AMD driver installed — dynamically linked at runtime, no bundle cost. If `libva` is unavailable (NVIDIA without vaapi-driver, or no GPU), falls back to `openh264`. For screen capture, PipeWire works on both X11 and Wayland and is the standard on modern distros.

**Common configuration across all paths:**
```
Profile:           Baseline  — maximum mobile compatibility
Keyframe interval: 2s
Bitrate:           720p → 1 Mbps | 1080p → 3 Mbps | 1440p → 6 Mbps | 4K → 12 Mbps
```

---

## Mobile → Desktop Flow (Inbound)

Single connection per device. The Desktop negotiates `Recvonly` for any track present in the offer:

```rust
peer.add_transceiver_from_kind(RTPCodecType::Audio,
    RTCRtpTransceiverInit { direction: Recvonly, .. }).await?;
peer.add_transceiver_from_kind(RTPCodecType::Video,
    RTCRtpTransceiverInit { direction: Recvonly, .. }).await?;
```

The mobile decides what to include in the offer before sending it. If it includes only audio, the video m-line is absent from the SDP and no video transceiver is created. If video needs to be added later, it renegotiates on the same `RTCPeerConnection` without creating a new connection.

When tracks arrive via `on_track`:
- **Audio track** → Lumen's `AudioEngine` for presentation playback
- **Video track** (if present) → emits `mobile_stream_started { device_id, has_video: true }` so the frontend can display the camera feed as an available source

---

## Signaling Protocol (WebSocket — port 8080)

Extension of the existing protocol. All WebRTC messages require authentication and the `streaming` permission.

### Device → Desktop

```jsonc
// subscribe to outbound stream (desktop → device)
{ "event": "subscribe_stream",   "stream_type": "preview" | "main" }
{ "event": "unsubscribe_stream", "stream_type": "preview" | "main" }

// SDP answer for outbound stream
{ "event": "webrtc_answer", "stream_type": "preview" | "main", "sdp": "..." }

// mobile sends inbound offer (audio required, video optional)
{ "event": "mobile_offer", "sdp": "..." }

// ICE candidates (any direction)
{ "event": "webrtc_ice_candidate", "stream_type": "preview" | "main" | "mobile", "candidate": { "candidate": "...", "sdpMid": "0" } }
```

### Desktop → Device

```jsonc
{ "event": "stream_offer",         "stream_type": "preview" | "main", "sdp": "..." }
{ "event": "stream_ice_candidate", "stream_type": "preview" | "main" | "mobile", "candidate": { ... } }
{ "event": "stream_stopped",       "stream_type": "preview" | "main" }
{ "event": "stream_error",         "stream_type": "...", "reason": "no_permission" | "not_enabled" | "capture_failed" }

{ "event": "mobile_answer", "sdp": "..." }
```

### Permission Mapping

```rust
fn map_event_permission(event: &str) -> Option<&str> {
    match event {
        // existing...
        "subscribe_stream" | "unsubscribe_stream"
        | "webrtc_answer" | "webrtc_ice_candidate"
        | "mobile_offer" => Some("streaming"),
        _ => None,
    }
}
```

---

## WebRTC Signaling Flow (Outbound)

```
Device                    WS :8080                  StreamManager
  │                          │                            │
  ├─ subscribe_stream ───────►│                            │
  │                          ├─ check permission          │
  │                          ├─ subscribe(id, Preview) ──►│
  │                          │                            ├─ new RTCPeerConnection
  │                          │                            ├─ add_track(preview_track)
  │                          │                            ├─ createOffer()
  │◄─ stream_offer (SDP) ────│◄── offer SDP ─────────────│
  │                          │                            │
  ├─ webrtc_answer ──────────►│                            │
  │                          ├─ setRemoteDescription() ──►│
  │                          │                            │
  ├─ webrtc_ice_candidate ───►│◄──► onIceCandidate ───────│
  │◄─ stream_ice_candidate ───│                            │
  │                          │                            │
  │◄══ H.264 video (WebRTC P2P) ════════════════════════════│
```

**ICE on LAN:** host candidates (local IP) are sufficient. Public STUN as optional fallback:

```rust
RTCConfiguration {
    ice_servers: vec![RTCIceServer {
        urls: vec!["stun:stun.l.google.com:19302".to_owned()],
        ..Default::default()
    }],
    ..Default::default()
}
```

---

## HTML Presentation Server

Standalone HTTP server in `axum`, port **8090**, independent of WebRTC.

```
GET /        → self-contained HTML page (inline CSS + JS)
GET /ws      → WebSocket — receives SlideUpdate pushes
GET /health  → { "status": "ok" }
```

### SlideUpdate Payload

```rust
pub struct SlideUpdate {
    pub lines: Vec<String>,
    pub font: Option<String>,
    pub font_size: Option<u32>,
    pub alignment: Option<String>,   // "left" | "center" | "right"
    pub background: Option<String>,  // hex color or image path
    pub slide_index: usize,
    pub total_slides: usize,
    pub active: bool,                // false → blank (black screen)
}
```

```jsonc
// push to WS clients
{ "type": "slide", "lines": ["Line 1", "Line 2"], "font": "Inter", "font_size": 48,
  "alignment": "center", "background": "#000000", "slide_index": 2, "total_slides": 10, "active": true }
{ "type": "blank" }
```

### Integration with existing Tauri event

```rust
app.listen("lyric-slide-changed", {
    let html_server = html_server.clone();
    move |event| {
        let payload: LyricSlideChangedPayload = serde_json::from_str(event.payload()).unwrap();
        tokio::spawn(async move {
            html_server.push_slide(SlideUpdate::from(payload)).await;
        });
    }
});
```

The HTML template mirrors the behavior of `lyric-presentation.tsx`: CSS `opacity` fade transition of 250ms, CSS vars for font/alignment/background, `innerHTML` updated via WS without page reload.

---

## Settings Model

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct StreamingConfig {
    pub preview_enabled:     bool,
    pub main_fps:            u8,      // 1 | 15 | 24 | 30 | 60
    pub main_resolution:     String,  // "720p" | "1080p" | "1440p" | "4K"
    pub html_server_enabled: bool,
    pub html_server_port:    u16,
    pub content_protection:  bool,
}

impl Default for StreamingConfig {
    fn default() -> Self {
        Self {
            preview_enabled:     true,
            main_fps:            1,
            main_resolution:     "1080p".to_owned(),
            html_server_enabled: false,
            html_server_port:    8090,
            content_protection:  true,
        }
    }
}
```

Persisted at: `{app_base_path}/config/streaming.json` — same pattern as `remote-access.json`.

---

## Permission Extension

### `devices.rs`

```rust
pub struct DevicePermissions {
    pub player:    bool,
    pub lyrics:    bool,
    pub bible:     bool,
    pub media:     bool,
    pub streaming: bool,  // NEW
}
```

### SQLite Migration

```sql
ALTER TABLE devices ADD COLUMN permissions_streaming INTEGER DEFAULT 0;
```

Applied in `setup_db()` with schema version check.

---

## Tauri Commands

```rust
#[tauri::command] async fn get_streaming_config()    -> StreamingConfig
#[tauri::command] async fn update_streaming_config(config: StreamingConfig)
#[tauri::command] async fn get_streaming_status()   -> StreamingStatus
// StreamingStatus { preview_subs: u8, main_subs: u8, mobile_connected: bool,
//                   html_active: bool, html_url: Option<String> }
```

## Tauri Events Emitted

| Event | Payload | When |
|---|---|---|
| `streaming_status_changed` | `StreamingStatus` | subscriber connects or disconnects |
| `mobile_stream_started` | `{ device_id, has_video: bool }` | mobile connects (audio always, video optional) |
| `mobile_stream_ended`   | `{ device_id }`                  | mobile disconnects |

---

## Frontend — New Files

### `src/services/streaming-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface StreamingConfig {
  preview_enabled: boolean;
  main_fps: 1 | 15 | 24 | 30 | 60;
  main_resolution: "720p" | "1080p" | "1440p" | "4K";
  html_server_enabled: boolean;
  html_server_port: number;
  content_protection: boolean;
}

export interface StreamingStatus {
  preview_subs: number;
  main_subs: number;
  mobile_connected: boolean;
  html_active: boolean;
  html_url: string | null;
}

export const streamingService = {
  getConfig:    ()                             => invoke<StreamingConfig>("get_streaming_config"),
  updateConfig: (c: Partial<StreamingConfig>) => invoke("update_streaming_config", { config: c }),
  getStatus:    ()                             => invoke<StreamingStatus>("get_streaming_status"),
};
```

### `src/stores/streaming-store.ts`

```typescript
import { create } from "zustand";
import { streamingService, StreamingConfig, StreamingStatus } from "@/services/streaming-service";
import { listen } from "@tauri-apps/api/event";

interface StreamingStore {
  config: StreamingConfig;
  status: StreamingStatus;
  init: () => Promise<void>;
  updateConfig: (partial: Partial<StreamingConfig>) => Promise<void>;
}

export const useStreamingStore = create<StreamingStore>((set, get) => ({
  config: {} as StreamingConfig,
  status: { preview_subs: 0, main_subs: 0, mobile_connected: false, html_active: false, html_url: null },

  init: async () => {
    const [config, status] = await Promise.all([
      streamingService.getConfig(),
      streamingService.getStatus(),
    ]);
    set({ config, status });
    listen<StreamingStatus>("streaming_status_changed", ({ payload }) => set({ status: payload }));
  },

  updateConfig: async (partial) => {
    const next = { ...get().config, ...partial };
    await streamingService.updateConfig(next);
    set({ config: next });
  },
}));
```

---

## Existing Files to Modify

| File | Change |
|---|---|
| `src-tauri/src/devices.rs` | + `permissions_streaming` in `DevicePermissions`; schema migration |
| `src-tauri/src/websocket.rs` | Route `subscribe_stream`, `unsubscribe_stream`, `webrtc_answer`, `webrtc_ice_candidate`, `mobile_offer` to `StreamManager` |
| `src-tauri/src/main.rs` | Initialize `StreamManager` and `HtmlServer`; register new Tauri commands; `lyric-slide-changed` listener |
| `src/components/settings/advanced-section.tsx` | Connect selects to `useStreamingStore`; HTML server section; live subscriber count badge |
| `src/components/settings/device-permissions-section.tsx` | + "Streaming" toggle per device |
| `src/services/remote-sync-service.ts` | When broadcasting with `media.type === "video"`, invoke `set_stream_content_protected(true)` |

---

## Crates to Add

```toml
# src-tauri/Cargo.toml
webrtc   = "0.11"
openh264 = "0.6"           # software fallback — always bundled
axum     = { version = "0.7", features = ["ws"] }

[target.'cfg(target_os = "windows")'.dependencies]
windows-capture = "1.4"    # DXGI Desktop Duplication

[target.'cfg(target_os = "macos")'.dependencies]
scap  = "0.1"              # ScreenCaptureKit wrapper
vtenc = "0.3"              # direct VideoToolbox bindings (system framework)

[target.'cfg(target_os = "linux")'.dependencies]
scap      = "0.1"          # PipeWire (X11 + Wayland)
libva-sys = "0.1"          # VAAPI bindings — dynamically linked against system libva
```

None of these dependencies add weight to the bundle:

| Platform | Hardware encoder | Bundle cost |
|---|---|---|
| Windows | Media Foundation via `windows` crate (already a dependency) | zero |
| macOS | VideoToolbox via `vtenc` — Apple system framework | zero |
| Linux | VAAPI via `libva-sys` — dynamic link against system `libva` | zero |

`openh264` is the only bundled encoder (~1-2MB), used as fallback on any platform when hardware encoding is unavailable. FFmpeg is not required.
