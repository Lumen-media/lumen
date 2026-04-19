# Broadcast Streaming — Feature Plan

## Overview

Lumen already syncs playback state (metadata, position, slide index) with remote devices via WebSocket. This feature adds **visual transmission**, allowing mobile devices and browsers to see the presentation content in real time without needing the file open locally.

## Stream Types

### Preview Stream
- Fixed FPS: **1fps**
- Quality: low resolution (sufficient as a visual reference on mobile)
- Protocol: WebRTC (H.264 video track)
- Activation: on-demand — only starts when a device sends `subscribe_stream { stream_type: "preview" }`
- Stops automatically when the last subscriber disconnects
- Minimal hardware cost (one capture per second)

### Main Stream
- Configurable FPS: **1 | 15 | 24 | 30 | 60** (default: 1)
- Configurable resolution: **720p | 1080p | 1440p | 4K** (default: 1080p)
- Protocol: WebRTC (H.264 video track)
- Same on-demand model as preview
- Intended for production use (secondary display, public broadcast, etc.)

### HTML Presentation Server
- Standalone HTTP server on port **8090** (configurable)
- `GET /` → HTML page with the current styled slide (font, size, lyric background)
- `GET /ws` → WebSocket that receives real-time update pushes
- Accessible from any browser — no app required
- Ideal for lyrics, text, announcements, and notes
- Updates automatically when the slide changes
- Blank mode when no content is active

## On-Demand Model

Each stream only consumes resources while there are active subscribers:

```
subscribe_stream received:
    0 → 1 subscriber: start capture + frame loop
    N → N+1: add peer connection only

unsubscribe_stream / disconnect:
    N → N-1: remove peer connection
    1 → 0: stop capture, release CPU/GPU
```

The HTML server is toggled on/off via settings, independently of subscribers.

## Content Protection

Capturing a window with DRM video (e.g. Netflix in a browser) results in a black frame at the OS level. To handle this intentionally:

- **Default:** black frame transmitted
- **Transmits content:** only when `media.type` is `lyric`, `image`, or `stream`
- **When `media.type == "video"`:** keeps black frame but continues transmitting metadata via player_sync
- "Content Protection" toggle in settings allows disabling this behavior

The HTML server is unaffected by this issue since it renders from slide data (text/image), not captured pixels.

## Screen Capture

Captures exclusively the **media-window** (fullscreen window on the secondary monitor), not the main app window. This:
- Avoids exposing Lumen's internal UI
- Shows exactly what the operator sees on the presentation display
- Reduces the surface area for accidental content exposure

## Device Permission Extension

New `streaming` permission added to the device model, alongside `player`, `lyrics`, `bible`, and `media`.

- Devices without `permissions_streaming = true` receive `stream_error { reason: "no_permission" }` when attempting to subscribe
- Controllable per device on the device management screen

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `preview_enabled` | bool | true | Allow preview stream when requested |
| `main_fps` | u8 | 1 | Main stream FPS (1/15/24/30/60) |
| `main_resolution` | string | "1080p" | Resolution (720p/1080p/1440p/4K) |
| `html_server_enabled` | bool | false | Toggle HTML server on/off |
| `html_server_port` | u16 | 8090 | HTML server port |
| `hardware_encoding` | bool | false | GPU hardware encoding |
| `content_protection` | bool | true | Black frame when DRM video is active |

Persisted at: `{app_base_path}/config/streaming.json`

## UI Changes

### `advanced-section.tsx`

**Video Transmission** (connect to real state — currently static selects):
- Base resolution → `main_resolution`
- Frame rate → `main_fps`
- Hardware acceleration → `hardware_encoding`
- Live subscriber count badge: `"Preview: 2 | Main: 0"`

**New section — HTML Server:**
- "HTML Server" toggle → `html_server_enabled`
- Port field → `html_server_port`
- Dynamic status: `"Active at http://192.168.1.x:8090"` when enabled
- "Content Protection" toggle → `content_protection`

### `device-permissions-section.tsx`

- Add "Streaming" column/toggle per device

## Phased Roadmap

### Phase 1 — HTML Presentation Server
> No screen capture, no WebRTC. Lowest complexity, highest immediate impact.

- [ ] Implement `html_server.rs` with axum (HTTP + WebSocket)
- [ ] Self-contained HTML template with CSS fade between slides
- [ ] Automatic push on `lyric-slide-changed` event
- [ ] Toggle and port field in `advanced-section.tsx`
- [ ] Test in mobile browser on local network

### Phase 2 — WebRTC Signaling Infrastructure
> Build the WebRTC foundation without capture yet.

- [ ] Add `webrtc` crate to `Cargo.toml`
- [ ] Implement `streaming.rs` with `StreamManager` and peer connection logic
- [ ] Extend WS protocol (port 8080) with signaling messages
- [ ] Test SDP exchange between browser WebRTC JS and Rust

### Phase 3 — Screen Capture + Encoding
> Capture the media-window and feed the WebRTC video track.

- [ ] Integrate DXGI Desktop Duplication via `windows-capture` crate
- [ ] Implement BGRA → YUV420p → H.264 pipeline via `openh264`
- [ ] Connect to `TrackLocalStaticSample` from the `webrtc` crate
- [ ] Implement black frame logic for protected content
- [ ] Test 1fps preview on mobile

### Phase 4 — UI & Polish
> Connect everything to the frontend with functional controls.

- [ ] `streaming-store.ts` + `streaming-service.ts`
- [ ] Connect `advanced-section.tsx` to real state
- [ ] Live subscriber count in UI
- [ ] `streaming` permission on device management screen
- [ ] Full end-to-end test

## End-to-End Verification

1. **HTML server:** enable in settings → open `http://localhost:8090` → activate lyric → see slide → advance → see automatic transition
2. **HTML blank:** no active content → page shows black screen
3. **WebRTC preview:** authenticated device with `streaming` permission → `subscribe_stream preview` → WebRTC handshake → see 1fps feed
4. **Protection:** play video → stream shows black → activate lyric → stream shows content
5. **On-demand:** zero subscribers → zero capture (CPU idle)
6. **Settings persistence:** change FPS + port → restart app → settings retained
7. **Subscriber count:** 2 devices on preview → UI shows "Preview: 2"
8. **No permission:** device without `streaming` → `stream_error { reason: "no_permission" }`
