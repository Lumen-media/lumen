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
- **Persistence:** optional. When `persist_enabled` is off, all DB rows are cleared on restart and the in-memory buffer starts empty. When on, messages survive restarts.
- **File attachments:** devices and operator can send files (up to 25 MB). Files are saved to `files/media/files/` and served via a local HTTP file server for device access.
- **Reactions:** emoji reactions on messages, toggled via `chat_reaction`.
- **Reply:** messages can reference another message via `reply_to_id`.
- **Read receipts:** devices send `chat_read` to indicate which messages they've seen; operator sees ✓✓ on read messages.
- **Typing indicators:** ephemeral `chat_typing` events.

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
                    │                                                │
                    │  ┌──────────────────┐                          │
                    │  │ file_server (HTTP)│ ◄── devices download    │
                    │  │ 127.0.0.1:port   │     files via URL       │
                    │  └──────────────────┘                          │
                    └────────────────────────────────────────────────┘
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
│   ├── store.rs       — ChatConfig, ChatMessage, ChatFile, ChatStore, persistence, broadcast, validation
│   └── file_server.rs — lightweight HTTP server for device file downloads
└── websocket.rs       — routes chat_* events (after auth + permission check)
```

---

## Message Model

```rust
pub struct ChatFile {
    pub file_name: String,   // original filename
    pub file_path: String,   // stored path on disk (operator local access)
    pub file_size: u64,      // bytes
}

pub struct Reaction {
    pub emoji:      String,
    pub sender_id:  String,
    pub ts:         u64,
}

pub struct ReplyRef {
    pub id:          u64,
    pub sender_name: String,
    pub text:        String,
    pub file:        Option<ChatFile>,
}

pub struct ChatMessage {
    pub id:          u64,              // server-assigned, monotonic (always via next_id)
    pub sender_id:   String,           // device_id, or "operator"
    pub sender_type: String,           // "device" | "operator"
    pub sender_name: String,           // device_name, or desktop name
    pub text:        String,           // markdown content
    pub ts:          u64,              // unix seconds (server clock)
    pub file:        Option<ChatFile>, // optional attachment
    pub reactions:   Vec<Reaction>,    // emoji reactions
    pub reply_to:    Option<ReplyRef>, // referenced message (if reply)
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
      "file_size": 245760,
      "file_url": "http://127.0.0.1:PORT/files/abc-uuid.jpg"
    },
    "reactions": [
      { "emoji": "👍", "sender_id": "operator", "ts": 1710000005 }
    ],
    "reply_to": {
      "id": 40,
      "sender_name": "Operator",
      "text": "check slide 2",
      "file": null
    }
  }
}
```

`file_url` is only present in the WebSocket broadcast (not stored in DB). It points to the local HTTP file server so devices can download the file.

Operator-originated messages use `sender_type: "operator"` and the desktop name as `sender_name`.

### Constants

```rust
pub const MAX_MESSAGE_LENGTH: usize = 4000;           // text is markdown, generous limit
pub const MAX_FILE_SIZE: u64 = 25 * 1024 * 1024;      // 25 MB

const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "msi", "scr", "pif", "ps1", "psm1", "vbs", "vbe",
    "js", "jse", "wsf", "wsh", "hta", "cpl", "lnk", "inf", "reg", "rgs",
];
```

---

## ChatState (Server)

Central state held in `Arc<Mutex<ChatStateInner>>` inside `AppState`, following the same pattern as `StreamManager`.

```rust
pub struct ChatState {
    pub inner: Arc<Mutex<ChatStateInner>>,
}

