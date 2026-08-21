# Chat WebSocket Events

Reference for all chat-related WebSocket events between devices and the Lumen server on port 8080.

All chat events require:
- Authenticated session (via `register` or `auth`)
- `permissions_chat = true` on the device
- `ChatConfig.enabled = true` globally

Events that fail permission checks receive `chat_error`.

---

## Device → Server

### `chat_send`

Send a text message to the chat room.

```json
{
  "event": "chat_send",
  "text": "Hey everyone, ready for rehearsal?"
}
```

| Field  | Type   | Required | Description |
|--------|--------|----------|-------------|
| `text` | string | yes      | Message content (markdown). Max 4000 chars. |

**Responses:**
- Success: `chat_message` broadcast to all participants + Tauri event
- Error: `chat_error { reason: "disabled" | "empty_message" | "message_too_long:..." }`

---

### `chat_file_send`

Send a file attachment to the chat room.

```json
{
  "event": "chat_file_send",
  "file_name": "setlist.pdf",
  "data": "JVBERi0xLjQK..."
}
```

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `file_name` | string | yes      | Original filename |
| `data`      | string | yes      | Base64-encoded file content |

**Limits:** Max 25 MB (`MAX_FILE_SIZE`). Files saved to `{exe_dir}/lumen/files/media/files/` with UUID filename.

**Responses:**
- Success: `chat_message` broadcast with `file` field populated
- Error: `chat_error { reason: "disabled" | "invalid_file" | "file_too_large" }`

---

### `chat_reaction`

Toggle a reaction on a message. Same emoji + same sender = removes it.

```json
{
  "event": "chat_reaction",
  "message_id": 42,
  "emoji": "👍"
}
```

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `message_id` | number | yes     | ID of the message to react to |
| `emoji`      | string | yes     | Emoji character |

**Responses:**
- Success: `chat_reaction` broadcast to all participants + Tauri event
- Error: `chat_error { reason: "disabled" }`

---

### `chat_typing`

Signal that the device is typing or stopped typing.

```json
{
  "event": "chat_typing",
  "is_typing": true
}
```

| Field       | Type | Required | Description |
|-------------|------|----------|-------------|
| `is_typing` | bool | yes      | `true` = started typing, `false` = stopped |

**Responses:**
- `chat_typing` broadcast to all participants + Tauri event (ephemeral, no persistence)

---

### `chat_history`

Request the message history.

```json
{
  "event": "chat_history"
}
```

**Response:** `chat_history` event with `{ messages: ChatMessage[] }` sent back to the requesting device only.

---

## Server → Devices

### `chat_message`

A new message was committed to the room.

```json
{
  "event": "chat_message",
  "message": {
    "id": 42,
    "sender_id": "device-abc",
    "sender_type": "device",
    "sender_name": "iPad Worship",
    "text": "Hey everyone!",
    "ts": 1724000000,
    "file": null,
    "reactions": [],
    "reply_to": null
  }
}
```

Sent to all participants with `chat` permission (including the sender — echo).

---

### `chat_reaction`

A reaction was toggled on a message.

```json
{
  "event": "chat_reaction",
  "message_id": 42,
  "emoji": "👍",
  "sender_id": "device-abc",
  "reaction": { "emoji": "👍", "sender_id": "device-abc", "ts": 1724000005 }
}
```

| Field       | Type          | Description |
|-------------|---------------|-------------|
| `message_id` | number       | Target message ID |
| `emoji`      | string       | The emoji |
| `sender_id`  | string       | Who reacted |
| `reaction`   | object\|null | Full reaction object if added, `null` if removed (toggle) |

Sent to all participants with `chat` permission.

---

### `chat_typing`

A participant started or stopped typing.

```json
{
  "event": "chat_typing",
  "sender_id": "device-abc",
  "sender_name": "iPad Worship",
  "is_typing": true
}
```

| Field        | Type   | Description |
|--------------|--------|-------------|
| `sender_id`  | string | Who is typing |
| `sender_name` | string | Display name |
| `is_typing`  | bool   | `true` = typing, `false` = stopped |

Sent to all participants with `chat` permission. Ephemeral — no persistence.

---

### `chat_deleted`

A message was deleted by the operator.

```json
{
  "event": "chat_deleted",
  "message_id": 42
}
```

| Field        | Type   | Description |
|--------------|--------|-------------|
| `message_id` | number | ID of the deleted message |

