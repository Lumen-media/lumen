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
- **Persistence:** optional. When `persist_enabled` is off, messages are written to SQLite but the current day's messages are cleared on restart. When on, messages survive restarts.
- **File attachments:** devices and operator can send files (up to 25 MB). Files are saved to the existing `files/media/files/` folder so Lumen's file manager can access them.
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
    ▲               │   │ send_chat_message / send_chat_file        │
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
│   ├── mod.rs         — ChatState, Tauri commands, initialization
│   └── store.rs       — ChatConfig, ChatMessage, ChatFile, ChatStore, persistence, broadcast
└── websocket.rs       — routes chat_* events (after auth + permission check)
```

---

## Message Model

```rust
pub struct ChatFile {
    pub file_name: String,   // original filename
    pub file_path: String,   // stored path on disk
    pub file_size: u64,      // bytes
}

pub struct Reaction {
    pub emoji:      String,
    pub sender_id:  String,
    pub ts:         u64,
}

pub struct ChatMessage {
    pub id:          u64,              // server-assigned, monotonic
    pub sender_id:   String,           // device_id, "operator", or "system"
    pub sender_type: String,           // "device" | "operator" | "system"
    pub sender_name: String,           // device_name, desktop name, or "Lumen"
    pub text:        String,           // markdown content
    pub ts:          u64,              // unix seconds (server clock)
    pub file:        Option<ChatFile>, // optional attachment
    pub reactions:   Vec<Reaction>,    // emoji reactions
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
    "ts": 1710000000,
    "file": {
      "file_name": "screenshot.jpg",
      "file_path": "C:/lumen/files/media/files/abc-uuid.jpg",
      "file_size": 245760
    },
    "reactions": [
      { "emoji": "👍", "sender_id": "operator", "ts": 1710000005 }
    ]
  }
}
```

Operator-originated messages use `sender_type: "operator"` and the desktop name as `sender_name`.

### Constants

```rust
pub const MAX_MESSAGE_LENGTH: usize = 4000;           // text is markdown, generous limit
pub const MAX_FILE_SIZE: u64 = 25 * 1024 * 1024;      // 25 MB
```

---

## ChatState (Server)

Central state held in `Arc<Mutex<ChatStateInner>>` inside `AppState`, following the same pattern as `StreamManager`.

```rust
pub struct ChatState {
    pub inner: Arc<Mutex<ChatStateInner>>,
}

pub struct ChatStateInner {
    pub config: ChatConfig,
    pub store:  ChatStore,
    db_path:    PathBuf,    // lumen.db — shared with devices
}
```

`store.messages` (in-memory `VecDeque`) is always kept up to date regardless of persistence. When `persist_enabled` is `true`, every append is also written to SQLite; `history_limit` still caps the in-memory window returned by `chat_history`.

---

## ChatConfig

```rust
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

Persisted in: `chat_settings` table in `{exe_dir}/lumen/lumen.db` (key/value rows). No JSON files.

**Semantics of `enabled = false`:**
- Incoming `chat_send` / `chat_file_send` from devices is rejected with `chat_error { reason: "disabled" }`.
- The operator can still call `get_chat_messages` (reads the buffer).
- History remains available to the operator; it is just not broadcastable to devices.

**Semantics of `persist_enabled = false`:**
- Messages are still written to SQLite during the session (in-memory ring buffer + DB).
- On restart, `clear_today()` deletes the current day's messages from `chat_messages`.
- The in-memory buffer starts empty.

---

## Protocol Extension (WebSocket — port 8080)

New events routed in `websocket.rs`. All `chat_*` events require an authenticated session and the `chat` permission.

### Device → Desktop

```jsonc
// send a text message (markdown)
{ "event": "chat_send", "text": "projection froze on slide two" }

// send a file attachment (+ optional text)
{ "event": "chat_file_send", "file_name": "photo.jpg", "data": "<base64>", "text": "check this" }

// toggle a reaction on a message (same emoji+sender = remove)
{ "event": "chat_reaction", "message_id": 42, "emoji": "👍" }

// request recent history
{ "event": "chat_history", "limit": 50 }
```

### Desktop → Device