pub struct ChatStateInner {
    pub config:          ChatConfig,
    pub store:           ChatStore,
    pub file_server_port: u16,   // HTTP port for device file downloads
    db_path:             PathBuf, // lumen.db — shared with devices
}
```

`store.messages` (in-memory `VecDeque`) is always kept up to date regardless of persistence. When `persist_enabled` is `true`, every append is also written to SQLite; `history_limit` still caps the in-memory window returned by `chat_history`.

### ID Generation

IDs are always generated via `ChatStore.next_id` (monotonic counter). When `persist_enabled` is `true`, the ID is also inserted explicitly into SQLite (`INSERT ... VALUES (?1, ...)`) so the AUTOINCREMENT sequence stays in sync. When toggling persistence ON mid-session, `set_persist_enabled` rebases the SQLite sequence to avoid collisions.

---

## ChatConfig

```rust
pub struct ChatConfig {
    pub enabled:         bool,   // global on/off (operator toggle)
    pub persist_enabled: bool,   // write-through to SQLite
    pub history_limit:   u32,    // in-memory window (default 200)
}
```

Persisted in: `chat_settings` table in `{exe_dir}/lumen/lumen.db` (key/value rows).

**Semantics of `enabled = false`:**
- Incoming `chat_send` / `chat_file_send` / `chat_reaction` from devices is rejected with `chat_error { reason: "disabled" }`.
- The operator can still call `get_chat_messages` (reads the buffer).
- History remains available to the operator; it is just not broadcastable to devices.

**Semantics of `persist_enabled = false`:**
- Messages are still written to SQLite during the session (in-memory ring buffer + DB).
- On restart, **all** rows in `chat_messages` and `chat_reactions` are deleted.
- The in-memory buffer starts empty.

---

## Protocol Extension (WebSocket — port 8080)

Events routed in `websocket.rs`. All `chat_*` events require an authenticated session and the `chat` permission.

### Device → Desktop

```jsonc
// send a text message (markdown), optional reply_to_id
{ "event": "chat_send", "text": "projection froze on slide two", "reply_to_id": 40 }

// send a file attachment (+ optional text + optional reply_to_id)
{ "event": "chat_file_send", "file_name": "photo.jpg", "data": "<base64>", "text": "check this", "reply_to_id": 40 }

// toggle a reaction on a message (same emoji+sender = remove)
{ "event": "chat_reaction", "message_id": 42, "emoji": "👍" }

// request recent history
{ "event": "chat_history", "limit": 50 }

// signal that device has read messages up to this id
{ "event": "chat_read", "last_read_id": 42 }

// typing indicator
{ "event": "chat_typing", "is_typing": true }
```

### Desktop → Device

```jsonc
// a message broadcast to the room (everyone, including sender echo)
{ "event": "chat_message", "message": { "id": 42, ..., "file": { ..., "file_url": "http://127.0.0.1:PORT/files/uuid.jpg" } } }

// reaction broadcast
{ "event": "chat_reaction", "message_id": 42, "emoji": "👍", "sender_id": "device-abc", "reaction": { ... } }

// typing indicator
{ "event": "chat_typing", "sender_id": "device-abc", "sender_name": "...", "is_typing": true }

// message deleted
{ "event": "chat_deleted", "message_id": 42 }

// history response
{ "event": "chat_history", "messages": [ ... ] }

// read receipt (from another device)
{ "event": "chat_read", "device_id": "device-abc", "last_read_id": 42 }

