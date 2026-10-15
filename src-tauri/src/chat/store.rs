//! Chat persistence, validation, and WebSocket broadcast helpers.
//!
//! This module backs the live chat system with:
//!
//! * **Domain types** serialized to the frontend and over WebSocket —
//!   [`ChatMessage`], [`ChatFile`], [`Reaction`], [`ReplyRef`],
//!   [`ChatConfig`].
//! * **Persistence** — [`ChatStore`] keeps a bounded in-memory history and,
//!   when enabled, mirrors it to SQLite (tables created by
//!   [`ensure_tables`], settings read/written by [`load_config`] /
//!   [`save_config`]).
//! * **Fan-out** — the `broadcast_*` functions push JSON events to every
//!   WebSocket session that holds the `chat` permission, while
//!   [`send_chat_history`] and [`send_chat_error`] target a single session.
//! * **Validation** — [`validate_message_text`] and [`ChatStore::save_file`]
//!   enforce size, type, and content limits.
//!
//! All fallible functions return `Result<_, String>` with short, stable
//! error codes (e.g. `"empty_message"`, `"file_too_large"`) that the
//! frontend maps to user-facing messages.

use std::collections::VecDeque;
use std::path::PathBuf;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::devices::{DeviceState, is_permission_allowed};

/// A file attachment referenced by a chat message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFile {
    /// Original file name chosen by the sender, used for display and for
    /// extension checks.
    pub file_name: String,
    /// Absolute path where the file was stored on disk.
    pub file_path: String,
    /// Size of the file in bytes.
    pub file_size: u64,
}

/// A single emoji reaction added by one sender to a message.
///
/// Reactions are unique per `(message_id, emoji, sender_id)` in the
/// database, so toggling simply adds or removes this record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reaction {
    /// The emoji used for the reaction.
    pub emoji: String,
    /// Id of the sender that reacted (e.g. `"operator"` or a device id).
    pub sender_id: String,
    /// Unix timestamp (seconds) of when the reaction was added.
    pub ts: u64,
}

/// Snapshot of the message being replied to, embedded in [`ChatMessage::reply_to`].
///
/// Duplicating the sender name and text lets clients render the quote
/// without an extra lookup, and lets replies outlive deletion of the
/// original message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyRef {
    /// Id of the message being replied to.
    pub id: u64,
    /// Display name of the replied-to message's sender.
    pub sender_name: String,
    /// Text of the replied-to message.
    pub text: String,
    /// Attachment of the replied-to message, if it had one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<ChatFile>,
}

/// A chat message as stored in memory and exchanged with clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Stable message id, assigned by [`ChatStore::push`]. Ids are
    /// sequential and monotonic while the app runs.
    pub id: u64,
    /// Id of the sender (`"operator"` for the desktop, a device id for
    /// remote clients).
    pub sender_id: String,
    /// Role of the sender, e.g. `"operator"` or `"guest"`.
    pub sender_type: String,
    /// Human-readable sender name shown in the UI.
    pub sender_name: String,
    /// Message body, already trimmed and validated by
    /// [`validate_message_text`].
    pub text: String,
    /// Unix timestamp (seconds) of when the message was sent.
    pub ts: u64,
    /// Attachment carried by this message, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<ChatFile>,
    /// Reactions currently on this message. Emptied on insert; reactions are
    /// managed separately via [`ChatStore::toggle_reaction`].
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub reactions: Vec<Reaction>,
    /// Resolved quote of the replied-to message, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<ReplyRef>,
    /// Raw id of the replied-to message.
    ///
    /// Serialized output is skipped: clients receive the resolved
    /// [`ChatMessage::reply_to`] snapshot instead. Persisted to SQLite so
    /// replies can be rehydrated by [`ChatStore::load_from_disk`].
    #[serde(skip)]
    pub reply_to_id: Option<u64>,
}

/// User-configurable chat settings, persisted in the `chat_settings` table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatConfig {
    /// Whether the chat is usable at all; commands reject input while `false`.
    pub enabled: bool,
    /// Whether history is mirrored to SQLite and restored on startup.
    pub persist_enabled: bool,
    /// Maximum number of messages retained in memory (and on disk).
    pub history_limit: u32,
    /// Notification style requested by the operator, e.g. `"toast"`.
    #[serde(default = "default_notification_mode")]
    pub notification_mode: String,
}

