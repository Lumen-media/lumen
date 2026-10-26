# Lumen WebSocket Client Events

## Scope

This document lists the events a client can **send** to the Lumen WebSocket server (`ws://<host>:8080`), including authentication, video/player control, queue and presentation control, streaming signaling, and chat. See [websocket-access-api.md](./websocket-access-api.md) for auth, permissions, close codes and server-pushed sync events, and [chat-websocket-events.md](./chat-websocket-events.md) for full chat details.

---

## Message Format

All client messages are JSON objects with at least:

```json
{
  "event": "<event_name>"
}
```

You send them as text frames over WebSocket.

Example:

```js
socket.send(JSON.stringify({ event: "play_pause" }));
```

---

## Connection Modes

- Internal (`127.0.0.1`, `::1`, `localhost`): trusted, no auth required.
- External (mobile/remote IP): must authenticate first (`register` or `auth`).

For external connections, unauthenticated events other than `register` / `auth` are ignored.

---

## 1) Auth And Device Lifecycle Events (External)

### `register`

Used during QR pairing.

```json
{
  "event": "register",
  "token": "<qr-token>",
  "device_id": "<hardware-id>",
  "device_name": "John's Pixel 8",
  "device_type": "mobile",
  "os": "android",
  "version": "1.0.0"
}
```

Expected response:

- success: `auth_ok` (includes `session_id`, `access_token`, `permissions`, `desktop_name`)
- fail: `auth_fail` with reason (`unauthorized`, `token_expired`, `token_used`, etc.)

### `auth`

Used after pairing, with stored credentials.

```json
{
  "event": "auth",
  "device_id": "<hardware-id>",
  "access_token": "<stored-access-token>"
}
```

Expected response:

- success: `auth_ok`
- fail: `auth_fail` (`unauthorized`, `not_registered`, `invalid_token`, `not_active`) and close code depending on reason

### `forget_device`

Used by authenticated external device to deactivate itself on desktop.

```json
{
  "event": "forget_device"
}
```

Expected response flow:

- `device_deactivated`
- `auth_fail` with `not_active`
- server closes connection (code `4005`)

---

## 2) Player / Video Control Events

### `play_pause`

```json
{ "event": "play_pause" }
```

### `stop`

```json
{ "event": "stop" }
```

### `next`

```json
{ "event": "next" }
```

### `previous`

```json
{ "event": "previous" }
```

### `mute`

```json
{ "event": "mute" }
```

### `set_volume`

`value` should be `0..100`.

```json
{
  "event": "set_volume",
  "value": 80
}
```

### `seek`

`value` is playback position in seconds.

```json
{
  "event": "seek",
  "value": 125.5
}
```

### `set_loop`

Server treats `value != 0` as enabled.

```json
{
  "event": "set_loop",
  "value": 1
}
```

---

## 3) Media And Sync Events

### `load_url`

Load media URL/path and optional start time.

```json
{
  "event": "load_url",
  "url": "C:/media/video.mp4",
  "value": 0
}
```

### `load_lyric`

```json
{
  "event": "load_lyric",
  "url": "C:/lyrics/song.lrc"
}
```

### `metadata`

Sends current media metadata.

```json
{
  "event": "metadata",
  "title": "Song Name",
  "artist": "Artist",
  "url": "C:/media/video.mp4"
}
```

### `progress`

Reports current playback time and duration.

```json
{
  "event": "progress",
  "value": 42.75,
  "duration": 180.0
}
```

Send frequency note:

- Current desktop implementation sends this event from `ReactPlayer.onProgress`.
- With current dependency (`react-player@2.16.0`) and no custom `progressInterval`, this is emitted roughly every **1 second**.
- There is no extra app-level debounce/throttle for this event right now.

### `manual_pause`

Reserved/internal compatibility event. Currently logged by server, with no playback action.

```json
{
  "event": "manual_pause"
}
```

---

## 4) Queue Control (External)

Requires the `player` permission. Queue events may include a `request_id` (any
JSON type) and are always answered with `queue_op_ok` or `queue_op_fail` echoing
it (`null` when omitted).

### `queue_add`

Adds media by URL (resolved by the desktop) or by media-pool id. If both are
present, `media_id` wins. `position` is an index among media items (triggers are
not counted). The ack means "accepted"; resolution runs asynchronously.

```json
{ "event": "queue_add", "request_id": 1, "media_id": 42, "position": 0 }
{ "event": "queue_add", "request_id": 2, "url": "https://example.com/song.mp4" }
```

Failure reason: `missing_url_or_media_id`.

### `queue_remove`