// error
{ "event": "chat_error", "reason": "disabled" | "empty_message" | "message_too_long" | "file_too_large" | "invalid_file" | "file_save_error" | "blocked_file_type" | "no_permission" | "missing_message_id" | "missing_emoji" | "message_not_found" }
```

### Permission Mapping

```rust
fn map_event_permission(event: &str) -> Option<&'static str> {
    match event {
        "chat_send" | "chat_file_send" | "chat_history" | "chat_reaction" | "chat_typing" | "chat_read" => Some("chat"),
        _ => None,
    }
}
```

When an authenticated device without `permissions_chat` sends a chat event, it receives `chat_error { reason: "no_permission" }`. The connection stays open.

---

## Fan-Out

Uses the existing session registry (`DeviceState.sessions`), the same source that powers `broadcast_remote_event_inner`.

```rust
pub fn broadcast_chat_message(
    state: &DeviceState,
    message: &ChatMessage,
    file_server_port: u16,
) -> Result<(), String> {
    // Builds JSON payload with file_url when file is present
    // Sends to all sessions with chat permission (including sender echo)
}
```

A message only exists after it is committed to `ChatState` (and SQLite when persistence is on), so every receiver gets the same canonical `id` and `ts`.

---

## File Attachments

Files are saved to `{exe_dir}/lumen/files/media/files/` — the same folder Lumen's file manager already indexes.

- UUID-based filenames prevent collisions; the original filename is stored in `ChatFile.file_name`.
- **Blocked extensions:** `.exe`, `.bat`, `.cmd`, `.com`, `.msi`, `.scr`, `.pif`, `.ps1`, `.vbs`, `.js`, `.hta`, `.cpl`, `.lnk`, `.inf`, `.reg` — rejected with `chat_error { reason: "blocked_file_type" }`.
- **Operator file access:** via local `file_path` (direct disk access).
- **Device file access:** via `file_url` in the broadcast payload, pointing to the local HTTP file server (`http://127.0.0.1:PORT/files/uuid.ext`). CORS enabled (`Access-Control-Allow-Origin: *`).

### Device → Desktop (`chat_file_send`)

1. Device sends base64-encoded file data.
2. Pre-check: `data.len() * 3/4` must be ≤ `MAX_FILE_SIZE` (prevents memory DoS).
3. Server decodes base64, validates extension, saves to disk with UUID filename.
4. Creates `ChatMessage` with `file` populated, broadcasts with `file_url`.

### Operator (`send_chat_file`)

1. Reads file from `file_path` on disk.
2. Saves to `files/media/files/` with UUID filename.
3. Same commit → broadcast → emit → return flow.

### File Server