fn default_notification_mode() -> String {
    "toast".to_string()
}

impl Default for ChatConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            persist_enabled: false,
            history_limit: 200,
            notification_mode: "toast".to_string(),
        }
    }
}

/// Maximum accepted length in bytes for a single chat message.
///
/// Enforced by [`validate_message_text`].
pub const MAX_MESSAGE_LENGTH: usize = 4000;
/// Maximum accepted size in bytes for a chat file attachment (25 MB).
///
/// Enforced by [`ChatStore::save_file`].
pub const MAX_FILE_SIZE: u64 = 25 * 1024 * 1024; // 25 MB

const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "msi", "scr", "pif", "ps1", "psm1", "vbs", "vbe",
    "js", "jse", "wsf", "wsh", "hta", "cpl", "lnk", "inf", "reg", "rgs",
];

/// Creates the chat tables (`chat_settings`, `chat_messages`,
/// `chat_reactions`) if they do not exist yet.
///
/// Also performs a lightweight migration: adds the `reply_to_id` column to
/// `chat_messages` when upgrading from an older database. Safe to call on
/// every startup.
///
/// # Errors
///
/// Returns a SQLite error string when table creation or the column check
/// fails.
pub fn ensure_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id TEXT NOT NULL,
            sender_type TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            file_name TEXT,
            file_path TEXT,
            file_size INTEGER,
            reply_to_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS chat_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(message_id, emoji, sender_id)
        );",
    )
    .map_err(|e| e.to_string())?;

    let has_reply_col: bool = conn
        .prepare("PRAGMA table_info(chat_messages)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .any(|name| name == "reply_to_id");

    if !has_reply_col {
        conn.execute("ALTER TABLE chat_messages ADD COLUMN reply_to_id INTEGER", [])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Reads the chat settings from the `chat_settings` table.
///
/// Starts from [`ChatConfig::default`] and overlays any recognized keys, so
/// a fresh or partially populated database still yields a valid config.
/// Unknown keys are ignored and an unparseable `history_limit` falls back to
/// the default of `200`.
///
/// # Errors
///
/// Returns a SQLite error string when the settings cannot be queried.
pub fn load_config(conn: &Connection) -> Result<ChatConfig, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM chat_settings")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut config = ChatConfig::default();
    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        match key.as_str() {
            "enabled" => config.enabled = value == "1",
            "persist_enabled" => config.persist_enabled = value == "1",
            "history_limit" => {
                config.history_limit = value.parse().unwrap_or(200);
            }
            "notification_mode" => {
                config.notification_mode = value.clone();
            }
            _ => {}
        }
    }

    Ok(config)
}

