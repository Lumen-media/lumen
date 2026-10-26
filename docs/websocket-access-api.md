# Lumen WebSocket Access API

## Purpose

This document defines the WebSocket access contract for Lumen, with focus on:

- authentication and registration
- authorization and permission checks
- session termination behavior
- device deactivation/forget flows
- expected payloads and close codes

Related references:

- Client-sent events: [websocket-client-events.md](./websocket-client-events.md)
- Chat events: [chat-websocket-events.md](./chat-websocket-events.md)
- Streaming/WebRTC: [broadcast-streaming-architecture.md](./architecture/broadcast-streaming-architecture.md)
- App preview: [desktop-app-preview-webrtc.md](./architecture/desktop-app-preview-webrtc.md)

---

## Endpoint

External clients (mobile/tablet):

```text
ws://<desktop-ip>:8080
```

Internal desktop traffic (first-party app modules) also uses port `8080`, but via `localhost` and follows a trusted internal flow.

---

## Channel Types

### 1) Internal (`localhost` / loopback)

- No device authentication required.
- Used by desktop app modules (player window, media window, lyric window, etc.).
- Not blocked when remote access is disabled.
- Scope: raw audio events, streaming signaling and chat only. Queue and
  presentation control are **external-only**; `register`/`auth`/`forget_device`
  are also external-only.

### 2) External (non-loopback network peers)

- Must authenticate before control events are accepted.
- Enforced by registration/auth/session rules below.
- Scope: all audio, queue, presentation, streaming and chat events.

Both channel types support ping/pong and ignore non-text frames.

---

## Auth Model (External Devices)

Lumen currently uses `device_id + access_token` auth:

- Pairing starts with a one-time QR registration token.
- Device receives an `access_token` after successful registration.
- Reconnect authentication uses `device_id` + `access_token`.
- Permissions are evaluated per event after authentication.

---

## Registration (`register`)

### Request

```json
{
  "event": "register",
  "token": "<qr-registration-token>",
  "device_id": "<hardware-id>",
  "device_name": "John's Pixel 8",
  "device_type": "mobile",
  "os": "android",
  "version": "1.0.0"
}
```

### Behavior

- `token` is one-time use.
- `token` expires after 15 minutes.
- On success, device gets authenticated in the same socket session.
- If `device_id` already exists, registration reactivates the device and rotates `access_token`.
- Existing permission configuration is preserved for the same `device_id`.

### Success Response

```json
{
  "event": "auth_ok",
  "session_id": "<uuid>",
  "desktop_name": "<machine-name>",
  "access_token": "<opaque-token>",
  "permissions": {
    "player": true,
    "lyrics": true,
    "bible": true,
    "media": true,
    "streaming": false,
    "chat": false,
    "presentation": true
  }
}
```

### Failure Response

```json
{ "event": "auth_fail", "reason": "token_expired" }
{ "event": "auth_fail", "reason": "token_used" }
```

Registration failures do **not** close the socket (except when remote access is
disabled, which sends `auth_fail { unauthorized }` and closes with `4001`), so
the client may retry `register` or fall back to `auth`.

Known register reasons: `unauthorized`, `token_expired`, `token_used`.

---

## Reconnect Auth (`auth`)

### Request

```json
{
  "event": "auth",
  "device_id": "<hardware-id>",
  "access_token": "<stored-token>"
}
```

### Success Response

```json
{
  "event": "auth_ok",
  "session_id": "<uuid>",
  "desktop_name": "<machine-name>",
  "permissions": {
    "player": true,
    "lyrics": true,
    "bible": true,
    "media": true,
    "streaming": false,
    "chat": false,
    "presentation": true
  }
}
```

### Failure Responses

```json
{ "event": "auth_fail", "reason": "not_registered" }
{ "event": "auth_fail", "reason": "invalid_token" }
{ "event": "auth_fail", "reason": "not_active" }
{ "event": "auth_fail", "reason": "unauthorized" }
```

### Auth Failure Close Codes

| Reason | Close Code |
|---|---|
| `unauthorized` | `4001` |
| `not_registered` | `4003` |
| `invalid_token` | `4004` |
| `not_active` | `4005` |

---

## Unauthenticated Behavior

For external sockets that are not authenticated yet:

- only `register` and `auth` are processed
- all other incoming events are ignored

This is intentionally silent to reduce protocol noise before auth.

