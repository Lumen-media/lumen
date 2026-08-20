# Chat System — Architecture Design

## Purpose

Closed team chat between the **Lumen operator** (desktop) and the **paired operator devices** (mobile remote controls connected via WebSocket). Not a public feature: only authenticated devices with the `chat` permission participate, and the operator controls a global on/off switch plus a per-device permission flag.

Every message is attributable — `sender_id` / `sender_name` travel with the payload, so the production team knows who said what.

---

## Scope

- **Participants:** operator (desktop) + authenticated external devices with the `chat` permission.
- **Room model:** single private room. Everyone sees everything.
  - device → all other device sessions + operator
  - operator → all device sessions
- **Auth gate:** an unauthenticated socket (no `register` / `auth`) cannot send or receive chat events.
- **Feature flags:**
  - **Global:** `ChatConfig.enabled` — operator turns the whole chat on/off.
  - **Per device:** `permissions_chat` column — operator allows/denies chat per device.
- **Persistence:** optional. In-memory ring buffer by default; when `persist_enabled` is on, messages are written through to SQLite and history can be replayed.
- **UI:** deferred. This document defines the data contract (events, payloads, commands) only.

---

## Message Flow

```
                    ws://<desktop>:8080
┌──────────────┐   ┌───────────────────────────────────────────────┐   ┌───────────────────┐
│ Mobile device │──►│  websocket.rs (external, authenticated)      │◄──│  Mobile device N   │
│  (operator 1) │   │                                               │   │  (operator N)     │
└──────────────┘   │  ┌─────────────┐   persist?                    │   └───────────────────┘
                   │  │   chat.rs    │◄──── SQLite (chat_messages)  │
┌──────────────┐   │  │  ChatState   │                               │
│  Operator UI  │◄──│  │  ring buffer │                               │
│  (desktop)    │   │  └─────────────┘                               │
└──────────────┘   │   ▲                                            │
    ▲               │   │ send_chat_message (Tauri command)         │
    │               │   └──────────┐                                 │
    └── Tauri event "chat_message" ┘                                 │
                    └─────────────────────────────────────────────────┘
```

Routing rule (single room, sender echo included so all peers agree on `id` / `ts`):

| Sender | Recipients |
|---|---|
| device `A` | all other device sessions + operator (desktop) |
| operator (desktop) | all device sessions + operator (desktop, echo) |

The sender also receives the canonical server-assigned message (with `id` and `ts`) so ordering is identical everywhere without client-side reconciliation.

---

## Rust Modules

```
src-tauri/src/
├── chat/
│   ├── mod.rs         — ChatConfig, ChatMessage, ChatState, handler entry points
│   └── store.rs       — in-memory ring buffer + optional SQLite persistence
└── websocket.rs       — routes chat_* events (after auth + permission check)
```

---

## Message Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id:          u64,          // server-assigned, monotonic per runtime
    pub sender_id:   String,       // device_id or "operator"
    pub sender_type: String,       // "device" | "operator"
    pub sender_name: String,       // device_name or desktop name
    pub text:        String,
    pub ts:          u64,          // unix seconds (server clock)
}
```

Wire format (as delivered to every participant):

```json
{
  "event": "chat_message",
  "message": {
    "id": 42,
    "sender_id": "device-abc123",
    "sender_type": "device",
    "sender_name": "John's Pixel 8",
    "text": "projection froze on slide two",
    "ts": 1710000000
  }
}
```

Operator-originated messages use `sender_type: "operator"` and the desktop name as `sender_name`.

---

## ChatState (Server)

Central state held in `Arc<Mutex<ChatState>>` inside `AppState`, following the same pattern as `StreamManager`.

```rust
pub struct ChatState {
    pub config:   ChatConfig,
    pub messages: VecDeque<ChatMessage>,   // ring buffer, capped at history_limit
    pub next_id:  u64,
}
```

`messages` is always kept up to date regardless of persistence. When `persist_enabled` is `true`, every append is also written to SQLite; `history_limit` still caps the in-memory window returned by `chat_history`.

---

## ChatConfig

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatConfig {
    pub enabled:         bool,   // global on/off (operator toggle)
    pub persist_enabled: bool,   // write-through to SQLite
    pub history_limit:   u32,    // in-memory window (default 200)
}

impl Default for ChatConfig {
    fn default() -> Self {
        Self {
            enabled:         true,
            persist_enabled: false,
            history_limit:   200,
        }
    }
}
```