Sent to all participants with `chat` permission. The message should be removed from the local store. Reactions associated with the message are also deleted.

---

### `chat_history`

Response to a `chat_history` request. Sent only to the requesting device.

```json
{
  "event": "chat_history",
  "messages": [
    {
      "id": 1,
      "sender_id": "operator",
      "sender_type": "operator",
      "sender_name": "Gabriel Desktop",
      "text": "Good morning!",
      "ts": 1723999900,
      "file": null,
      "reactions": [{ "emoji": "👍", "sender_id": "device-abc", "ts": 1723999950 }],
      "reply_to": null
    }
  ]
}
```

---

### `chat_error`

Error response for chat operations.

```json
{
  "event": "chat_error",
  "reason": "disabled"
}
```

| Reason              | When |
|---------------------|------|
| `disabled`          | `ChatConfig.enabled = false` |
| `empty_message`     | `chat_send` with empty text |
| `message_too_long`  | Text exceeds 4000 chars |
| `invalid_file`      | File decode/save failed |
| `file_too_large`    | File exceeds 25 MB |
| `no_permission`     | Device lacks `permissions_chat` |

---

## Tauri Events (Frontend)

These events are emitted via `app.emit()` for the desktop operator frontend.

| Event              | Payload                            | When |
|--------------------|------------------------------------|------|
| `chat_message`     | `ChatMessage`                      | Message committed (device or operator) |
| `chat_reaction`    | `{ message_id, emoji, sender_id, reaction }` | Reaction toggled |
| `chat_typing`      | `{ sender_id, sender_name, is_typing }`      | Typing status changed |
| `chat_deleted`     | `{ message_id }`                   | Message deleted |
| `chat_config_changed` | `ChatConfig`                    | Config changed via `set_chat_config` |

### Tauri Commands (Operator → Rust)

| Command               | Returns              | Description |
|-----------------------|----------------------|-------------|
| `send_chat_message`   | `ChatMessage`        | Send text message |
| `send_chat_file`      | `ChatMessage`        | Send file attachment |
| `send_chat_reaction`  | `ChatReactionResult` | Toggle reaction |
| `send_chat_typing`    | `()`                 | Broadcast typing status |
| `delete_chat_message` | `()`                 | Delete a message by ID |
| `get_chat_messages`   | `ChatMessage[]`      | Load message history |
| `get_chat_config`     | `ChatConfig`         | Get current config |
| `set_chat_config`     | `()`                 | Update config |
| `clear_chat_history`  | `()`                 | Delete all messages + reactions |

---

## Data Types

### ChatMessage

```json
{
  "id": 42,
  "sender_id": "device-abc",
  "sender_type": "device",
  "sender_name": "iPad Worship",
  "text": "**Amazing Grace** — Chris Tomlin",
  "ts": 1724000000,
  "file": {
    "file_name": "setlist.pdf",
    "file_path": "C:/Users/.../lumen/files/media/files/abc-123.pdf",
    "file_size": 204800
  },
  "reactions": [
    { "emoji": "👍", "sender_id": "device-xyz", "ts": 1724000005 }
  ],
  "reply_to": {
    "id": 40,
    "sender_name": "John",
    "text": "Which song first?",
    "file": null
  }
}
```

| Field        | Type           | Description |
|--------------|----------------|-------------|
| `id`         | number         | Auto-increment from SQLite |
| `sender_id`  | string         | `"operator"` for desktop, device_id for devices |
| `sender_type` | string        | `"operator"` or `"device"` |
| `sender_name` | string        | Display name (formatted desktop name or device name) |
| `text`       | string         | Markdown content |
| `ts`         | number         | Unix timestamp (seconds) |
| `file`       | object\|null   | Attachment metadata |
| `reactions`  | Reaction[]     | List of reactions |
| `reply_to`   | object\|null   | Referenced message info (id, sender_name, text, file) |

### ChatConfig

```json
{
  "enabled": true,
  "persist_enabled": false,
  "history_limit": 200
}
```

### ChatReactionResult

Returned by `send_chat_reaction` Tauri command.

```json
{
  "message_id": 42,
  "emoji": "👍",
  "sender_id": "operator",
  "reaction": { "emoji": "👍", "sender_id": "operator", "ts": 1724000005 }
}
```

`reaction` is `null` when the reaction was removed (toggle off).