/// Writes the chat settings to the `chat_settings` table.
///
/// Stores `enabled`, `persist_enabled`, `notification_mode`, and
/// `history_limit` as key/value rows using `INSERT OR REPLACE`, so existing
/// rows are updated in place.
///
/// # Errors
///
/// Returns a SQLite error string when any row cannot be written.
pub fn save_config(conn: &Connection, config: &ChatConfig) -> Result<(), String> {
    let entries = [
        ("enabled", if config.enabled { "1" } else { "0" }),
        (
            "persist_enabled",
            if config.persist_enabled { "1" } else { "0" },
        ),
        ("notification_mode", &config.notification_mode),
    ];

    for (key, value) in &entries {
        conn.execute(
            "INSERT OR REPLACE INTO chat_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO chat_settings (key, value) VALUES (?1, ?2)",
        params!["history_limit", config.history_limit.to_string()],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Bounded in-memory chat history backed by an optional SQLite mirror.
///
/// The store owns:
///
/// * a [`VecDeque`] of the most recent [`ChatMessage`]s, capped at
///   `history_limit` (oldest messages are trimmed first);
/// * the next message id counter, kept monotonic across restarts;
/// * an open SQLite connection used for persistence and reactions;
/// * the directory where attachments are written by
///   [`ChatStore::save_file`].
///
/// Created by [`crate::chat::initialize_chat_state`] and shared through
/// [`crate::chat::ChatState`].
pub struct ChatStore {
    messages: VecDeque<ChatMessage>,
    next_id: u64,
    history_limit: usize,
    persist_enabled: bool,
    conn: Connection,
    files_dir: PathBuf,
}

impl ChatStore {
    /// Creates an empty store bound to the given database and files
    /// directory.
    ///
    /// The database connection is opened eagerly; tables are expected to
    /// already exist (see [`ensure_tables`]). Call
    /// [`ChatStore::load_from_disk`] afterwards to restore persisted
    /// history.
    ///
    /// # Panics
    ///
    /// Panics if the SQLite database at `db_path` cannot be opened.
    pub fn new(
        history_limit: u32,
        persist_enabled: bool,
        db_path: PathBuf,
        files_dir: PathBuf,
    ) -> Self {
        let conn = Connection::open(&db_path).expect("failed to open chat db");
        Self {
            messages: VecDeque::new(),
            next_id: 1,
            history_limit: history_limit as usize,
            persist_enabled,
            conn,
            files_dir,
        }
    }

    /// Enables or disables disk persistence.
    ///
    /// When turning persistence *on*, the in-memory id counter is rebased to
    /// continue after the highest id already present in the database, and
    /// SQLite's `AUTOINCREMENT` sequence is realigned so future ids never
    /// collide with restored history. Turning it *off* leaves existing rows
    /// untouched.
    pub fn set_persist_enabled(&mut self, enabled: bool) {
        if enabled && !self.persist_enabled {
            let max_db_id: u64 = self.conn
                .query_row(
                    "SELECT COALESCE(MAX(id), 0) FROM chat_messages",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            if self.next_id <= max_db_id {
                self.next_id = max_db_id + 1;
            }
            let _ = self.conn.execute(
                "DELETE FROM sqlite_sequence WHERE name = 'chat_messages'",
                [],
            );
            let _ = self.conn.execute(
                "INSERT INTO chat_messages (id, sender_id, sender_type, sender_name, text, created_at)
                 VALUES (?1, '_seq_rebase', '_', '_', '', 0)",
                params![self.next_id],
            );
            let _ = self.conn.execute(
                "DELETE FROM chat_messages WHERE sender_id = '_seq_rebase'",
                [],
            );
        }
        self.persist_enabled = enabled;
    }

    /// Changes the maximum number of retained messages.
    ///
    /// If the new limit is smaller than the current history, the oldest
    /// messages are trimmed immediately (deleting their files and database
    /// rows when persistence is enabled).
    pub fn set_history_limit(&mut self, limit: u32) {
        self.history_limit = limit as usize;
        while self.messages.len() > self.history_limit {
            self.trim_oldest();
        }
    }

    fn trim_oldest(&mut self) {
        let oldest = match self.messages.pop_front() {
            Some(m) => m,
            None => return,
        };

        if !self.persist_enabled {
            return;
        }

        if let Some(ref file) = oldest.file {
            let _ = std::fs::remove_file(&file.file_path);
        }

        let conn = &self.conn;
        let _ = conn.execute(
            "DELETE FROM chat_reactions WHERE message_id = ?1",
            params![oldest.id],
        );
        let _ = conn.execute(
            "DELETE FROM chat_messages WHERE id = ?1",
            params![oldest.id],
        );
    }

    /// Restores history from SQLite, or clears the tables when persistence
    /// is disabled.
    ///
    /// With persistence off, all stored rows are deleted and the in-memory
    /// history is left empty. With persistence on, the most recent
    /// `history_limit` messages are loaded oldest-first, their reactions are
    /// rehydrated in a single batch query, and reply targets are resolved
    /// into [`ReplyRef`] snapshots. The id counter is advanced past the
    /// highest restored id.
    ///
    /// # Errors
    ///
    /// Returns a SQLite error string when reading messages or reactions
    /// fails.
    pub fn load_from_disk(&mut self) -> Result<(), String> {
        if !self.persist_enabled {
            let conn = &self.conn;
            conn.execute("DELETE FROM chat_reactions", [])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM chat_messages", [])
                .map_err(|e| e.to_string())?;
            return Ok(());
        }

        let conn = &self.conn;
        let mut statement = conn
            .prepare(
                "SELECT id, sender_id, sender_type, sender_name, text, created_at,
                        file_name, file_path, file_size, reply_to_id
                 FROM chat_messages ORDER BY id DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;

        let rows = statement
            .query_map(params![self.history_limit as u64], |row| {
                let file_name: Option<String> = row.get(6)?;
                let file_path: Option<String> = row.get(7)?;
                let file_size: Option<u64> = row.get(8)?;
                let reply_to_id: Option<u64> = row.get(9)?;

                let file = if let (Some(name), Some(path), Some(size)) =
                    (file_name, file_path, file_size)
                {
                    Some(ChatFile {
                        file_name: name,
                        file_path: path,
                        file_size: size,
                    })
                } else {
                    None
                };

                Ok(ChatMessage {
                    id: row.get::<_, u64>(0)?,
                    sender_id: row.get(1)?,
                    sender_type: row.get(2)?,
                    sender_name: row.get(3)?,
                    text: row.get(4)?,
                    ts: row.get::<_, u64>(5)?,
                    file,
                    reactions: Vec::new(),
                    reply_to: None,
                    reply_to_id,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut loaded: VecDeque<ChatMessage> = VecDeque::new();
        let mut msg_ids: Vec<u64> = Vec::new();
        for row in rows {
            let msg = row.map_err(|e| e.to_string())?;
            msg_ids.push(msg.id);
            loaded.push_back(msg);
        }

        let mut all_reactions = load_reactions_batch(&conn, &msg_ids)?;
        for msg in loaded.iter_mut() {
            msg.reactions = all_reactions.remove(&msg.id).unwrap_or_default();
        }

        for msg in loaded.iter_mut() {
            if let Some(rid) = msg.reply_to_id {
                if let Ok(replied) = conn.query_row(
                    "SELECT sender_name, text, file_name, file_path, file_size FROM chat_messages WHERE id = ?1",
                    params![rid],
                    |row| {
                        let r_name: String = row.get(0)?;
                        let r_text: String = row.get(1)?;
                        let r_file_name: Option<String> = row.get(2)?;
                        let r_file_path: Option<String> = row.get(3)?;
                        let r_file_size: Option<u64> = row.get(4)?;
                        let r_file = if let (Some(n), Some(p), Some(s)) = (r_file_name, r_file_path, r_file_size) {
                            Some(ChatFile { file_name: n, file_path: p, file_size: s })
                        } else {
                            None
                        };
                        Ok(ReplyRef { id: rid, sender_name: r_name, text: r_text, file: r_file })
                    },
                ) {
                    msg.reply_to = Some(replied);
                }
            }
        }

        if let Some(max) = loaded.iter().map(|m| m.id).max() {
            self.next_id = max + 1;
        }

        self.messages = loaded;
        Ok(())
    }

    /// Removes all messages, attachments, and reactions.
    ///
    /// Empties the in-memory ring, deletes every attachment file referenced
    /// by a stored message, and truncates `chat_messages` and
    /// `chat_reactions`.
    ///
    /// # Errors
    ///
    /// Returns a SQLite error string when the delete statements fail.
    pub fn clear_history(&mut self) -> Result<(), String> {
        self.messages.clear();

        let conn = &self.conn;

        let files: Vec<String> = conn
            .prepare("SELECT file_path FROM chat_messages WHERE file_path IS NOT NULL")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for path in &files {
            let _ = std::fs::remove_file(path);
        }

        conn.execute("DELETE FROM chat_messages", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chat_reactions", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Deletes one message by id.
    ///
    /// Removes the message and its attachment from memory, clears its
    /// reactions, detaches any replies that referenced it (both in memory
    /// and in SQLite), and deletes its database row. Succeeds silently when
    /// `message_id` is not present.
    ///
    /// # Errors
    ///
    /// Returns a SQLite error string when the delete or update statements
    /// fail.
    pub fn delete_message(&mut self, message_id: u64) -> Result<(), String> {
        if let Some(msg) = self.messages.iter().find(|m| m.id == message_id) {
            if let Some(ref file) = msg.file {
                let _ = std::fs::remove_file(&file.file_path);
            }
        }

        self.messages.retain(|m| m.id != message_id);

        for m in self.messages.iter_mut() {
            if m.reply_to_id == Some(message_id) {
                m.reply_to_id = None;
                m.reply_to = None;
            }
        }

        let conn = &self.conn;
        conn.execute(
            "DELETE FROM chat_reactions WHERE message_id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE chat_messages SET reply_to_id = NULL WHERE reply_to_id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM chat_messages WHERE id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Returns a clone of the retained history, oldest message first.
    ///
    /// When `limit` is `Some(n)`, at most the last `n` messages are
    /// returned; `None` returns the entire retained history.
    pub fn get_messages(&self, limit: Option<u32>) -> Vec<ChatMessage> {
        let n = limit
            .map(|l| l as usize)
            .unwrap_or(self.messages.len());
        self.messages.iter().rev().take(n).cloned().rev().collect()
    }

    /// Finds a retained message by id.
    ///
    /// Returns `None` when the message was trimmed, deleted, or never
    /// existed.
    pub fn find_message(&self, id: u64) -> Option<&ChatMessage> {
        self.messages.iter().find(|m| m.id == id)
    }

    /// Appends a message to the history and returns the committed copy.
    ///
    /// Any reactions on the incoming message are discarded, the id and
    /// timestamp are (re)assigned, and the oldest message is trimmed when
    /// the history is full. When persistence is enabled the message is also
    /// written to SQLite; write failures are logged but do not fail the
    /// call.
    pub fn push(&mut self, mut msg: ChatMessage) -> ChatMessage {
        msg.reactions = Vec::new();

        if self.messages.len() >= self.history_limit {
            self.trim_oldest();
        }

        msg.id = self.next_id;
        self.next_id += 1;

        if self.persist_enabled {
            if let Err(e) = self.persist_message(&msg) {
                eprintln!("chat persist error: {}", e);
            }
        }

        self.messages.push_back(msg.clone());
        msg
    }

    fn persist_message(&self, msg: &ChatMessage) -> Result<(), String> {
        let conn = &self.conn;
        conn.execute(
            "INSERT INTO chat_messages
             (id, sender_id, sender_type, sender_name, text, created_at, file_name, file_path, file_size, reply_to_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                msg.id,
                msg.sender_id,
                msg.sender_type,
                msg.sender_name,
                msg.text,
                msg.ts,
                msg.file.as_ref().map(|f| &f.file_name),
                msg.file.as_ref().map(|f| &f.file_path),
                msg.file.as_ref().map(|f| f.file_size),
                msg.reply_to.as_ref().map(|r| r.id),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Stores an attachment on disk under the chat files directory.
    ///
    /// The stored file is renamed to `<uuid>.<ext>` to avoid collisions and
    /// path traversal; the original name is preserved in the returned
    /// [`ChatFile`]. The extension is lower-cased and checked against a
    /// blocklist of executable types.
    ///
    /// # Errors
    ///
    /// * `"file_too_large"` — `data` exceeds [`MAX_FILE_SIZE`].
    /// * `"blocked_file_type"` — the extension is considered unsafe.
    /// * `"file_save_error"` — the directory could not be created or the
    ///   file could not be written.
    pub fn save_file(&self, file_name: &str, data: &[u8]) -> Result<ChatFile, String> {
        if data.len() as u64 > MAX_FILE_SIZE {
            return Err("file_too_large".to_string());
        }

        let ext = std::path::Path::new(file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if BLOCKED_EXTENSIONS.contains(&ext.as_str()) {
            return Err("blocked_file_type".to_string());
        }

        std::fs::create_dir_all(&self.files_dir)
            .map_err(|_| "file_save_error".to_string())?;

        let stored_name = if ext.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            format!("{}.{}", Uuid::new_v4(), ext)
        };

        let dest = self.files_dir.join(&stored_name);
        std::fs::write(&dest, data)
            .map_err(|_| "file_save_error".to_string())?;

        Ok(ChatFile {
            file_name: file_name.to_string(),
            file_path: dest.to_string_lossy().to_string(),
            file_size: data.len() as u64,
        })
    }

    /// Adds or removes a reaction for `(message_id, emoji, sender_id)`.
    ///
    /// If the reaction already exists it is removed and `Ok(None)` is
    /// returned; otherwise it is inserted with timestamp `ts` and returned
    /// as `Ok(Some(reaction))`. The change is mirrored in both SQLite and
    /// the in-memory message.
    ///
    /// # Errors
    ///
    /// Returns `"message_not_found"` when `message_id` is not in the
    /// retained history, or a SQLite error string when the insert or delete
    /// fails.
    pub fn toggle_reaction(
        &mut self,
        message_id: u64,
        emoji: &str,
        sender_id: &str,
        ts: u64,
    ) -> Result<Option<Reaction>, String> {
        if self.messages.iter().find(|m| m.id == message_id).is_none() {
            return Err("message_not_found".to_string());
        }

        let conn = &self.conn;

        let existing = conn
            .query_row(
                "SELECT id FROM chat_reactions WHERE message_id = ?1 AND emoji = ?2 AND sender_id = ?3",
                params![message_id, emoji, sender_id],
                |row| row.get::<_, i64>(0),
            )
            .ok();

        if let Some(_id) = existing {
            conn.execute(
                "DELETE FROM chat_reactions WHERE message_id = ?1 AND emoji = ?2 AND sender_id = ?3",
                params![message_id, emoji, sender_id],
            )
            .map_err(|e| e.to_string())?;

            if let Some(msg) = self.messages.iter_mut().find(|m| m.id == message_id) {
                msg.reactions
                    .retain(|r| !(r.emoji == emoji && r.sender_id == sender_id));
            }

            return Ok(None);
        }

        conn.execute(
            "INSERT INTO chat_reactions (message_id, emoji, sender_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![message_id, emoji, sender_id, ts],
        )
        .map_err(|e| e.to_string())?;

        let reaction = Reaction {
            emoji: emoji.to_string(),
            sender_id: sender_id.to_string(),
            ts,
        };

        if let Some(msg) = self.messages.iter_mut().find(|m| m.id == message_id) {
            msg.reactions.push(reaction.clone());
        }

        Ok(Some(reaction))
    }
}

fn load_reactions_batch(conn: &Connection, message_ids: &[u64]) -> Result<std::collections::HashMap<u64, Vec<Reaction>>, String> {
    if message_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let placeholders: Vec<String> = message_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT message_id, emoji, sender_id, created_at FROM chat_reactions WHERE message_id IN ({})",
        placeholders.join(",")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<Box<dyn rusqlite::types::ToSql>> = message_ids
        .iter()
        .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, u64>(0)?,
                Reaction {
                    emoji: row.get(1)?,
                    sender_id: row.get(2)?,
                    ts: row.get::<_, u64>(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (msg_id, reaction) = row.map_err(|e| e.to_string())?;
        map.entry(msg_id).or_insert_with(Vec::new).push(reaction);
    }
    Ok(map)
}

/// Broadcasts a new message to every WebSocket session allowed to see chat.
///
/// The payload includes the resolved `file_url`
/// (`http://127.0.0.1:{file_server_port}/files/{name}`) so clients can load
/// attachments directly. Sessions without the `chat` permission, or without
/// a sender channel, are skipped.
///
/// # Errors
///
/// Returns an error string when the payload cannot be serialized or the
/// session registry lock is poisoned.
pub fn broadcast_chat_message(
    state: &DeviceState,
    message: &ChatMessage,
    file_server_port: u16,
) -> Result<(), String> {
    let file_url = message.file.as_ref().map(|f| {
        let filename = std::path::Path::new(&f.file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        format!("http://127.0.0.1:{}/files/{}", file_server_port, filename)
    });

    let payload = serde_json::to_string(&json!({
        "event": "chat_message",
        "message": {
            "id": message.id,
            "sender_id": message.sender_id,
            "sender_type": message.sender_type,
            "sender_name": message.sender_name,
            "text": message.text,
            "ts": message.ts,
            "file": message.file.as_ref().map(|f| {
                json!({
                    "file_name": f.file_name,
                    "file_path": f.file_path,
                    "file_size": f.file_size,
                    "file_url": file_url,
                })
            }),
            "reactions": message.reactions,
            "reply_to": message.reply_to,
        }
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session in sessions.values() {
        if !is_permission_allowed(&session.permissions, "chat") {
            continue;
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone());
        }
    }

    Ok(())
}

/// Broadcasts the current `enabled` state to every WebSocket session
/// allowed to see chat.
///
/// # Errors
///
/// Returns an error string when the payload cannot be serialized or the
/// session registry lock is poisoned.
pub fn broadcast_chat_config(
    state: &DeviceState,
    config: &ChatConfig,
) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_config_changed",
        "enabled": config.enabled,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session in sessions.values() {
        if !is_permission_allowed(&session.permissions, "chat") {
            continue;
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone());
        }
    }

    Ok(())
}

/// Broadcasts a reaction toggle to every WebSocket session allowed to see
/// chat.
///
/// `reaction` is `Some` when the reaction was added and `None` when it was
/// removed.
///
/// # Errors
///
/// Returns an error string when the payload cannot be serialized or the
/// session registry lock is poisoned.
pub fn broadcast_chat_reaction(
    state: &DeviceState,
    message_id: u64,
    emoji: &str,
    sender_id: &str,
    reaction: &Option<Reaction>,
) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_reaction",
        "message_id": message_id,
        "emoji": emoji,
        "sender_id": sender_id,
        "reaction": reaction,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session in sessions.values() {
        if !is_permission_allowed(&session.permissions, "chat") {
            continue;
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone());
        }
    }

    Ok(())
}

/// Broadcasts a typing indicator to every WebSocket session allowed to see
/// chat.
///
/// # Errors
///
/// Returns an error string when the payload cannot be serialized or the
/// session registry lock is poisoned.
pub fn broadcast_chat_typing(
    state: &DeviceState,
    sender_id: &str,
    sender_name: &str,
    is_typing: bool,
) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_typing",
        "sender_id": sender_id,
        "sender_name": sender_name,
        "is_typing": is_typing,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session in sessions.values() {
        if !is_permission_allowed(&session.permissions, "chat") {
            continue;
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone());
        }
    }

    Ok(())
}

/// Broadcasts a message deletion to every WebSocket session allowed to see
/// chat.
///
/// # Errors
///
/// Returns an error string when the payload cannot be serialized or the
/// session registry lock is poisoned.
pub fn broadcast_chat_delete(state: &DeviceState, message_id: u64) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_deleted",
        "message_id": message_id,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    for session in sessions.values() {
        if !is_permission_allowed(&session.permissions, "chat") {
            continue;
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone());
        }
    }

    Ok(())
}

/// Sends the current chat history to a single WebSocket session.
///
/// Used when a remote device joins and is granted the `chat` permission.
///
/// # Errors
///
/// Returns an error string when the history cannot be serialized.
pub fn send_chat_history(
    sender: &UnboundedSender<Message>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_history",
        "messages": messages,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let _ = sender.send(payload);
    Ok(())
}

/// Sends a chat error reason (e.g. a rejected send) to a single WebSocket
/// session.
///
/// # Errors
///
/// Returns an error string when the payload cannot be serialized.
pub fn send_chat_error(
    sender: &UnboundedSender<Message>,
    reason: &str,
) -> Result<(), String> {
    let payload = serde_json::to_string(&json!({
        "event": "chat_error",
        "reason": reason,
    }))
    .map(Message::Text)
    .map_err(|e| e.to_string())?;

    let _ = sender.send(payload);
    Ok(())
}

/// Trims and validates a chat message body.
///
/// Returns the trimmed text on success.
///
/// # Errors
///
/// * `"empty_message"` — the text is empty or whitespace only.
/// * `"message_too_long"` — the trimmed text exceeds
///   [`MAX_MESSAGE_LENGTH`].
pub fn validate_message_text(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("empty_message".to_string());
    }
    if trimmed.len() > MAX_MESSAGE_LENGTH {
        return Err("message_too_long".to_string());
    }
    Ok(trimmed.to_string())
}

/// Decodes a standard (padded) base64 string into raw bytes.
///
/// Used when remote clients upload attachments inline.
///
/// # Errors
///
/// Returns `"invalid_file"` when `data` is not valid base64.
pub fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "invalid_file".to_string())
}
