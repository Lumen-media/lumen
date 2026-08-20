# Chat System — Feature Plan

## Overview

Lumen already syncs playback and presentation state with remote devices via the WebSocket server on port 8080. This feature adds a **closed team chat** so the desktop operator and the paired mobile operator devices (remote controls) can exchange messages in real time during a session — without exposing anything to the general public.

The chat reuses the existing socket (port 8080) with a dedicated `chat_*` event layer, the same way streaming extended the protocol. Access is gated by:

1. **Authentication** — only devices paired via `register` / `auth` participate.
2. **Per-device feature flag** — new `permissions_chat` column; the operator enables chat per device.
3. **Global toggle** — `ChatConfig.enabled` turns the whole chat on/off.

---

## Message Model

One private room. Every participant sees everything. Messages can carry an optional file attachment.

```rust
pub struct ChatFile {
    pub file_name: String,
    pub file_path: String,
    pub file_size: u64,
}

pub struct ChatMessage {
    pub id:          u64,
    pub sender_id:   String,
    pub sender_type: String,
    pub sender_name: String,
    pub text:        String,
    pub ts:          u64,
    pub file:        Option<ChatFile>,
}
```

The sender receives the canonical message back (echo) so ordering and `id` are identical on every peer.

---

## Protocol (port 8080)

| Direction | Event | Payload |
|---|---|---|
| Device → Desktop | `chat_send` | `{ "text": "..." }` |
| Device → Desktop | `chat_file_send` | `{ "file_name": "...", "data": "<base64>", "text": "..." }` |
| Device → Desktop | `chat_history` | `{ "limit": 50 }` |
| Desktop → Device | `chat_message` | `{ "message": { id, sender_id, sender_type, sender_name, text, ts, file } }` |
| Desktop → Device | `chat_history` | `{ "messages": [ ... ] }` |
| Desktop → Device | `chat_error` | `{ "reason": "no_permission" \| "disabled" \| "file_too_large" \| "invalid_file" }` |

Requires an authenticated session with `permissions_chat = true`.

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | true | Global chat on/off |
| `persist_enabled` | bool | false | Write messages to SQLite (history survives restarts) |
| `history_limit` | u32 | 200 | In-memory ring buffer / history window |
| `permissions_chat` | bool | false | Per-device permission column in the `devices` table |

All config persisted in `chat_settings` table in `{exe_dir}/lumen/lumen.db` (key/value). No JSON files.

---

## Routing

| Sender | Recipients |
|---|---|
| device `A` | all other device sessions + operator (desktop) |
| operator (desktop) | all device sessions + operator (desktop, echo) |

Delivery to the operator uses Tauri commands/events (`send_chat_message`, `send_chat_file`, `get_chat_messages`, `get_chat_config`, `set_chat_config`, `clear_chat_history`; event `chat_message`), not the device session registry.

---

## File Attachments

Files are saved to `{exe_dir}/lumen/files/media/files/` — the existing Lumen media folder. UUID filenames prevent collisions; original name stored in metadata. Max 25 MB per file. Operator can send files via `send_chat_file` (reads from local path). Devices send base64 via `chat_file_send`.

---

## Temporary Messages

When `persist_enabled = false`:
- Messages are still written to SQLite during the session.
- On restart, `clear_today()` deletes the current day's messages (by `created_at >= today_start`).
- In-memory buffer starts empty.

---

## Phased Roadmap

### Phase 1 — Server Chat Layer ✅

- [x] Create `src-tauri/src/chat/mod.rs` (`ChatState`, `ChatStateInner`, Tauri commands, initialization)
- [x] Create `src-tauri/src/chat/store.rs` (`ChatConfig`, `ChatMessage`, `ChatFile`, `ChatStore`, SQLite, broadcast, validation)
- [x] Wire `chat_send` / `chat_file_send` / `chat_history` routing into `websocket.rs`
- [x] Add `chat` to `DevicePermissions` + `permissions_chat` migration in `ensure_devices_schema()`
- [x] Extend `map_event_permission` (`chat_send` / `chat_file_send` / `chat_history` → `Some("chat")`) and `is_permission_allowed`
- [x] Implement `broadcast_chat_message` fan-out (sender echo, per-device permission filter)
- [x] Return `chat_error` for devices without the flag or when disabled

