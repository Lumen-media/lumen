use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

use crate::remote;
use crate::url_media::{canonicalize_youtube_url, resolve_youtube};

const QUEUE_TABLE: &str = "CREATE TABLE IF NOT EXISTS queue (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        position         INTEGER NOT NULL DEFAULT 0,
        file_path        TEXT    NOT NULL,
        file_name        TEXT    NOT NULL,
        file_size        INTEGER NOT NULL DEFAULT 0,
        file_modified_at INTEGER NOT NULL DEFAULT 0,
        file_extension   TEXT    NOT NULL DEFAULT '',
        played           INTEGER NOT NULL DEFAULT 0,
        duration         REAL,
        title            TEXT,
        artist           TEXT
      )";

/// Raw queue row (one per DB record), serialized with camelCase field names.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRow {
    pub id: i64,
    pub position: i64,
    pub file_path: String,
    pub file_name: String,
    pub file_size: i64,
    pub file_modified_at: i64,
    pub file_extension: String,
    pub played: i64,
    pub duration: Option<f64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
    pub download_status: Option<String>,
}

/// A queue item in its final shape (`modified_at` in epoch ms).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified_at: i64,
    pub extension: String,
    pub played: bool,
    pub duration: Option<f64>,
    pub title: String,
    pub artist: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
    pub download_status: String,
}

