# Desktop App Preview WebRTC

## Purpose

This document explains only the **desktop-to-app preview stream** flow.

- Direction: `Desktop -> App`
- Transport: `WebRTC` video track (`H264`)
- Signaling: existing WebSocket server on `ws://<desktop-ip>:8080`
- Stream type: `app_preview`

This is a low-cost preview channel designed so the app can always request and display what the desktop is sending.

## What Exists Today

Desktop side (`src-tauri`) already creates a dedicated preview producer:

- Track id: `app_preview`
- Codec capability: `video/H264`
- Producer loop: `2 FPS`
- Encoded frame size target: `640x360`
- Source: monitor near `media-window` position (fallback to `main` window anchor, then origin)
- Fallback behavior: if screen capture fails, synthetic frames are generated and still sent

Main files:

- `src-tauri/src/streaming/app_preview_producer.rs`
- `src-tauri/src/streaming/signaling.rs`
- `src-tauri/src/streaming/manager.rs`
- `src-tauri/src/websocket.rs`

## End-to-End Signaling Flow

```text
App                                  Desktop
---                                  -------
WS connect + auth/register  -------> session created

subscribe_stream(app_preview) ------> create RTCPeerConnection
                                      attach app_preview track
                                      create offer
stream_offer(app_preview, sdp) <-----

setRemoteDescription(offer)
createAnswer()
setLocalDescription(answer)
webrtc_answer(app_preview, sdp) ---->

webrtc_ice_candidate(app_preview) --> add ICE candidate
stream_ice_candidate(app_preview) <--

ontrack(video) <--------------------- RTP media (H264)
```

## WebSocket Message Contract (App Preview)

### 1. Subscribe

App -> Desktop

```json
{
  "event": "subscribe_stream",
  "stream_type": "app_preview"
}
```

### 2. Offer

Desktop -> App

```json
{
  "event": "stream_offer",
  "stream_type": "app_preview",
  "sdp": "<offer-sdp>"
}
```

### 3. Answer

App -> Desktop

```json
{
  "event": "webrtc_answer",
  "stream_type": "app_preview",
  "sdp": "<answer-sdp>"
}
```

### 4. ICE from desktop

Desktop -> App

```json
{
  "event": "stream_ice_candidate",
  "stream_type": "app_preview",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### 5. ICE from app

App -> Desktop

```json
{
  "event": "webrtc_ice_candidate",
  "stream_type": "app_preview",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### 6. Unsubscribe

App -> Desktop

```json
{
  "event": "unsubscribe_stream",
  "stream_type": "app_preview"
}
```

Desktop -> App (confirmation event)

```json
{
  "event": "stream_stopped",
  "stream_type": "app_preview"
}
```

### 7. Error

Desktop -> App

```json
{
  "event": "stream_error",
  "stream_type": "app_preview",
  "reason": "<reason>"
}
```

Common reasons:

- `no_permission`
- `invalid_stream_type`
- `peer_not_found`

## App Integration Guide

## 1. Create peer + websocket

- Open WebSocket to desktop `:8080`
- Authenticate/register first (existing device flow)
- Create one `RTCPeerConnection`

## 2. Subscribe using `app_preview`

Send:

```json
{ "event": "subscribe_stream", "stream_type": "app_preview" }
```

Important: do not use `preview` or `main` for this app preview flow.

## 3. Handle offer/answer

- On `stream_offer` with `stream_type === "app_preview"`:
1. `pc.setRemoteDescription(offer)`
2. `answer = pc.createAnswer()`
3. `pc.setLocalDescription(answer)`
4. send `webrtc_answer` with `stream_type: "app_preview"`

## 4. Exchange ICE

- `pc.onicecandidate` -> send `webrtc_ice_candidate` (`app_preview`)
- On `stream_ice_candidate` (`app_preview`) -> `pc.addIceCandidate(...)`

## 5. Render video

Use a native `<video>` element (webview/web) or `RTCView` (React Native):

- On `pc.ontrack` when `track.kind === "video"`:
1. Create/reuse `MediaStream`
2. Add the incoming track
3. Bind stream to the renderer (`video.srcObject` or `RTCView`)
4. Keep `muted=true` for local autoplay compatibility on HTML video

## Web Example (minimal)

```ts
const pc = new RTCPeerConnection();
const ws = new WebSocket("ws://<desktop-ip>:8080");

pc.onicecandidate = (event) => {
  if (!event.candidate) return;
  ws.send(JSON.stringify({
    event: "webrtc_ice_candidate",
    stream_type: "app_preview",
    candidate: event.candidate
  }));
};

pc.ontrack = (event) => {
  if (event.track.kind !== "video") return;
  const stream = new MediaStream([event.track]);
  const el = document.getElementById("preview") as HTMLVideoElement;
  el.srcObject = stream;
  el.muted = true;
  void el.play();
};

ws.onopen = () => {
  ws.send(JSON.stringify({
    event: "subscribe_stream",
    stream_type: "app_preview"
  }));
};

ws.onmessage = async (raw) => {
  const payload = JSON.parse(String(raw.data));

  if (payload.event === "stream_offer" && payload.stream_type === "app_preview") {
    await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({
      event: "webrtc_answer",
      stream_type: "app_preview",
      sdp: answer.sdp
    }));
    return;
  }

  if (payload.event === "stream_ice_candidate" && payload.stream_type === "app_preview") {
    await pc.addIceCandidate(payload.candidate);
  }
};
```

## React Native Notes

- Use `react-native-webrtc` (`RTCPeerConnection`, `RTCView`, `MediaStream`)
- Convert incoming stream to `RTCView` URL: `stream.toURL()`
- Keep same signaling messages and `stream_type: "app_preview"`
- Maintain one active app preview peer per app session (recommended)

## Troubleshooting (Preview Only)

If signaling is connected but app shows black/no video:

1. Confirm app is subscribing with `stream_type: "app_preview"`.
2. Confirm app receives `stream_offer` for `app_preview` and sends `webrtc_answer`.
3. Confirm ICE events are exchanged both directions.
4. Confirm app receives `ontrack(video)` and binds the track to renderer.
5. Check desktop debug event `app_preview_frame_sent` via `streaming_debug_log`.
6. If capture fails, synthetic fallback should still produce moving frames. If even fallback is not visible, issue is likely app render binding (`srcObject`/`RTCView`) rather than desktop capture.

## Operational Notes

- The app preview producer starts with streaming state initialization and sends frames when there are `app_preview` subscribers.
- Current implementation is optimized for low overhead preview quality, not production broadcast quality.
- This flow is independent from mobile uplink (`mobile`/`mobile_preview`) and from HTML server streaming.