### Phase 2 — Operator Integration (Desktop) ✅

- [x] Register `send_chat_message`, `send_chat_file`, `send_chat_reaction`, `get_chat_messages`, `get_chat_config`, `set_chat_config`, `clear_chat_history` in `main.rs`
- [x] Initialize `ChatState` in `AppState`; load config from SQLite `chat_settings` table
- [x] Emit `chat_message` (operator echo), `chat_reaction`, and `chat_config_changed` Tauri events
- [ ] Create `src/services/chat-service.ts` (invoke wrappers) — UI deferred
- [ ] Create `src/stores/chat-store.ts` (zustand + `chat_message` listener, history window) — UI deferred

### Phase 3 — Persistence ✅

- [x] `chat_messages` + `chat_settings` + `chat_reactions` tables in `lumen.db`
- [x] Write-through to SQLite when `persist_enabled`
- [x] `clear_today()` clears current day's messages + reactions on restart when `persist_enabled = false`
- [x] `load_from_disk()` pages messages (with reactions) from SQLite into ring buffer
- [x] `set_chat_config` propagates changes to store in real time

### Phase 4 — Reactions ✅

- [x] `Reaction` struct with `emoji`, `sender_id`, `ts`
- [x] `reactions` field on `ChatMessage` (loaded from `chat_reactions` table)
- [x] `chat_reaction` WebSocket event (toggle: same emoji+sender = remove)
- [x] `send_chat_reaction` Tauri command for operator
- [x] `broadcast_chat_reaction` fan-out to all participants
- [x] Persist reactions in `chat_reactions` table (UNIQUE constraint on message_id+emoji+sender_id)

### Phase 5 — UI (Deferred)

- [ ] Chat panel + input (operator view)
- [ ] Per-device `chat` toggle on the device management screen
- [ ] Global enabled/persist toggles (settings)
- [ ] Song suggestions (frontend-only, markdown-based)
- [ ] Unread message badge
- [ ] Full end-to-end manual test

---

## End-to-End Verification

1. **Auth gate:** raw socket without `register`/`auth` sends `chat_send` → ignored (no `chat_message` emitted).
2. **No permission:** authenticated device with `permissions_chat = 0` sends `chat_send` → `chat_error { reason: "no_permission" }`, connection stays open.
3. **Global toggle off:** `enabled = false` → device `chat_send` → `chat_error { reason: "disabled" }`.
4. **Device → room:** device A sends → device B, device C, and the operator receive the same `id` / `ts` (echo included).
5. **Operator → room:** operator sends via `send_chat_message` → all devices receive with `sender_type: "operator"`.
6. **Fan-out filter:** a device without `permissions_chat` receives no `chat_message`, even if connected.
7. **File send:** device sends `chat_file_send` with base64 → file saved to `files/media/files/` → `chat_message` with `file` field broadcast.
8. **Operator file:** `send_chat_file` reads local path → same flow.
9. **History (persist on):** messages survive restart; `chat_history` returns them in order.
10. **History (persist off):** restart → `clear_today()` removes today's messages; buffer starts empty.
11. **Remote access off:** `remote_enabled = false` → no external sessions → no device traffic; operator chat commands still work locally.
12. **Ordering:** all recipients see monotonically increasing `id` with no gaps.
13. **Reaction add:** device sends `chat_reaction` → `chat_reaction` broadcast to all; reaction appears on the message.
14. **Reaction toggle:** same device sends same emoji again → reaction removed; `reaction: null` in broadcast.
15. **Reaction persist:** restart with `persist_enabled = true` → reactions restored with messages.