---

## Authorized Control Events

After successful `auth_ok`, external clients may send:

### Playback

- `play_pause`
- `stop`
- `next`
- `previous`
- `mute`
- `set_volume` (`value: 0..100`)
- `seek` (`value: seconds`)
- `set_loop` (`value: 0 or 1`)

### Media and Lyric

- `load_url` (`url`, `value: startSeconds`)
- `load_lyric` (`url`)
- `metadata` (`title`, `artist`, `url`)
- `progress` (`value`, `duration`)

### Queue

- `queue_add` (`url` **or** `media_id`, optional `position`)
- `queue_remove` (`id`)
- `queue_move` (`id`, `position`)
- `queue_jump` (`id`)
- `queue_shuffle`
- `queue_clear`

All queue events accept `request_id` and are answered with
`queue_op_ok` / `queue_op_fail` (see below).

### Presentation

- `slide_next`, `slide_prev`
- `slide_goto` (`index`)
- `blackout` (`on: bool`)
- `wallpaper` (`on: bool`)

All presentation events accept `request_id` and are answered with
`presentation_op_ok` / `presentation_op_fail` (see below).

### Streaming

- `subscribe_stream` (`stream_type`)
- `unsubscribe_stream` (`stream_type`)
- `webrtc_answer` (`stream_type`, `sdp`)
- `webrtc_ice_candidate` (`stream_type`, `candidate`)
- `mobile_offer` (`sdp`, optional `video_orientation`)

See [broadcast-streaming-architecture.md](./architecture/broadcast-streaming-architecture.md)
for the signaling flow and [desktop-app-preview-webrtc.md](./architecture/desktop-app-preview-webrtc.md)
for `app_preview`.

### Chat

- `chat_send`, `chat_file_send`, `chat_history`, `chat_reaction`,
  `chat_typing`, `chat_read`

See [chat-websocket-events.md](./chat-websocket-events.md) for payloads,
limits and errors.

---

## Permission Enforcement

If authenticated but not authorized for a feature:

```json
{ "event": "permission_denied", "feature": "<event-name>" }
```

Connection remains open.

Queue, presentation, streaming and chat denials use their own frames instead,
each with reason `no_permission`: `queue_op_fail`, `presentation_op_fail`,
`stream_error`, and the chat error frame.

### Permission Mapping

| Permission | Protected Events |
|---|---|
| `player` | `play_pause`, `stop`, `next`, `previous`, `mute`, `set_volume`, `seek`, `set_loop`, `load_url`, `metadata`, `progress`, `queue_add`, `queue_remove`, `queue_move`, `queue_jump`, `queue_shuffle`, `queue_clear` |
| `lyrics` | `load_lyric` |
| `bible` | reserved |
| `media` | reserved |
| `streaming` | `subscribe_stream`, `unsubscribe_stream`, `webrtc_answer`, `webrtc_ice_candidate`, `mobile_offer` |
| `chat` | `chat_send`, `chat_file_send`, `chat_history`, `chat_reaction`, `chat_typing`, `chat_read` |
| `presentation` | `slide_next`, `slide_prev`, `slide_goto`, `blackout`, `wallpaper` |

### Queue & Presentation Operation Acks

Queue and presentation control events accept an optional `request_id` (any JSON
type) and are answered with a matching acknowledgement frame echoing it
verbatim:

```json
{ "event": "queue_add", "request_id": 7, "url": "https://..." }
{ "event": "queue_op_ok", "request_id": 7 }
```

When `request_id` is omitted the ack carries `"request_id": null`.

#### Queue payloads

| Event | Fields |
|---|---|
| `queue_add` | `url` or `media_id`; optional `position` |
| `queue_remove` | `id` |
| `queue_move` | `id`, `position` |
| `queue_jump` | `id` |
| `queue_shuffle` | — |
| `queue_clear` | — |

`queue_add` accepts either `url` (resolved via the media resolver) or
`media_id` (an id from the media pool / `media_files`, added verbatim). If both
are present, `media_id` wins. `position` is an index **among media items**
(triggers are not counted). `queue_add` is acknowledged as soon as it is
accepted; URL resolution and media lookup happen asynchronously on the desktop,
so `queue_op_ok` does not guarantee the media was resolved.