`id` is a number for media and a string for trigger entries.

```json
{ "event": "queue_remove", "request_id": 3, "id": 42 }
{ "event": "queue_remove", "request_id": 4, "id": "trigger-instance-id" }
```

Failure reason: `missing_id`.

### `queue_move`

Moves an entry to a new index. `id` accepts number or string.

```json
{ "event": "queue_move", "request_id": 5, "id": 42, "position": 2 }
```

Failure reason: `missing_id_or_position`.

### `queue_jump`

Jumps to a media item, or fires a trigger immediately (and marks it played).

```json
{ "event": "queue_jump", "request_id": 6, "id": 42 }
{ "event": "queue_jump", "request_id": 7, "id": "trigger-instance-id" }
```

Failure reason: `missing_id`.

### `queue_shuffle`

```json
{ "event": "queue_shuffle", "request_id": 8 }
```

### `queue_clear`

Removes both media items and trigger entries.

```json
{ "event": "queue_clear", "request_id": 9 }
```

Failure frame:

```json
{ "event": "queue_op_fail", "request_id": 9, "reason": "no_permission" }
```

---

## 5) Presentation Control (External)

Requires the `presentation` permission. Events may include a `request_id` and
are answered with `presentation_op_ok` / `presentation_op_fail`.

### `slide_next` / `slide_prev`

```json
{ "event": "slide_next", "request_id": 10 }
{ "event": "slide_prev", "request_id": 11 }
```

### `slide_goto`

`index` is 0-based.

```json
{ "event": "slide_goto", "request_id": 12, "index": 3 }
```

Failure reason: `missing_index`.

### `blackout` / `wallpaper`

`on` defaults to `false` when omitted.

```json
{ "event": "blackout", "request_id": 13, "on": true }
{ "event": "wallpaper", "request_id": 14, "on": false }
```

Failure frame:

```json
{ "event": "presentation_op_fail", "request_id": 12, "reason": "missing_index" }
```

---

## 6) Streaming / WebRTC Signaling (External)

Requires the `streaming` permission. See
[broadcast-streaming-architecture.md](./architecture/broadcast-streaming-architecture.md)
and [desktop-app-preview-webrtc.md](./architecture/desktop-app-preview-webrtc.md).

Accepted `stream_type` values: `preview`, `app_preview`, `main`, `mobile`,
`mobile_preview`. `mobile_offer` always implies `mobile`.

### `subscribe_stream`

```json
{ "event": "subscribe_stream", "stream_type": "app_preview" }
```

Success: server replies with `stream_offer { stream_type, sdp }`. The client
answers with `webrtc_answer`.

### `unsubscribe_stream`

```json
{ "event": "unsubscribe_stream", "stream_type": "app_preview" }
```

Success: server replies with `stream_stopped { stream_type }`.

### `webrtc_answer`

```json
{ "event": "webrtc_answer", "stream_type": "app_preview", "sdp": "v=0..." }
```

### `webrtc_ice_candidate`

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

### `mobile_offer`

The mobile client is the offerer; the desktop answers.

```json
{ "event": "mobile_offer", "sdp": "v=0...", "video_orientation": "portrait" }
```

Success: server replies with `mobile_answer { sdp }`.

### `stream_error`

Sent instead of a success frame when signaling fails:

```json
{ "event": "stream_error", "stream_type": "app_preview", "reason": "no_permission" }
```

Reasons include `no_permission`, `not_enabled`, `capture_not_ready`,
`invalid_stream_type`, and negotiation/capture errors.

---

## 7) Chat (External)

Requires the `chat` permission. Events: `chat_send`, `chat_file_send`,
`chat_history`, `chat_reaction`, `chat_typing`, `chat_read`. See
[chat-websocket-events.md](./chat-websocket-events.md) for payloads, limits and
error reasons.

---

## Internal vs External Scope

- **Internal** (loopback) connections may send audio events, streaming
  signaling and chat. They do not route `queue_*`, presentation events,
  `register`, `auth` or `forget_device`.
- **External** connections must authenticate first and cover all event families
  (audio, queue, presentation, streaming, chat).
- Queue and presentation events are acknowledged with a per-family
  `*_op_ok` / `*_op_fail` frame; audio/lyric permission failures use
  `permission_denied`.

---

## Permission Notes (External)

After external auth, event permissions are checked per feature:

- player-related events may return `permission_denied`
- lyric event (`load_lyric`) may return `permission_denied`

Example response:

```json
{
  "event": "permission_denied",
  "feature": "load_lyric"
}
```

Internal localhost connections are not permission-gated.
