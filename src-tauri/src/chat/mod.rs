//! Live chat system for Lumen's event experience.
//!
//! The chat lets the operator and connected audience members exchange text
//! messages, replies, emoji reactions, typing indicators, and file
//! attachments while an event is running. This module is the composition
//! layer: it owns the shared [`ChatState`], wires together persistence from
//! [`store`] and local file sharing from [`file_server`], and exposes the
//! Tauri commands used by the desktop frontend.
//!
//! Every mutation is broadcast twice:
//!
//! * over WebSocket to remote devices (via the `broadcast_*` helpers in
//!   [`store`]), and
//! * as a Tauri event to the desktop webview (`chat_message`,
//!   `chat_config_changed`, `chat_deleted`, `chat_reaction`, `chat_typing`).

pub mod file_server;
pub mod store;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use store::{ChatConfig, ChatMessage, ChatStore};

use crate::devices::DeviceState;

/// Tauri-managed shared state for the live chat system.
///
/// Registered with `.manage(...)` during startup (see
/// [`initialize_chat_state`]) and injected into every chat command via
/// `State<'_, ChatState>`. The handle is cheap to clone, so all clones refer
/// to the same underlying state.
#[derive(Clone)]
pub struct ChatState {
    /// Interior-mutable guard around [`ChatStateInner`].
    ///
    /// Every command must lock this mutex before reading or writing chat
    /// state; the lock is a `tokio::sync::Mutex`, so it may be held across
    /// `.await` points.
    pub inner: Arc<Mutex<ChatStateInner>>,
}

/// The actual chat data protected by [`ChatState::inner`].
pub struct ChatStateInner {
    /// Current chat settings (enabled flag, history limit, persistence).
    pub config: ChatConfig,
    /// In-memory message ring plus the SQLite connection used for
    /// persistence and reactions.
    pub store: ChatStore,
    /// Loopback TCP port of the [`file_server::ChatFileServer`] that serves
    /// attached chat files to local and remote clients.
    pub file_server_port: u16,
    db_path: PathBuf,
}

fn chat_db_path() -> Result<PathBuf, String> {
    crate::paths::db_path()
}

fn chat_files_dir() -> Result<PathBuf, String> {
    crate::paths::media_dir("files")
}

fn desktop_name(app: &AppHandle) -> String {
    crate::devices::resolve_desktop_name(app)
}

/// Opens the chat database, restores persisted history, and starts the local
/// chat file server.
///
/// Called once during app setup; the returned [`ChatState`] is then managed
/// by Tauri and shared with all chat commands.
///
/// # Errors
///
/// Returns an error string when the database or media directory cannot be
/// resolved, when the SQLite connection cannot be opened, when loading
/// persisted history fails, or when the file server cannot bind to a local
/// port.
pub fn initialize_chat_state() -> Result<ChatState, String> {
    let db_path = chat_db_path()?;
    let files_dir = chat_files_dir()?;

    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    store::ensure_tables(&conn)?;
    let config = store::load_config(&conn)?;
    drop(conn);

    let mut chat_store = ChatStore::new(
        config.history_limit,
        config.persist_enabled,
        db_path.clone(),
        files_dir.clone(),
    );
    chat_store.load_from_disk()?;

    let mut file_server = file_server::ChatFileServer::new(files_dir);
    tauri::async_runtime::block_on(file_server.start())?;
    let file_server_port = file_server.port();

    Ok(ChatState {
        inner: Arc::new(Mutex::new(ChatStateInner {
            config,
            store: chat_store,
            file_server_port,
            db_path,
        })),
    })
}

/// Tauri command: sends a text message from the operator.
///
/// Validates and trims the text, resolves the optional reply target, commits
/// the message to the [`store::ChatStore`], broadcasts it to WebSocket
/// sessions with the `chat` permission, and emits a `chat_message` event to
/// the desktop webview.
///
/// Returns the stored message, including its newly assigned `id`.
///
/// # Examples
///
/// ```js
/// const message = await invoke("send_chat_message", { text: "Hello!", replyToId: 3 });
/// ```
///
/// # Errors
///
/// Returns `"chat_disabled"` when the chat is turned off in the config, or
/// the validation error from [`store::validate_message_text`]
/// (`"empty_message"` / `"message_too_long"`). Broadcast or serialization
/// failures are reported as a raw error string.
#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    text: String,
    reply_to_id: Option<u64>,
) -> Result<ChatMessage, String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Err("chat_disabled".to_string());
    }

    let clean_text = store::validate_message_text(&text)?;

    let reply_to = reply_to_id.and_then(|rid| {
        inner.store.find_message(rid).map(|m| store::ReplyRef {
            id: m.id,
            sender_name: m.sender_name.clone(),
            text: m.text.clone(),
            file: m.file.clone(),
        })
    });

    let msg = ChatMessage {
        id: 0,
        sender_id: "operator".to_string(),
        sender_type: "operator".to_string(),
        sender_name: desktop_name(&app),
        text: clean_text,
        ts: crate::devices::now_ts(),
        file: None,
        reactions: Vec::new(),
        reply_to,
        reply_to_id: None,
    };

    let committed = inner.store.push(msg);
    let port = inner.file_server_port;

    store::broadcast_chat_message(&device_state, &committed, port)?;

    drop(inner);

    let _ = app.emit("chat_message", &committed);

    Ok(committed)
}