```jsonc
// a message broadcast to the room (everyone, including sender echo)
{ "event": "chat_message", "message": { "id": 42, "sender_id": "...", "sender_type": "device", "sender_name": "...", "text": "...", "ts": 1710000000, "file": null, "reactions": [] } }

// reaction broadcast (includes the reaction object if added, null if removed)
{ "event": "chat_reaction", "message_id": 42, "emoji": "👍", "sender_id": "device-abc", "reaction": { "emoji": "👍", "sender_id": "device-abc", "ts": 1710000005 } }

// history response to chat_history request
{ "event": "chat_history", "messages": [ { "id": 42, ... } ] }

// rejection
{ "event": "chat_error", "reason": "no_permission" | "disabled" | "file_too_large" | "invalid_file" }
```

### Permission Mapping

```rust
fn map_event_permission(event: &str) -> Option<&'static str> {
    match event {
        // existing...
        "chat_send" | "chat_file_send" | "chat_history" | "chat_reaction" => Some("chat"),
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
    message: &ChatMessage,
) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_message",
        "message": message,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

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

## File Attachments

Files are saved to `{exe_dir}/lumen/files/media/files/` — the same folder Lumen's file manager already indexes. This means:
- Files sent through chat are immediately available to the operator via the existing media library.
- UUID-based filenames prevent collisions; the original filename is stored in `ChatFile.file_name`.

### Device → Desktop (`chat_file_send`)

The device sends base64-encoded file data. The server decodes it, saves to disk, creates a `ChatMessage` with the `file` field populated, and broadcasts.

### Operator (`send_chat_file`)

The operator sends a local file path. The server reads it, copies to the chat files directory, creates the message, and broadcasts.

### Limits

- Max file size: 25 MB (`MAX_FILE_SIZE`)
- Files exceeding the limit receive `chat_error { reason: "file_too_large" }`

---

## Operator Integration (Desktop)

The operator does **not** appear in the device session registry, so chat is bridged to the desktop UI via Tauri commands and events — the same pattern used by `streaming_status_changed` / `mobile_stream_started`.

### Tauri Commands

```rust
#[tauri::command] async fn send_chat_message(text: String) -> Result<(), String>
#[tauri::command] async fn send_chat_file(file_path: String, text: Option<String>) -> Result<(), String>
#[tauri::command] async fn send_chat_reaction(message_id: u64, emoji: String) -> Result<(), String>
#[tauri::command] async fn get_chat_messages(limit: Option<u32>) -> Result<Vec<ChatMessage>, String>
#[tauri::command] async fn get_chat_config()  -> Result<ChatConfig, String>
#[tauri::command] async fn set_chat_config(config: ChatConfig) -> Result<(), String>
#[tauri::command] async fn clear_chat_history() -> Result<(), String>
```

`send_chat_message`:
1. Validates text (non-empty, under `MAX_MESSAGE_LENGTH`).
2. Builds `ChatMessage { sender_type: "operator", sender_name: <desktop_name>, ... }`.
3. Commits it to `ChatState` (+ SQLite if persistence enabled).
4. Calls `broadcast_chat_message`.
5. Emits `chat_message` back to the frontend (echo) so the operator UI updates from the same canonical event.

`send_chat_file`:
1. Reads file from `file_path` on disk.
2. Saves to `files/media/files/` with UUID filename.
3. Builds `ChatMessage` with `file` populated.
4. Same commit → broadcast → emit flow.

`send_chat_reaction`:
1. Toggles the reaction: same emoji + same sender = removes it; otherwise adds it.
2. Persists to `chat_reactions` table.
3. Broadcasts `chat_reaction` to all participants.

`clear_chat_history`:
1. Deletes all rows from `chat_messages` and `chat_reactions`.
2. Does not affect the in-memory buffer (operator can still see current session messages).

### Tauri Events Emitted

| Event | Payload | When |
|---|---|---|
| `chat_message` | `ChatMessage` | any message committed to the room (device, operator, or system) |
| `chat_reaction` | `{ message_id, emoji, sender_id, reaction }` | reaction toggled on a message |
| `chat_config_changed` | `ChatConfig` | global config changed via `set_chat_config` |

---

## Persistence Model

All data lives in `{exe_dir}/lumen/lumen.db` — the same database used by the devices table.

### `chat_settings` table (config)

```sql
CREATE TABLE IF NOT EXISTS chat_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Rows: `enabled` ("0"/"1"), `persist_enabled` ("0"/"1"), `history_limit` ("200").

