# Chat System — Feature Plan

## Overview

Lumen already syncs playback and presentation state with remote devices via the WebSocket server on port 8080. This feature adds a **closed team chat** so the desktop operator and the paired mobile operator devices (remote controls) can exchange messages in real time during a session — without exposing anything to the general public.

The chat reuses the existing socket (port 8080) with a dedicated `chat_*` event layer, the same way streaming extended the protocol. Access is gated by:

1. **Authentication** — only devices paired via `register` / `auth` participate.
2. **Per-device feature flag** — new `permissions_chat` column; the operator enables chat per device.
3. **Global toggle** — `ChatConfig.enabled` turns the whole chat on/off.

---

## Message Model

One private room. Every participant sees everything.

```rust
pub struct ChatMessage {
    pub id:          u64,      // server-assigned, monotonic
    pub sender_id:   String,   // device_id or "operator"
    pub sender_type: String,   // "device" | "operator"
    pub sender_name: String,   // device_name or desktop name
    pub text:        String,
    pub ts:          u64,      // unix seconds
}
```

The sender receives the canonical message back (echo) so ordering and `id` are identical on every peer.

---

## Protocol (port 8080)

| Direction | Event | Payload |
|---|---|---|
| Device → Desktop | `chat_send` | `{ "text": "..." }` |
| Device → Desktop | `chat_history` | `{ "before": 42, "limit": 50 }` |
| Desktop → Device | `chat_message` | `{ "message": { id, sender_id, sender_type, sender_name, text, ts } }` |
| Desktop → Device | `chat_history` | `{ "messages": [ ... ] }` |
| Desktop → Device | `chat_error` | `{ "reason": "no_permission" \| "disabled" }` |

Requires an authenticated session with `permissions_chat = true`.

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | true | Global chat on/off |
| `persist_enabled` | bool | false | Write messages to SQLite (history survives restarts) |
| `history_limit` | u32 | 200 | In-memory ring buffer / history window |
| `permissions_chat` | bool | false | Per-device permission column in the `devices` table |

Persisted at: `{app_base_path}/config/chat.json` (global config) + `permissions_chat` column in `{exe_dir}/lumen/lumen.db`.

---

## Routing

| Sender | Recipients |
|---|---|
| device `A` | all other device sessions + operator (desktop) |
| operator (desktop) | all device sessions + operator (desktop, echo) |

Delivery to the operator uses Tauri commands/events (`send_chat_message`, `get_chat_messages`, `get_chat_config`, `set_chat_config`; event `chat_message`), not the device session registry.

---

## Phased Roadmap

### Phase 1 — Server Chat Layer
> Core server: state, protocol routing, permission gate, fan-out. No UI, no persistence.

- [ ] Create `src-tauri/src/chat/mod.rs` (`ChatConfig`, `ChatMessage`, `ChatState`, entry points)
- [ ] Create `src-tauri/src/chat/store.rs` (in-memory `VecDeque` ring buffer)
- [ ] Wire `chat_send` / `chat_history` routing into `websocket.rs` (after auth + permission check)
- [ ] Add `chat` to `DevicePermissions` + `permissions_chat` migration in `ensure_devices_schema()`
- [ ] Extend `map_event_permission` (`chat_send` / `chat_history` → `Some("chat")`) and `is_permission_allowed`
- [ ] Implement `broadcast_chat_message` fan-out (sender echo, per-device permission filter)
- [ ] Return `chat_error { reason: "no_permission" }` for devices without the flag
- [ ] Test raw protocol over `ws://localhost:8080` with a scripted client

### Phase 2 — Operator Integration (Desktop)
> Bridge the chat to the desktop frontend via Tauri.

- [ ] Register `send_chat_message`, `get_chat_messages`, `get_chat_config`, `set_chat_config` in `main.rs`
- [ ] Initialize `ChatState` in `AppState`; load/save `config/chat.json`
- [ ] Emit `chat_message` (operator echo) and `chat_config_changed` Tauri events
- [ ] Create `src/services/chat-service.ts` (invoke wrappers)
- [ ] Create `src/stores/chat-store.ts` (zustand + `chat_message` listener, history window)
- [ ] Test: operator sends → devices receive; device sends → operator frontend receives

### Phase 3 — Persistence (Optional)
> History survives restarts only when the operator opts in.

- [ ] Add `chat_messages` table to `setup_db()`
- [ ] Write-through to SQLite when `persist_enabled`
- [ ] Page older rows from SQLite in `get_chat_messages` / `chat_history`
- [ ] `chat_config_changed` toggle updates the behavior live
- [ ] Test restart with `persist_enabled = true` → history restored

### Phase 4 — UI (Deferred)
> Data contract is ready; visual design intentionally left open.

- [ ] Chat panel + input (operator view)
- [ ] Per-device `chat` toggle on the device management screen
- [ ] Global enabled/persist toggles (settings)
- [ ] Full end-to-end manual test

---

## End-to-End Verification

1. **Auth gate:** raw socket without `register`/`auth` sends `chat_send` → ignored (no `chat_message` emitted).
2. **No permission:** authenticated device with `permissions_chat = 0` sends `chat_send` → `chat_error { reason: "no_permission" }`, connection stays open.
3. **Global toggle off:** `enabled = false` → device `chat_send` → `chat_error { reason: "disabled" }`.
4. **Device → room:** device A sends → device B, device C, and the operator receive the same `id` / `ts` (echo included).
5. **Operator → room:** operator sends via `send_chat_message` → all devices receive with `sender_type: "operator"`.
6. **Fan-out filter:** a device without `permissions_chat` receives no `chat_message`, even if connected.
7. **History (persist on):** messages survive restart; `chat_history` returns them in order.
8. **History (persist off):** restart → empty; only the in-memory window is available.
9. **Remote access off:** `remote_enabled = false` → no external sessions → no device traffic; operator chat commands still work locally.
10. **Ordering:** all recipients see monotonically increasing `id` with no gaps.