/// Tauri command: sends a file attachment with an optional caption.
///
/// Reads the file from disk, stores it under the chat files directory with a
/// generated UUID name (see [`store::ChatStore::save_file`]), creates a
/// [`store::ChatMessage`] carrying the attachment, broadcasts it, and emits
/// `chat_message` to the desktop webview.
///
/// # Examples
///
/// ```js
/// const message = await invoke("send_chat_file", {
///   filePath: "C:\\Users\\me\\poster.png",
///   text: "Check this out",
///   replyToId: null,
/// });
/// ```
///
/// # Errors
///
/// * `"chat_disabled"` — the chat is disabled in the config.
/// * `"read_file_error"` — `file_path` could not be read.
/// * `"file_too_large"` — the file exceeds [`store::MAX_FILE_SIZE`].
/// * `"blocked_file_type"` — the extension is in
///   [`store`]'s blocked list.
/// * `"file_save_error"` — writing the file to disk failed.
#[tauri::command]
pub async fn send_chat_file(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    file_path: String,
    text: Option<String>,
    reply_to_id: Option<u64>,
) -> Result<ChatMessage, String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Err("chat_disabled".to_string());
    }

    let data = std::fs::read(&file_path).map_err(|_| "read_file_error".to_string())?;

    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let chat_file = inner.store.save_file(&file_name, &data)?;

    let reply_to = reply_to_id.and_then(|rid| {
        inner.store.find_message(rid).map(|m| store::ReplyRef {
            id: m.id,
            sender_name: m.sender_name.clone(),
            text: m.text.clone(),
            file: m.file.clone(),
        })
    });

    let msg = ChatMessage {
        id: 0,
        sender_id: "operator".to_string(),
        sender_type: "operator".to_string(),
        sender_name: desktop_name(&app),
        text: text.unwrap_or_default(),
        ts: crate::devices::now_ts(),
        file: Some(chat_file),
        reactions: Vec::new(),
        reply_to,
        reply_to_id: None,
    };

    let committed = inner.store.push(msg);
    let port = inner.file_server_port;

    store::broadcast_chat_message(&device_state, &committed, port)?;

    drop(inner);

    let _ = app.emit("chat_message", &committed);

    Ok(committed)
}

/// Tauri command: returns the most recent chat messages.
///
/// When `limit` is omitted the whole retained history is returned, oldest
/// first.
///
/// # Examples
///
/// ```js
/// const last50 = await invoke("get_chat_messages", { limit: 50 });
/// ```
#[tauri::command]
pub async fn get_chat_messages(
    chat: State<'_, ChatState>,
    limit: Option<u32>,
) -> Result<Vec<ChatMessage>, String> {
    let inner = chat.inner.lock().await;
    Ok(inner.store.get_messages(limit))
}

/// Tauri command: returns the current chat configuration.
///
/// # Examples
///
/// ```js
/// const config = await invoke("get_chat_config");
/// // { enabled: true, persistEnabled: false, historyLimit: 200, notificationMode: "toast" }
/// ```
#[tauri::command]
pub async fn get_chat_config(chat: State<'_, ChatState>) -> Result<ChatConfig, String> {
    let inner = chat.inner.lock().await;
    Ok(inner.config.clone())
}

/// Tauri command: replaces the chat configuration and persists it to SQLite.
///
/// Applies the new settings to the running [`store::ChatStore`] (toggling
/// persistence may rebase the message id sequence; lowering the history limit
/// trims the oldest messages), saves the config to the `chat_settings` table,
/// and emits `chat_config_changed` to the desktop webview. When the
/// `enabled` flag changed, the new state is also broadcast to WebSocket
/// sessions so remote clients can show or hide the chat.
///
/// # Examples
///
/// ```js
/// await invoke("set_chat_config", {
///   config: { enabled: true, persistEnabled: true, historyLimit: 500, notificationMode: "toast" },
/// });
/// ```
///
/// # Errors
///
/// Returns an error string when the config cannot be written to the database
/// or when the enable/disable broadcast fails.
#[tauri::command]
pub async fn set_chat_config(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    config: ChatConfig,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;

    let enabled_changed = inner.config.enabled != config.enabled;

    if inner.config.persist_enabled != config.persist_enabled {
        inner.store.set_persist_enabled(config.persist_enabled);
    }

    if inner.config.history_limit != config.history_limit {
        inner.store.set_history_limit(config.history_limit);
    }

    inner.config = config.clone();

    let conn = rusqlite::Connection::open(&inner.db_path).map_err(|e| e.to_string())?;
    store::save_config(&conn, &config)?;

    if enabled_changed {
        store::broadcast_chat_config(&device_state, &config)?;
    }

    let _ = app.emit("chat_config_changed", config);

    Ok(())
}

