pub mod store;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use store::{ChatConfig, ChatMessage, ChatStore, Reaction};

use crate::devices::DeviceState;

#[derive(Clone)]
pub struct ChatState {
    pub inner: Arc<Mutex<ChatStateInner>>,
}

pub struct ChatStateInner {
    pub config: ChatConfig,
    pub store: ChatStore,
    db_path: PathBuf,
}

fn app_base_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe
        .parent()
        .ok_or_else(|| "Could not resolve executable directory".to_string())?;
    Ok(parent.join("lumen"))
}

fn chat_db_path() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("lumen.db"))
}

fn chat_files_dir() -> Result<PathBuf, String> {
    Ok(app_base_dir()?.join("files").join("media").join("files"))
}

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
        files_dir,
    );
    chat_store.load_from_disk()?;

    Ok(ChatState {
        inner: Arc::new(Mutex::new(ChatStateInner {
            config,
            store: chat_store,
            db_path,
        })),
    })
}

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    text: String,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Err("chat_disabled".to_string());
    }

    let clean_text = store::validate_message_text(&text)?;

    let desktop_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Lumen Desktop".to_string());

    let msg = ChatMessage {
        id: 0,
        sender_id: "operator".to_string(),
        sender_type: "operator".to_string(),
        sender_name: desktop_name,
        text: clean_text,
        ts: crate::devices::now_ts(),
        file: None,
        reactions: Vec::new(),
    };

    let committed = inner.store.push(msg);

    drop(inner);

    store::broadcast_chat_message(&device_state, &committed)?;

    let _ = app.emit("chat_message", committed);

    Ok(())
}

#[tauri::command]
pub async fn send_chat_file(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    file_path: String,
    text: Option<String>,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Err("chat_disabled".to_string());
    }

    let data = std::fs::read(&file_path).map_err(|e| format!("read_file:{}", e))?;

    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let chat_file = inner.store.save_file(&file_name, &data)?;

    let desktop_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Lumen Desktop".to_string());

    let msg = ChatMessage {
        id: 0,
        sender_id: "operator".to_string(),
        sender_type: "operator".to_string(),
        sender_name: desktop_name,
        text: text.unwrap_or_default(),
        ts: crate::devices::now_ts(),
        file: Some(chat_file),
        reactions: Vec::new(),
    };

    let committed = inner.store.push(msg);

    drop(inner);

    store::broadcast_chat_message(&device_state, &committed)?;

    let _ = app.emit("chat_message", committed);

    Ok(())
}

#[tauri::command]
pub async fn get_chat_messages(
    chat: State<'_, ChatState>,
    limit: Option<u32>,
) -> Result<Vec<ChatMessage>, String> {
    let inner = chat.inner.lock().await;
    Ok(inner.store.get_messages(limit))
}

#[tauri::command]
pub async fn get_chat_config(chat: State<'_, ChatState>) -> Result<ChatConfig, String> {
    let inner = chat.inner.lock().await;
    Ok(inner.config.clone())
}

#[tauri::command]
pub async fn set_chat_config(
    app: AppHandle,
    chat: State<'_, ChatState>,
    config: ChatConfig,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;

    if inner.config.persist_enabled != config.persist_enabled {
        inner.store.set_persist_enabled(config.persist_enabled);
    }

    if inner.config.history_limit != config.history_limit {
        inner.store.set_history_limit(config.history_limit);
    }

    inner.config = config.clone();

    let conn = rusqlite::Connection::open(&inner.db_path).map_err(|e| e.to_string())?;
    store::save_config(&conn, &config)?;

    let _ = app.emit("chat_config_changed", config);

    Ok(())
}

#[tauri::command]
pub async fn clear_chat_history(chat: State<'_, ChatState>) -> Result<(), String> {
    let inner = chat.inner.lock().await;
    inner.store.clear_history()
}

#[tauri::command]
pub async fn send_chat_reaction(
    app: AppHandle,
    chat: State<'_, ChatState>,
    device_state: State<'_, DeviceState>,
    message_id: u64,
    emoji: String,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Err("chat_disabled".to_string());
    }

    let ts = crate::devices::now_ts();
    let reaction = inner.store.toggle_reaction(message_id, &emoji, "operator", ts)?;

    drop(inner);

    store::broadcast_chat_reaction(&device_state, message_id, &emoji, "operator", &reaction)?;

    Ok(())
}

pub async fn send_system_message(
    app: &AppHandle,
    chat: &ChatState,
    device_state: &DeviceState,
    text: String,
) -> Result<(), String> {
    let mut inner = chat.inner.lock().await;

    if !inner.config.enabled {
        return Ok(());
    }

    let msg = ChatMessage {
        id: 0,
        sender_id: "system".to_string(),
        sender_type: "system".to_string(),
        sender_name: "Lumen".to_string(),
        text,
        ts: crate::devices::now_ts(),
        file: None,
        reactions: Vec::new(),
    };

    let committed = inner.store.push(msg);

    drop(inner);

    store::broadcast_chat_message(device_state, &committed)?;

    let _ = app.emit("chat_message", committed);

    Ok(())
}

pub fn setup_system_listeners(app: &AppHandle, chat: ChatState) {
    let app_handle = app.clone();

    {
        let chat = chat.clone();
        let app = app_handle.clone();
        app.listen("playback-started", move |event| {
            let payload = event.payload();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                let title = value
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown");
                let artist = value.get("artist").and_then(|v| v.as_str()).unwrap_or("");

                let text = if artist.is_empty() {
                    format!("Now playing: **{}**", title)
                } else {
                    format!("Now playing: **{}** — {}", title, artist)
                };

                let chat = chat.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let device_state = app.state::<DeviceState>();
                    let _ = send_system_message(&app, &chat, &device_state, text).await;
                });
            }
        });
    }

    {
        let chat = chat.clone();
        let app = app_handle.clone();
        app.listen("queue-item-added", move |event| {
            let payload = event.payload();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                let title = value
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown");
                let added_by = value
                    .get("added_by")
                    .and_then(|v| v.as_str())
                    .unwrap_or("someone");

                let text = format!("{} added **{}** to the queue", added_by, title);

                let chat = chat.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let device_state = app.state::<DeviceState>();
                    let _ = send_system_message(&app, &chat, &device_state, text).await;
                });
            }
        });
    }
}