`queue_remove`, `queue_move` and `queue_jump` address the entry by `id`, which
is a **number** for media items and a **string** for trigger entries.
`queue_jump` on a trigger fires it immediately. `queue_clear` removes both media
items and triggers.

#### Presentation payloads

| Event | Fields |
|---|---|
| `slide_next` | — |
| `slide_prev` | — |
| `slide_goto` | `index` (0-based) |
| `blackout` | `on` (bool, defaults to `false`) |
| `wallpaper` | `on` (bool, defaults to `false`) |

#### Failure frames

```json
{ "event": "queue_op_fail", "request_id": 7, "reason": "no_permission" }
{ "event": "presentation_op_fail", "request_id": 7, "reason": "missing_index" }
```

Queue failure reasons: `no_permission`, `missing_url_or_media_id`,
`missing_id`, `missing_id_or_position`.
Presentation failure reasons: `no_permission`, `missing_index`.

### Sync Events Pushed To Devices

| Event | Permission | Payload |
|---|---|---|
| `player_sync` | none | Full player state (`media`, `playback`, `state`, `lyric`) |
| `player_tick` | `player` | `{ position, duration, is_playing, sent_at_ms }` — re-anchor sent ~1s during playback |
| `queue_sync` | `player` | `{ items: [{ id, kind, title, artist?, type?, is_playing, is_played, duration?, show_label? }], current_index }` |
| `presentation_sync` | `presentation` | `{ kind, current_deck, slide_index, total_slides, is_black, is_wallpaper }` |

`queue_sync` is a full snapshot in playback order (media items and trigger
entries interleaved). `items[].kind` is `"media"` or `"trigger"`; `id` is a
number for media and a string for triggers. Reconcile by `id`, not by index.

`player_sync`, `queue_sync` and `presentation_sync` are full snapshots;
`player_tick` is an incremental re-anchor. `player_sync.playback.sent_at` is Unix
**seconds**, while `player_tick.sent_at_ms` is Unix **milliseconds**.

---

## Device Forget / Deactivation Flow

When a mobile client wants to forget this desktop:

### Request

```json
{ "event": "forget_device" }
```

### Server Behavior

1. Marks the current device as inactive (`is_active = false`).
2. Keeps desktop-side record and permission settings.
3. Emits UI update on desktop (`device_updated`).
4. Sends:

```json
{ "event": "device_deactivated", "device_id": "<device-id>" }
{ "event": "auth_fail", "reason": "not_active" }
```

5. Closes socket with code `4005`.

### Client Recommendation

After `forget_device`, clear local `device_id` + `access_token` and require new QR pairing.

---

## Desktop-Originated Device Events (Tauri/UI)

These are emitted to desktop frontend (not remote socket protocol):

- `device_registered` (new device)
- `device_updated` (state/permission/activation changes)
- `device_removed` (deleted from registry)
- `device_authenticated` (successful register/auth)

---

## Player Synchronization Event

Desktop may push consolidated player state:

```json
{
  "event": "player_sync",
  "media": {
    "url": "C:/media/song.mp4",
    "title": "Song Name",
    "artist": "Artist Name",
    "type": "video"
  },
  "playback": {
    "is_playing": true,
    "position": 42.5,
    "duration": 180.0,
    "sent_at": 1710000000
  },
  "state": {
    "is_loop": false,
    "is_muted": false,
    "volume": 80
  },
  "lyric": {
    "active": true,
    "url": "C:/lyrics/song.lrc",
    "slide_index": 2,
    "total_slides": 8
  },
  "action": "seek"
}
```

---

## Remote Access Toggle Semantics

When `remote_enabled = false` on desktop:

- existing external sessions are disconnected
- new external auth attempts fail with `unauthorized` (`4001`)
- internal localhost websocket flow continues to work

---

## Full Close Code Reference

| Code | Meaning |
|---|---|
| `4001` | unauthorized / remote access disabled |
| `4003` | device not registered or removed |
| `4004` | invalid token |
| `4005` | inactive/blocked/deactivated device |

---

## Minimal Test Sequence (External)

1. Connect to `ws://<desktop-ip>:8080`.
2. Send `register` with QR token.
3. Receive `auth_ok` with `access_token`.
4. Send a control event (for example `play_pause`).
5. Reconnect and send `auth` with `device_id + access_token`.
6. Validate permission behavior (`permission_denied` for blocked feature).
7. Send `forget_device` and confirm deactivation + `4005` close.