A lightweight HTTP server (`chat/file_server.rs`) runs on a random port at `127.0.0.1`. It serves files from `files/media/files/` with:
- CORS headers for cross-origin access
- MIME type guessing (jpg, png, gif, pdf, mp4, etc.)
- Path traversal protection (`..` and `\` blocked)

---

## Read Receipts

Devices indicate which messages they've seen by sending `chat_read { last_read_id: <id> }`. The server emits a `chat_read` Tauri event to the operator. The frontend marks all operator messages with `id ≤ last_read_id` as `read: true`, showing a double check mark (✓✓).

---

## Operator Integration (Desktop)

The operator does **not** appear in the device session registry, so chat is bridged to the desktop UI via Tauri commands and events — the same pattern used by `streaming_status_changed` / `mobile_stream_started`.

### Tauri Commands

```rust
#[tauri::command] async fn send_chat_message(text: String, reply_to_id: Option<u64>) -> Result<ChatMessage, String>
#[tauri::command] async fn send_chat_file(file_path: String, text: Option<String>, reply_to_id: Option<u64>) -> Result<ChatMessage, String>
#[tauri::command] async fn send_chat_reaction(message_id: u64, emoji: String) -> Result<ChatReactionResult, String>
#[tauri::command] async fn send_chat_typing(is_typing: bool) -> Result<(), String>
#[tauri::command] async fn delete_chat_message(message_id: u64) -> Result<(), String>
#[tauri::command] async fn get_chat_messages(limit: Option<u32>) -> Result<Vec<ChatMessage>, String>
#[tauri::command] async fn get_chat_config()  -> Result<ChatConfig, String>
#[tauri::command] async fn set_chat_config(config: ChatConfig) -> Result<(), String>
#[tauri::command] async fn clear_chat_history() -> Result<(), String>
```

`send_chat_message`:
1. Validates text (non-empty, under `MAX_MESSAGE_LENGTH`).
2. Builds `ChatMessage { sender_type: "operator", sender_name: <desktop_name()>, ... }`.
3. If `reply_to_id` is provided, looks up the referenced message and builds `ReplyRef`.
4. Commits it to `ChatState` via `store.push()` (ID from `next_id`, persisted if enabled).
5. Calls `broadcast_chat_message` to device sessions (includes `file_url` for file messages).
6. Emits `chat_message` Tauri event (echo).
7. Returns the committed `ChatMessage` to the caller.

`send_chat_file`:
1. Reads file from `file_path` on disk.
2. Saves to `files/media/files/` with UUID filename (validates extension).
3. Builds `ChatMessage` with `file` populated.
4. Same commit → broadcast → emit → return flow.

`send_chat_reaction`:
1. Validates message exists (`message_not_found` error if not).
2. Toggles the reaction: same emoji + same sender = removes it; otherwise adds it.
3. Persists to `chat_reactions` table (UNIQUE constraint on message_id+emoji+sender_id).
4. Broadcasts `chat_reaction` to device sessions.
5. Emits `chat_reaction` Tauri event.
6. Returns `ChatReactionResult { message_id, emoji, sender_id, reaction }`.

`send_chat_typing`:
1. Broadcasts `chat_typing` event to all device sessions with `chat` permission.
2. Emits `chat_typing` Tauri event for the frontend.
3. No persistence — ephemeral event.

`delete_chat_message`:
1. Removes file from disk (if present).
2. Removes message from the in-memory `VecDeque`.
3. Deletes message and its reactions from SQLite (`chat_messages` + `chat_reactions`).
4. Broadcasts `chat_deleted` to device sessions.
5. Emits `chat_deleted` Tauri event for the frontend.

`clear_chat_history`:
1. Removes all files referenced in `chat_messages` from disk.
2. Clears in-memory buffer.
3. Deletes all rows from `chat_messages` and `chat_reactions`.

### Tauri Events Emitted

| Event | Payload | When |
|---|---|---|
| `chat_message` | `ChatMessage` | any message committed to the room (device or operator) |
| `chat_reaction` | `{ message_id, emoji, sender_id, reaction }` | reaction toggled on a message |
| `chat_typing` | `{ sender_id, sender_name, is_typing }` | typing status changed |
| `chat_deleted` | `{ message_id }` | message deleted by operator |
| `chat_read` | `{ device_id, last_read_id }` | device read messages up to this id |
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
    file_size   INTEGER,
    reply_to_id INTEGER
);
```

### `chat_reactions` table

```sql
CREATE TABLE IF NOT EXISTS chat_reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    emoji      TEXT NOT NULL,
    sender_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(message_id, emoji, sender_id)
);
```

- Created via `ensure_tables()` during `initialize_chat_state()`.
- Write-through on every message commit when `persist_enabled` is `true`.
- When `persist_enabled` is `false`, **all** rows are deleted from `chat_messages` and `chat_reactions` on restart.
- `get_chat_messages` reads the in-memory buffer (capped by `history_limit`).

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
    pub chat:      bool,
}
```

### SQLite Migration

```sql
ALTER TABLE devices ADD COLUMN permissions_chat INTEGER NOT NULL DEFAULT 0;
```

Applied in `ensure_devices_schema()` with the same pattern used for `permissions_streaming` (PRAGMA `table_info` check + `ALTER TABLE ADD COLUMN`), so existing databases upgrade in place.

**Default `0` (off):** the operator must explicitly allow chat per device.

---

## Error Responses

All chat errors are delivered as `{ "event": "chat_error", "reason": "..." }`.

| Reason | When |
|---|---|
| `disabled` | `ChatConfig.enabled = false` |
| `empty_message` | `chat_send` with empty/whitespace-only text |
| `message_too_long` | Text exceeds 4000 bytes |
| `file_too_large` | File exceeds 25 MB |
| `invalid_file` | Base64 decode failed |
| `file_save_error` | Disk I/O error (message masked, no path leaked) |
| `blocked_file_type` | Extension in `BLOCKED_EXTENSIONS` |
| `no_permission` | Device lacks `permissions_chat` |
| `missing_message_id` | `chat_reaction` without `message_id` |
| `missing_emoji` | `chat_reaction` without `emoji` |
| `message_not_found` | Reaction on nonexistent/deleted message |

---

## Deferred / Out of Scope

- **Song suggestions** — frontend-only concern; operator sends markdown with a link/text, device renders as clickable card.
- **System notifications** — explicitly rejected: operators already see playback/queue state elsewhere in the app.
- **Moderation** (mute/kick) — the per-device `permissions_chat` flag is the only control for now.
- **Multiple rooms / channels** — single private room only.

---

## Frontend Architecture

### Component Tree

```
AsidePanel (aside-panel.tsx)
├── Tabs (queue | notes | themes | chat)
│   └── TabsContent value="chat"
│       └── ChatTab (chat-panel.tsx)
│           ├── ChatFileDialog (modal for YouTube links, images, PPTs)
│           ├── ScrollArea + useVirtualizer (TanStack Virtual)
│           │   └── MemoizedMessageBubble[] (virtualized)
│           │       ├── ContextMenu (copy text, copy link, reply, delete)
│           │       ├── Reply ghost (click → scroll to message)
│           │       ├── FilePreview (image, PDF, PPT thumbnails)
│           │       ├── Text (renderMarkdown)
│           │       └── Reactions + timestamp + read indicator
│           └── TextEditor (TipTap) + send/attach buttons
```

### Tab Chameleon

The aside has a dynamic third tab slot (`getChameleonTab` in `aside-panel.tsx`). When `activeTab === 'chat'`, the slot shows **Chat** (selected). Otherwise it shows **Themes**. The chat tab only mounts when `activeTab === 'chat'` (Radix unmounts inactive `TabsContent`). Entry via the header chat button (`openChat` in `app-header.tsx`) — `Ctrl+Shift+C`.

### Zustand Store (`chat-store.ts`)

Single `useChatStore` with the following shape:

```typescript
interface ChatStore {
  messages: ChatMessage[];
  config: ChatConfig;
  typingUsers: Record<string, { name: string; isTyping: boolean }>;
  unread: number;
  notificationMode: 'toast' | 'in-app' | 'system';