### `chat_messages` table (messages + attachments)

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    file_name   TEXT,
    file_path   TEXT,
    file_size   INTEGER
);
```

- Created via `ensure_tables()` during `initialize_chat_state()`.
- Write-through on every message commit when `persist_enabled` is `true`.
- When `persist_enabled` is `false`, messages are still written to SQLite during the session but `clear_today()` deletes the current day's rows on restart.
- `get_chat_messages` reads the in-memory buffer; may page older rows from SQLite.
- History survives restarts only when persistence is on.

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

export interface ChatFile {
  file_name: string;
  file_path: string;
  file_size: number;
}

export interface ChatMessage {
  id: number;
  sender_id: string;
  sender_type: "device" | "operator";
  sender_name: string;
  text: string;
  ts: number;
  file: ChatFile | null;
}

export interface ChatConfig {
  enabled: boolean;
  persist_enabled: boolean;
  history_limit: number;
}

export const chatService = {
  sendMessage:  (text: string)                  => invoke("send_chat_message", { text }),
  sendFile:     (filePath: string, text?: string) => invoke("send_chat_file", { filePath, text: text ?? null }),
  getMessages:  (limit?: number)                => invoke<ChatMessage[]>("get_chat_messages", { limit: limit ?? null }),
  getConfig:    ()                              => invoke<ChatConfig>("get_chat_config"),
  setConfig:    (config: Partial<ChatConfig>)   => invoke("set_chat_config", { config }),
  clearHistory: ()                              => invoke("clear_chat_history"),
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
  sendFile: (filePath: string, text?: string) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setPersist: (persist: boolean) => Promise<void>;
  clearHistory: () => Promise<void>;
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

## Existing Files — Modified

| File | Change |
|---|---|
| `src-tauri/src/chat/mod.rs` | NEW — `ChatState`, `ChatStateInner`, Tauri commands, initialization |
| `src-tauri/src/chat/store.rs` | NEW — `ChatConfig`, `ChatMessage`, `ChatFile`, `ChatStore`, SQLite tables, broadcast, validation |
| `src-tauri/src/websocket.rs` | Route `chat_send`, `chat_file_send`, `chat_history` after auth + permission check |
| `src-tauri/src/devices.rs` | + `chat` in `DevicePermissions`; `permissions_chat` column migration; `map_event_permission`; `is_permission_allowed` |
| `src-tauri/src/main.rs` | Initialize `ChatState`; register `send_chat_message`, `send_chat_file`, `get_chat_messages`, `get_chat_config`, `set_chat_config`, `clear_chat_history` |
| `src/services/chat-service.ts` | NEW — invoke wrapper (deferred) |
| `src/stores/chat-store.ts` | NEW — zustand store + `chat_message` listener (deferred) |

---

## System Notifications

The server listens to Tauri events and emits `chat_message` with `sender_type: "system"` into the room. This keeps operators informed without leaving the chat.

### Listened Events

| Tauri Event | Chat Output | Example |
|---|---|---|
| `playback-started` | `Now playing: **{title}** — {artist}` | "Now playing: **Amazing Grace** — Chris Tomlin" |
| `queue-item-added` | `{added_by} added **{title}** to the queue` | "Gabriel added **How Great Is Our God** to the queue" |

System messages use `sender_id: "system"`, `sender_name: "Lumen"`, and have no file or reactions.

Setup happens in `setup_system_listeners()` called during app initialization in `main.rs`.

---

## Deferred / Out of Scope

- **UI** (panel, input, device management toggle) — data contract is ready, visual design deferred.
- **Song suggestions** — frontend-only concern; operator sends markdown with a link/text, device renders as clickable card. No server-side API needed.
- **Typing indicators** — no `chat_typing` event yet; can be added later without breaking the model.
- **Moderation** (mute/kick/delete) — the per-device `permissions_chat` flag is the only control for now.
- **Multiple rooms / channels** — single private room only.