/// Tauri command: deletes all chat history.
///
/// Clears the in-memory ring, removes every stored attachment file, and
/// wipes the `chat_messages` and `chat_reactions` tables. It does not emit
/// any event; remote devices learn about it through their own state.
///
/// # Errors
///
/// Returns an error string when a SQLite delete statement fails.
#[tauri::command]
pub async fn clear_chat_history(chat: State<'_, ChatState>) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;
    inner.store.clear_history()
}

/// Tauri command: deletes a single message and its attachment.
///
/// Removes the message (and its file) from memory and SQLite, clears its
/// reactions, detaches replies that pointed at it, then broadcasts a
/// `chat_deleted` event over WebSocket and to the desktop webview.
///
/// # Examples
///
/// ```js
/// await invoke("delete_chat_message", { messageId: 42 });
/// ```
///
/// # Errors
///
/// Returns an error string when the message id does not exist or a SQLite
/// statement fails.
#[tauri::command]
pub async fn delete_chat_message(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    message_id: u64,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;
    inner.store.delete_message(message_id)?;
    drop(inner);

    store::broadcast_chat_delete(&device_state, message_id)?;

    let _ = app.emit(
        "chat_deleted",
        serde_json::json!({ "message_id": message_id }),
    );

    Ok(())
}

/// Outcome of toggling an emoji reaction, returned by
/// [`send_chat_reaction`].
#[derive(serde::Serialize)]
pub struct ChatReactionResult {
    /// Id of the message the reaction was toggled on.
    pub message_id: u64,
    /// The emoji that was toggled.
    pub emoji: String,
    /// Id of the sender that toggled the reaction (`"operator"` for chat
    /// commands).
    pub sender_id: String,
    /// The reaction after the toggle: `Some` when it was added, `None` when
    /// an existing reaction was removed.
    pub reaction: Option<store::Reaction>,
}

/// Tauri command: adds or removes an emoji reaction on a message.
///
/// Toggles the operator's reaction for `emoji` on message `message_id`
/// (adding it when absent, removing it otherwise), broadcasts the result to
/// WebSocket sessions, and emits a `chat_reaction` event to the desktop
/// webview.
///
/// # Examples
///
/// ```js
/// const result = await invoke("send_chat_reaction", { messageId: 42, emoji: "🎉" });
/// // result.reaction is Some(...) when added, None when removed
/// ```
///
/// # Errors
///
/// Returns `"chat_disabled"` when the chat is disabled, `"message_not_found"`
/// when `message_id` does not exist in the retained history, or a SQLite
/// error string.
#[tauri::command]
pub async fn send_chat_reaction(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    message_id: u64,
    emoji: String,
) -> Result<ChatReactionResult, String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Err("chat_disabled".to_string());
    }

    let ts = crate::devices::now_ts();
    let reaction = inner.store.toggle_reaction(message_id, &emoji, "operator", ts)?;

    drop(inner);

    store::broadcast_chat_reaction(&device_state, message_id, &emoji, "operator", &reaction)?;

    let result = ChatReactionResult {
        message_id,
        emoji: emoji.clone(),
        sender_id: "operator".to_string(),
        reaction: reaction.clone(),
    };

    let _ = app.emit(
        "chat_reaction",
        json!({
            "message_id": message_id,
            "emoji": emoji,
            "sender_id": "operator",
            "reaction": reaction,
        }),
    );

    Ok(result)
}

/// Tauri command: broadcasts a typing indicator for the operator.
///
/// Sends the indicator to WebSocket sessions with the `chat` permission and
/// emits `chat_typing` to the desktop webview. When the chat is disabled the
/// command silently succeeds without broadcasting anything.
///
/// # Examples
///
/// ```js
/// await invoke("send_chat_typing", { isTyping: true });
/// ```
#[tauri::command]
pub async fn send_chat_typing(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    is_typing: bool,
) -> Result<(), String> {
    let inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Ok(());
    }

    drop(inner);

    let name = desktop_name(&app);

    store::broadcast_chat_typing(&device_state, "operator", &name, is_typing)?;

    let _ = app.emit("chat_typing", serde_json::json!({
        "sender_id": "operator",
        "sender_name": name,
        "is_typing": is_typing,
    }));

    Ok(())
}