Persisted at: `{app_base_path}/config/chat.json` — same pattern as `remote-access.json` / `streaming.json`.

**Semantics of `enabled = false`:**
- Incoming `chat_send` from devices is rejected with `chat_error { reason: "disabled" }`.
- The operator can still call `get_chat_messages` (reads the buffer).
- History remains available to the operator; it is just not broadcastable to devices.

---

## Protocol Extension (WebSocket — port 8080)

New events routed in `websocket.rs`. All `chat_*` events require an authenticated session and the `chat` permission.

### Device → Desktop

```jsonc
// send a message
{ "event": "chat_send", "text": "projection froze on slide two" }

// request recent history (paged window)
{ "event": "chat_history", "before": 42, "limit": 50 }
```

### Desktop → Device

```jsonc
// a message broadcast to the room (everyone, including sender echo)
{ "event": "chat_message", "message": { "id": 42, "sender_id": "...", "sender_type": "device", "sender_name": "...", "text": "...", "ts": 1710000000 } }

// history response to chat_history request
{ "event": "chat_history", "messages": [ { "id": 42, ... } ] }

// rejection
{ "event": "chat_error", "reason": "no_permission" | "disabled" }
```

### Permission Mapping

```rust
fn map_event_permission(event: &str) -> Option<&'static str> {
    match event {
        // existing...
        "chat_send" | "chat_history" => Some("chat"),
        _ => None,
    }
}
```

When an authenticated device without `permissions_chat` sends a chat event, it receives `chat_error { reason: "no_permission" }` — the same pattern as `stream_error { reason: "no_permission" }` in the streaming layer. The connection stays open.

---

## Fan-Out

Uses the existing session registry (`DeviceState.sessions`), the same source that powers `broadcast_remote_event_inner`.

```rust
pub fn broadcast_chat_message(
    state: &State<'_, DeviceState>,
    message: ChatMessage,
) -> Result<(), String> {
    let payload = json_message(&json!({
        "event": "chat_message",
        "message": message,
    }))?;

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session in sessions.values() {
        if !is_permission_allowed(&session.permissions, "chat") {
            continue; // per-device feature flag
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone()); // includes sender echo
        }
    }

    Ok(())
}
```

A message only exists after it is committed to `ChatState` (and SQLite when persistence is on), so every receiver gets the same canonical `id` and `ts`.

---

## Operator Integration (Desktop)

The operator does **not** appear in the device session registry, so chat is bridged to the desktop UI via Tauri commands and events — the same pattern used by `streaming_status_changed` / `mobile_stream_started`.

### Tauri Commands

```rust
#[tauri::command] async fn send_chat_message(text: String) -> Result<(), String>
#[tauri::command] async fn get_chat_messages(limit: Option<u32>) -> Result<Vec<ChatMessage>, String>
#[tauri::command] async fn get_chat_config()  -> Result<ChatConfig, String>
#[tauri::command] async fn set_chat_config(config: ChatConfig) -> Result<(), String>
```

`send_chat_message`:
1. Builds `ChatMessage { sender_type: "operator", sender_name: <desktop_name>, ... }`.
2. Commits it to `ChatState` (+ SQLite if persistence enabled).
3. Calls `broadcast_chat_message`.
4. Emits `chat_message` back to the frontend (echo) so the operator UI updates from the same canonical event.

### Tauri Events Emitted

| Event | Payload | When |
|---|---|---|
| `chat_message` | `ChatMessage` | any message committed to the room (device or operator) |
| `chat_config_changed` | `ChatConfig` | global config changed via `set_chat_config` |

---

## Persistence Model

