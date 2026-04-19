# Lumen WebSocket Client Events

## Scope

This document lists the events a client can **send** to the Lumen WebSocket server (`ws://<host>:8080`), including authentication, video/player control, and sync events.

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