  init(): Promise<void>;
  sendMessage(text: string, replyToId?: number): Promise<void>;
  sendFile(filePath: string, text?: string, replyToId?: number): Promise<void>;
  sendReaction(messageId: number, emoji: string): Promise<void>;
  sendTyping(isTyping: boolean): Promise<void>;
  deleteMessage(messageId: number): Promise<void>;
  markRead(): void;
  toggleEnabled(): void;
  setPersistEnabled(v: boolean): Promise<void>;
  setHistoryLimit(limit: number): Promise<void>;
  setNotificationMode(mode: string): void;
}
```

**Initialization (`init`):** loads `chat_history` from Rust backend, then sets up Tauri event listeners: `chat_message`, `chat_reaction`, `chat_config_changed`, `chat_deleted`, `chat_read`, `chat_typing`. Each listener updates the store via `set()`.

**Listeners:**
- `chat_message`: deduplicates by `id` (ignores if already present), appends to array, caps at `messageIndex` (500), increments unread if not on chat tab.
- `chat_reaction`: finds message by `id`, applies/removes reaction via `applyReaction` helper.
- `chat_config_changed`: replaces config state.
- `chat_deleted`: removes message by `id`.
- `chat_read`: marks operator messages with `id ≤ last_read_id` as read (bails out early if no unread changes).
- `chat_typing`: debounced per-device typing status (auto-clears after 3s).

**Retry queue:** failed `sendMessage` calls are queued and retried with exponential backoff (max 3 retries, 2s interval).

**Notification mode:** controls how new message notifications appear.

### ChatTab (`chat-panel.tsx`)

**Virtualization:** uses `@tanstack/react-virtual` with `overscan: 5`. Elements are measured via `measureElement` on mount. Auto-scrolls to bottom on new messages (gated by `isNearBottomRef` with 300px threshold — respects scroll-up state).

**Scroll behavior:** first scroll after opening is `'auto'` (instant), subsequent scrolls are `'smooth'`. Scroll listener uses `requestAnimationFrame` throttling to track `isNearBottomRef`.

**State management:** uses individual zustand selectors (`useChatStore((s) => s.messages)`) to minimize re-renders. Callbacks wrapped in `useCallback` with stable dependencies.

**Memoization strategy:**
- `React.memo` on `MessageBubble` with custom comparator (id, text, read, showHeader, reactions, file_path, onScrollToMessage).
- `markdownCache` (Map): caches rendered markdown nodes per text content (max 1000 entries, FIFO eviction).
- `senderColorCache`, `formatTimeCache`: Map caches for expensive formatting.
- `groupReactionsCache` (WeakMap): caches reaction groupings by reactions array reference.
- `pptThumbnailCache` (Map): caches PPT thumbnail data URLs by file path (prevents re-rendering PPT for each view).

### MessageBubble

Props: `message`, `showHeader`, `onReply`, `onLinkClick`, `onPresentableClick`, `onScrollToMessage`.

- **Reply ghost:** clicking the quoted reply scrolls the virtualizer to the original message (`handleScrollToMessage` → `virtualizer.scrollToIndex`).
- **Animations:** entry animation via `anime.js` (opacity 0→1, translateY 12→0, 260ms). Exit animation on delete (fade + height collapse). Guarded by module-level `seenMessageIds` Set to prevent replay on virtualizer remount.
- **Context menu:** Copy text, Copy link (when right-clicking a link), Reply, Delete.
- **Link handling:** YouTube links (`parseYouTubeUrl`) open `ChatFileDialog` with preview. Other links open in new tab.

### ChatFileDialog

Handles three target types via discriminated union:
- `{ type: 'youtube'; url }` — fetches oEmbed metadata (title, artist, thumb), looks up duration from media DB. Buttons: Play Now (loadFile), Add to Queue.
- `{ type: 'file'; file_name; file_path }` — generates thumbnail via `thumbnailService` (images) or `getPptThumbnail` (PPT). Button: Present (loadFile with auto-detect).

**PPT thumbnail generation:** `getPptThumbnail` reads file bytes → opens hidden PptxViewer → renders slide 0 to 320px → captures as JPEG via `html-to-image` → caches result. Expensive operation, hence the module-level cache.

### Markdown Rendering (`renderMarkdown`)

Parses text for: `**bold**`, `*italic*`, `[text](url)` markdown links. YouTube URLs are detected via `parseYouTubeUrl` and rendered as clickable `<a>` with `onClick` that calls the callback (opens ChatFileDialog). Non-YouTube links render with `target="_blank"`.

**Note:** raw URLs (not in markdown `[text](url)` format) are rendered as plain text — they are not auto-linked.

### Performance Optimization Summary

| Technique | Target | Impact |
|---|---|---|
| Individual zustand selectors | ChatTab re-renders | Only re-renders when specific state slices change |
| `React.memo` with comparator | MessageBubble | Skips render when message unchanged |
| `markdownCache` (Map, max 1000) | Markdown parsing | Avoids re-parsing same text |
| `senderColorCache`, `formatTimeCache` | String formatting | O(1) lookup after first computation |
| `groupReactionsCache` (WeakMap) | Reaction grouping | Reuses result when reactions array unchanged |
| `pptThumbnailCache` (Map) | PPT thumbnail rendering | Prevents re-opening PptxViewer for same file |
| `overscan: 5` | Virtualizer items | Fewer heavy components off-screen |
| Scroll rAF throttling | Scroll listener | Limits scroll handler execution |
| `chat_read` early bail-out | Store listener | Avoids full message array clone when no change |

