use std::collections::VecDeque;
use std::path::PathBuf;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::devices::{DeviceState, is_permission_allowed};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFile {
    pub file_name: String,
    pub file_path: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reaction {
    pub emoji: String,
    pub sender_id: String,
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyRef {
    pub id: u64,
    pub sender_name: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<ChatFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: u64,
    pub sender_id: String,
    pub sender_type: String,
    pub sender_name: String,
    pub text: String,
    pub ts: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<ChatFile>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub reactions: Vec<Reaction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<ReplyRef>,
    #[serde(skip)]
    pub reply_to_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatConfig {
    pub enabled: bool,
    pub persist_enabled: bool,
    pub history_limit: u32,
}

impl Default for ChatConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            persist_enabled: false,
            history_limit: 200,
        }
    }
}

pub const MAX_MESSAGE_LENGTH: usize = 4000;
pub const MAX_FILE_SIZE: u64 = 25 * 1024 * 1024; // 25 MB

fn open_db(db_path: &PathBuf) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|e| e.to_string())
}

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
            _ => {}
        }
    }

    Ok(config)
}

pub fn save_config(conn: &Connection, config: &ChatConfig) -> Result<(), String> {
    let entries = [
        ("enabled", if config.enabled { "1" } else { "0" }),
        (
            "persist_enabled",
            if config.persist_enabled { "1" } else { "0" },
        ),
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

pub struct ChatStore {
    messages: VecDeque<ChatMessage>,
    next_id: u64,
    history_limit: usize,
    persist_enabled: bool,
    db_path: PathBuf,
    files_dir: PathBuf,
}

impl ChatStore {
    pub fn new(
        history_limit: u32,
        persist_enabled: bool,
        db_path: PathBuf,
        files_dir: PathBuf,
    ) -> Self {
        Self {
            messages: VecDeque::new(),
            next_id: 1,
            history_limit: history_limit as usize,
            persist_enabled,
            db_path,
            files_dir,
        }
    }

    pub fn set_persist_enabled(&mut self, enabled: bool) {
        self.persist_enabled = enabled;
    }

    pub fn set_history_limit(&mut self, limit: u32) {
        self.history_limit = limit as usize;
        while self.messages.len() > self.history_limit {
            self.messages.pop_front();
        }
    }

    pub fn load_from_disk(&mut self) -> Result<(), String> {
        if !self.persist_enabled {
            self.clear_today()?;
            return Ok(());
        }

        let conn = open_db(&self.db_path)?;
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
        for row in rows {
            let mut msg = row.map_err(|e| e.to_string())?;
            msg.reactions = load_reactions_for_message(&conn, msg.id)?;

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

            loaded.push_front(msg);
        }

        if let Some(max) = loaded.iter().map(|m| m.id).max() {
            self.next_id = max + 1;
        }

        self.messages = loaded;
        Ok(())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        let conn = open_db(&self.db_path)?;
        conn.execute("DELETE FROM chat_messages", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chat_reactions", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_message(&mut self, message_id: u64) -> Result<(), String> {
        self.messages.retain(|m| m.id != message_id);

        let conn = open_db(&self.db_path)?;
        conn.execute(
            "DELETE FROM chat_reactions WHERE message_id = ?1",
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

    pub fn clear_today(&self) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let today_start = now - (now % 86400);

        let conn = open_db(&self.db_path)?;
        conn.execute(
            "DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE created_at >= ?1)",
            params![today_start],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM chat_messages WHERE created_at >= ?1",
            params![today_start],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_messages(&self, limit: Option<u32>) -> Vec<ChatMessage> {
        let n = limit
            .map(|l| l as usize)
            .unwrap_or(self.messages.len());
        self.messages.iter().rev().take(n).cloned().collect()
    }

    pub fn find_message(&self, id: u64) -> Option<&ChatMessage> {
        self.messages.iter().find(|m| m.id == id)
    }

    pub fn push(&mut self, mut msg: ChatMessage) -> ChatMessage {
        msg.reactions = Vec::new();

        if self.messages.len() >= self.history_limit {
            self.messages.pop_front();
        }

        if self.persist_enabled {
            match self.persist_message(&msg) {
                Ok(id) => msg.id = id,
                Err(e) => {
                    eprintln!("chat persist error: {}", e);
                    msg.id = self.next_id;
                    self.next_id += 1;
                }
            }
        } else {
            msg.id = self.next_id;
            self.next_id += 1;
        }

        self.messages.push_back(msg.clone());
        msg
    }

    fn persist_message(&self, msg: &ChatMessage) -> Result<u64, String> {
        let conn = open_db(&self.db_path)?;
        conn.execute(
            "INSERT INTO chat_messages
             (sender_id, sender_type, sender_name, text, created_at, file_name, file_path, file_size, reply_to_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
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
        Ok(conn.last_insert_rowid() as u64)
    }

    pub fn save_file(&self, file_name: &str, data: &[u8]) -> Result<ChatFile, String> {
        if data.len() as u64 > MAX_FILE_SIZE {
            return Err(format!(
                "file_too_large:{}:{}",
                data.len(),
                MAX_FILE_SIZE
            ));
        }

        std::fs::create_dir_all(&self.files_dir).map_err(|e| e.to_string())?;

        let ext = std::path::Path::new(file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let stored_name = if ext.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            format!("{}.{}", Uuid::new_v4(), ext)
        };

        let dest = self.files_dir.join(&stored_name);
        std::fs::write(&dest, data).map_err(|e| e.to_string())?;

        Ok(ChatFile {
            file_name: file_name.to_string(),
            file_path: dest.to_string_lossy().to_string(),
            file_size: data.len() as u64,
        })
    }

    pub fn toggle_reaction(
        &mut self,
        message_id: u64,
        emoji: &str,
        sender_id: &str,
        ts: u64,
    ) -> Result<Option<Reaction>, String> {
        let conn = open_db(&self.db_path)?;

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

fn load_reactions_for_message(conn: &Connection, message_id: u64) -> Result<Vec<Reaction>, String> {
    let mut stmt = conn
        .prepare("SELECT emoji, sender_id, created_at FROM chat_reactions WHERE message_id = ?1")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![message_id], |row| {
            Ok(Reaction {
                emoji: row.get(0)?,
                sender_id: row.get(1)?,
                ts: row.get::<_, u64>(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut reactions = Vec::new();
    for row in rows {
        reactions.push(row.map_err(|e| e.to_string())?);
    }
    Ok(reactions)
}

pub fn broadcast_chat_message(
    state: &DeviceState,
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
            continue;
        }
        if let Some(sender) = &session.sender {
            let _ = sender.send(payload.clone());
        }
    }

    Ok(())
}

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

pub fn validate_message_text(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("empty_message".to_string());
    }
    if trimmed.len() > MAX_MESSAGE_LENGTH {
        return Err(format!(
            "message_too_long:{}:{}",
            trimmed.len(),
            MAX_MESSAGE_LENGTH
        ));
    }
    Ok(trimmed.to_string())
}

pub fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("invalid_base64:{}", e))
}