/// Serialized `FileInfo` used when inserting a file into the queue.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueFileInput {
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified_at: i64,
    pub extension: String,
    pub duration: Option<f64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
    pub download_status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueMetadataUpdate {
    pub duration: Option<f64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdPositionUpdate {
    pub id: i64,
    pub position: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPositionUpdate {
    pub path: String,
    pub position: i64,
}

pub struct QueueStore {
    conn: Mutex<Connection>,
}

pub fn initialize_queue_store() -> Result<QueueStore, String> {
    let db_path = remote::app_base_dir()?.join("lumen.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(QUEUE_TABLE).map_err(|e| e.to_string())?;
    ensure_queue_columns(&conn)?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_queue_original_url ON queue (original_url)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(QueueStore {
        conn: Mutex::new(conn),
    })
}

fn ensure_queue_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(queue)")
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let has = |name: &str| names.iter().any(|n| n == name);

    if !has("original_url") {
        conn.execute_batch("ALTER TABLE queue ADD COLUMN original_url TEXT")
            .map_err(|e| e.to_string())?;
    }
    if !has("thumbnail_path") {
        conn.execute_batch("ALTER TABLE queue ADD COLUMN thumbnail_path TEXT")
            .map_err(|e| e.to_string())?;
    }
    if !has("remote_thumbnail_url") {
        conn.execute_batch("ALTER TABLE queue ADD COLUMN remote_thumbnail_url TEXT")
            .map_err(|e| e.to_string())?;
    }
    if !has("download_status") {
        conn.execute_batch(
            "ALTER TABLE queue ADD COLUMN download_status TEXT NOT NULL DEFAULT 'downloaded'",
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn row_from_queue(row: &Row<'_>) -> rusqlite::Result<QueueRow> {
    Ok(QueueRow {
        id: row.get(0)?,
        position: row.get(1)?,
        file_path: row.get(2)?,
        file_name: row.get(3)?,
        file_size: row.get(4)?,
        file_modified_at: row.get(5)?,
        file_extension: row.get(6)?,
        played: row.get(7)?,
        duration: row.get(8)?,
        title: row.get(9)?,
        artist: row.get(10)?,
        original_url: row.get(11)?,
        thumbnail_path: row.get(12)?,
        remote_thumbnail_url: row.get(13)?,
        download_status: row.get(14)?,
    })
}

impl QueueRow {
    fn into_item(self) -> QueueItem {
        let default_status = if self.file_extension == "url" {
            "not_downloaded"
        } else {
            "downloaded"
        };
        let download_status = match self.download_status.as_deref() {
            Some("not_downloaded") | Some("downloaded") | Some("missing") => {
                self.download_status.clone().unwrap()
            }
            _ => default_status.to_string(),
        };
        let file_name = self.file_name.clone();
        let name = self.title.clone().unwrap_or_else(|| file_name.clone());
        let title = self.title.unwrap_or(file_name);
        QueueItem {
            id: self.id,
            name,
            path: self.file_path,
            size: self.file_size,
            modified_at: self.file_modified_at,
            extension: self.file_extension,
            played: self.played == 1,
            duration: self.duration,
            title,
            artist: self.artist,
            original_url: self.original_url,
            thumbnail_path: self.thumbnail_path,
            remote_thumbnail_url: self.remote_thumbnail_url,
            download_status,
        }
    }
}

fn load_rows(conn: &Connection) -> Result<Vec<QueueRow>, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM queue ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_from_queue)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn load_rows_where(conn: &Connection, sql: &str) -> Result<Vec<QueueRow>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_from_queue)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn next_position(conn: &Connection) -> Result<i64, String> {
    let max: Option<i64> = conn
        .query_row("SELECT MAX(position) FROM queue", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(max.unwrap_or(-1) + 1)
}

fn prev_position(conn: &Connection) -> Result<i64, String> {
    let min: Option<i64> = conn
        .query_row("SELECT MIN(position) FROM queue", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(min.unwrap_or(1) - 1)
}

fn insert_at_position(conn: &Connection, file: &QueueFileInput, position: i64) -> Result<i64, String> {
    let file_name = file.title.clone().unwrap_or_else(|| file.name.clone());
    let download_status = file.download_status.clone().unwrap_or_else(|| {
        if file.extension == "url" {
            "not_downloaded".to_string()
        } else {
            "downloaded".to_string()
        }
    });

    conn.execute(
        "INSERT INTO queue (position, file_path, file_name, file_size, file_modified_at, file_extension, duration, title, artist, original_url, thumbnail_path, remote_thumbnail_url, download_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            position,
            file.path,
            file_name,
            file.size,
            file.modified_at,
            file.extension,
            file.duration,
            file.title,
            file.artist,
            file.original_url,
            file.thumbnail_path,
            file.remote_thumbnail_url,
            download_status
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

fn shuffle<T>(slice: &mut [T]) {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15);
    let mut state = seed;
    for i in (1..slice.len()).rev() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let j = (state % (i as u64 + 1)) as usize;
        slice.swap(i, j);
    }
}

#[tauri::command]
pub async fn queue_load(store: State<'_, QueueStore>) -> Result<Vec<QueueItem>, String> {
    let conn = store.conn.lock().await;
    load_rows(&conn).map(|rows| rows.into_iter().map(QueueRow::into_item).collect())
}

#[tauri::command]
pub async fn queue_load_rows(store: State<'_, QueueStore>) -> Result<Vec<QueueRow>, String> {
    let conn = store.conn.lock().await;
    load_rows(&conn)
}

#[tauri::command]
pub async fn queue_load_trigger_entries(
    store: State<'_, QueueStore>,
) -> Result<Vec<QueueRow>, String> {
    let conn = store.conn.lock().await;
    load_rows_where(&conn, "SELECT * FROM queue WHERE file_path LIKE 'trigger://%' ORDER BY position ASC")
}

#[tauri::command]
pub async fn queue_add_trigger_entry(
    store: State<'_, QueueStore>,
    entry_id: String,
    trigger_id: String,
    config_json: String,
    title: String,
    tag: String,
) -> Result<i64, String> {
    let conn = store.conn.lock().await;
    let file_path = format!("trigger://{entry_id}");
    let existing = conn
        .query_row(
            "SELECT id FROM queue WHERE file_path = ?1",
            params![file_path],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Ok(id);
    }

    let position = next_position(&conn)?;
    conn.execute(
        "INSERT INTO queue (position, file_path, file_name, file_size, file_modified_at, file_extension, played, title, artist, original_url, download_status)
         VALUES (?1, ?2, ?3, 0, 0, '', 0, ?4, ?5, ?6, 'downloaded')",
        params![position, file_path, trigger_id, title, tag, config_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn queue_remove_trigger_entry(
    store: State<'_, QueueStore>,
    entry_id: String,
) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute(
        "DELETE FROM queue WHERE file_path = ?1",
        params![format!("trigger://{entry_id}")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_toggle_trigger_played(
    store: State<'_, QueueStore>,
    entry_id: String,
) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute(
        "UPDATE queue SET played = CASE WHEN played = 0 THEN 1 ELSE 0 END WHERE file_path = ?1",
        params![format!("trigger://{entry_id}")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_exists(
    store: State<'_, QueueStore>,
    file_path: String,
) -> Result<bool, String> {
    let conn = store.conn.lock().await;
    let source_url = canonicalize_youtube_url(&file_path);
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM queue WHERE file_path = ?1 OR original_url = ?2",
            params![source_url, source_url],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

#[tauri::command]
pub async fn queue_add_to_queue(
    store: State<'_, QueueStore>,
    file: QueueFileInput,
) -> Result<i64, String> {
    let conn = store.conn.lock().await;
    let position = next_position(&conn)?;
    insert_at_position(&conn, &file, position)
}

#[tauri::command]
pub async fn queue_play_next(
    store: State<'_, QueueStore>,
    file: QueueFileInput,
) -> Result<i64, String> {
    let conn = store.conn.lock().await;
    let position = prev_position(&conn)?;
    insert_at_position(&conn, &file, position)
}

#[tauri::command]
pub async fn queue_add_url_to_queue(
    store: State<'_, QueueStore>,
    url: String,
) -> Result<i64, String> {
    let metadata = resolve_youtube(url.clone()).await?;
    let file = QueueFileInput {
        name: metadata.title.clone(),
        path: metadata.canonical_url.clone(),
        size: 0,
        modified_at: remote::now_ms(),
        extension: "url".into(),
        duration: None,
        title: Some(metadata.title.clone()),
        artist: metadata.artist.clone(),
        original_url: Some(metadata.original_url.clone()),
        thumbnail_path: metadata.thumbnail_path.clone(),
        remote_thumbnail_url: metadata.remote_thumbnail_url.clone(),
        download_status: Some("not_downloaded".into()),
    };

    let conn = store.conn.lock().await;
    let position = next_position(&conn)?;
    insert_at_position(&conn, &file, position)
}

#[tauri::command]
pub async fn queue_remove(store: State<'_, QueueStore>, id: i64) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("DELETE FROM queue WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_mark_played(store: State<'_, QueueStore>, id: i64) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("UPDATE queue SET played = 1 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_toggle_played(store: State<'_, QueueStore>, id: i64) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute(
        "UPDATE queue SET played = CASE WHEN played = 0 THEN 1 ELSE 0 END WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_shift(
    store: State<'_, QueueStore>,
    exclude_path: Option<String>,
) -> Result<Option<QueueItem>, String> {
    let conn = store.conn.lock().await;
    let normalized = exclude_path.as_deref().map(canonicalize_youtube_url);

    let row = if let Some(exclude) = &normalized {
        conn.query_row(
            "SELECT * FROM queue WHERE played = 0 AND file_path != ?1 ORDER BY position ASC LIMIT 1",
            params![exclude],
            row_from_queue,
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT * FROM queue WHERE played = 0 ORDER BY position ASC LIMIT 1",
            [],
            row_from_queue,
        )
        .optional()
        .map_err(|e| e.to_string())?
    };

    if let Some(row) = row {
        conn.execute("UPDATE queue SET played = 1 WHERE id = ?1", params![row.id])
            .map_err(|e| e.to_string())?;
        Ok(Some(row.into_item()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn queue_clear(store: State<'_, QueueStore>) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("DELETE FROM queue", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_reorder(
    store: State<'_, QueueStore>,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    let mut conn = store.conn.lock().await;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (position, id) in ordered_ids.into_iter().enumerate() {
        tx.execute(
            "UPDATE queue SET position = ?1 WHERE id = ?2",
            params![position as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_update_all_positions(
    store: State<'_, QueueStore>,
    id_updates: Vec<IdPositionUpdate>,
    path_updates: Vec<PathPositionUpdate>,
) -> Result<(), String> {
    let mut conn = store.conn.lock().await;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for update in &id_updates {
        tx.execute(
            "UPDATE queue SET position = ?1 WHERE id = ?2",
            params![update.position, update.id],
        )
        .map_err(|e| e.to_string())?;
    }
    for update in &path_updates {
        tx.execute(
            "UPDATE queue SET position = ?1 WHERE file_path = ?2",
            params![update.position, update.path],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_shuffle(store: State<'_, QueueStore>) -> Result<(), String> {
    let mut conn = store.conn.lock().await;
    let rows = load_rows(&conn)?;
    if rows.is_empty() {
        return Ok(());
    }

    let mut order: Vec<usize> = (0..rows.len()).collect();
    shuffle(&mut order);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (position, index) in order.iter().enumerate() {
        tx.execute(
            "UPDATE queue SET position = ?1 WHERE id = ?2",
            params![position as i64, rows[*index].id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn queue_update_metadata(
    store: State<'_, QueueStore>,
    file_path: String,
    metadata: QueueMetadataUpdate,
) -> Result<(), String> {
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(value) = metadata.duration {
        sets.push(format!("duration = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Real(value));
    }
    if let Some(value) = &metadata.title {
        sets.push(format!("title = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }
    if let Some(value) = &metadata.artist {
        sets.push(format!("artist = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }
    if let Some(value) = &metadata.thumbnail_path {
        sets.push(format!("thumbnail_path = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }
    if let Some(value) = &metadata.remote_thumbnail_url {
        sets.push(format!("remote_thumbnail_url = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    let source_url = canonicalize_youtube_url(&file_path);
    params.push(rusqlite::types::Value::Text(source_url));
    let query = format!(
        "UPDATE queue SET {} WHERE file_path = ?{} OR original_url = ?{}",
        sets.join(", "),
        params.len(),
        params.len()
    );

    let conn = store.conn.lock().await;
    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    conn.execute(&query, refs.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}