When `persist_enabled` is `true`, messages are written to the devices database (`{exe_dir}/lumen/lumen.db`) in a new table:

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
```

- Created in `setup_db()` (same file as the `devices` table).
- Write-through on every message commit; the in-memory ring buffer remains the hot path for `chat_history`.
- `get_chat_messages` reads the buffer first and may page older rows from SQLite when persistence is enabled.
- History survives restarts only when persistence is on; otherwise it is intentionally ephemeral.

---

## Permission Extension (Per-Device Feature Flag)

### `devices.rs`

```rust
pub struct DevicePermissions {
    pub player:    bool,
    pub lyrics:    bool,
    pub bible:     bool,
    pub media:     bool,
    pub streaming: bool,
    pub chat:      bool,   // NEW
}
```

### SQLite Migration

```sql
ALTER TABLE devices ADD COLUMN permissions_chat INTEGER NOT NULL DEFAULT 0;
```

Applied in `ensure_devices_schema()` with the same pattern used for `permissions_streaming` (PRAGMA `table_info` check + `ALTER TABLE ADD COLUMN`), so existing databases upgrade in place.

**Default `0` (off):** the operator must explicitly allow chat per device. This matches the default for `streaming` and keeps chat private by default.

### `is_permission_allowed`

```rust
"chat" => permissions.chat,
```

---

## Frontend — Data Contract Only (UI Deferred)

The UI is out of scope for now. The data contract that a future panel will consume:

### `src/services/chat-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface ChatMessage {
  id: number;
  sender_id: string;
  sender_type: "device" | "operator";
  sender_name: string;
  text: string;
  ts: number;
}

export interface ChatConfig {
  enabled: boolean;
  persist_enabled: boolean;
  history_limit: number;
}

export const chatService = {
  sendMessage: (text: string)                  => invoke("send_chat_message", { text }),
  getMessages: (limit?: number)                => invoke<ChatMessage[]>("get_chat_messages", { limit: limit ?? null }),
  getConfig:   ()                              => invoke<ChatConfig>("get_chat_config"),
  setConfig:   (config: Partial<ChatConfig>)   => invoke("set_chat_config", { config }),
};
```

### `src/stores/chat-store.ts`

```typescript
import { create } from "zustand";
import { chatService, ChatMessage, ChatConfig } from "@/services/chat-service";
import { listen } from "@tauri-apps/api/event";

interface ChatStore {
  messages: ChatMessage[];
  config: ChatConfig;
  init: () => Promise<void>;
  send: (text: string) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setPersist: (persist: boolean) => Promise<void>;
}

// init():
//   const [messages, config] = await Promise.all([
//     chatService.getMessages(200),
//     chatService.getConfig(),
//   ]);
//   set({ messages, config });
//   listen<ChatMessage>("chat_message", ({ payload }) =>
//     set((s) => ({ messages: [...s.messages, payload].slice(-s.config.history_limit) })));
```

---

## Existing Files to Modify

| File | Change |
|---|---|
| `src-tauri/src/chat/mod.rs` | NEW — `ChatConfig`, `ChatMessage`, `ChatState`, handler entry points |
| `src-tauri/src/chat/store.rs` | NEW — ring buffer + optional SQLite persistence |
| `src-tauri/src/websocket.rs` | Route `chat_send` / `chat_history` after auth + permission check |
| `src-tauri/src/devices.rs` | + `chat` in `DevicePermissions`; `permissions_chat` column migration; `map_event_permission`; `is_permission_allowed` |
| `src-tauri/src/main.rs` | Initialize `ChatState`; register `send_chat_message`, `get_chat_messages`, `get_chat_config`, `set_chat_config` |
| `src/services/chat-service.ts` | NEW — invoke wrapper |
| `src/stores/chat-store.ts` | NEW — zustand store + `chat_message` listener |

---

## Deferred / Out of Scope

- **UI** (panel, input, device management toggle) — data contract is ready, visual design deferred.
- **Typing indicators** — no `chat_typing` event yet; can be added later without breaking the model.
- **Attachments / media in chat** — reserved, not in this model.
- **Moderation** (mute/kick/delete) — the per-device `permissions_chat` flag is the only control for now.
- **Multiple rooms / channels** — single private room only.