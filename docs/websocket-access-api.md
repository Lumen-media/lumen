# Lumen WebSocket Access API

## Purpose

This document defines the WebSocket access contract for Lumen, with focus on:

- authentication and registration
- authorization and permission checks
- session termination behavior
- device deactivation/forget flows
- expected payloads and close codes

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

### 2) External (non-loopback network peers)

- Must authenticate before control events are accepted.
- Enforced by registration/auth/session rules below.

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
    "media": true
  }
}
```

### Failure Response

```json
{ "event": "auth_fail", "reason": "token_expired" }
{ "event": "auth_fail", "reason": "token_used" }
```

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
    "media": true
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

---

## Permission Enforcement

If authenticated but not authorized for a feature:

```json
{ "event": "permission_denied", "feature": "<event-name>" }
```

Connection remains open.

### Permission Mapping

| Permission | Protected Events |
|---|---|
| `player` | `play_pause`, `stop`, `next`, `previous`, `mute`, `set_volume`, `seek`, `set_loop`, `load_url`, `metadata`, `progress` |
| `lyrics` | `load_lyric` |
| `bible` | reserved |
| `media` | reserved |

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

