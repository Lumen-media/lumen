//! Media playback queue for Lumen.
//!
//! The queue is a persisted, ordered list of playable entries stored in the
//! `queue` table of `lumen.db`. Entries are either local files/downloads
//! (identified by `file_path`) or remote URLs and triggers, which use
//! synthetic paths:
//!
//! * `url` entries keep the canonical video URL in `file_path` and track
//!   download state (`not_downloaded`, `downloaded`, `missing`);
//! * `trigger://{entry_id}` entries represent automation triggers rather
//!   than playable media and are managed by dedicated commands.
//!
//! Ordering is controlled by the integer `position` column; the Tauri
//! commands in this module add, remove, reorder, shuffle, mark as played,
//! and update metadata. [`QueueStore`] wraps the shared SQLite connection in
//! a `tokio::sync::Mutex`.

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

/// Raw database representation of a queue entry.
///
/// Mirrors the `queue` table columns one-to-one (plus the migration-added
/// columns) and is serialized in camelCase for the frontend. Convert to the
/// friendlier [`QueueItem`] with the crate-internal `into_item`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRow {
    /// Primary key of the row.
    pub id: i64,
    /// Sort key; lower positions play first.
    pub position: i64,
    /// File system path, canonical URL, or `trigger://{entry_id}`.
    pub file_path: String,
    /// Name derived from the title when set, otherwise the file name.
    pub file_name: String,
    /// File size in bytes (0 for URLs and triggers).
    pub file_size: i64,
    /// File modification time in milliseconds (0 for URLs and triggers).
    pub file_modified_at: i64,
    /// Lower-case file extension (`""` for triggers, `"url"` for URL entries).
    pub file_extension: String,
    /// `1` when the entry has been played, `0` otherwise.
    pub played: i64,
    /// Media duration in seconds, when known.
    pub duration: Option<f64>,
    /// Track title, when set.
    pub title: Option<String>,
    /// Track artist, when set.
    pub artist: Option<String>,
    /// Original source URL for downloaded media or URL entries.
    pub original_url: Option<String>,
    /// Local path of the cached thumbnail.
    pub thumbnail_path: Option<String>,
    /// Remote URL of the thumbnail, when not cached locally.
    pub remote_thumbnail_url: Option<String>,
    /// Download state: `downloaded`, `not_downloaded`, or `missing`.
    pub download_status: Option<String>,
}

/// Queue entry shaped for the frontend UI.
///
/// Produced from [`QueueRow`] with normalized defaults (a non-empty title,
/// a resolved `download_status`, and a boolean `played`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    /// Primary key of the row.
    pub id: i64,
    /// Display name (title when available, otherwise the file name).
    pub name: String,
    /// File system path, canonical URL, or trigger path.
    pub path: String,
    /// File size in bytes.
    pub size: i64,
    /// File modification time in milliseconds.
    pub modified_at: i64,
    /// Lower-case file extension.
    pub extension: String,
    /// Whether the entry has been played.
    pub played: bool,
    /// Media duration in seconds, when known.
    pub duration: Option<f64>,
    /// Track title; always populated (falls back to the file name).
    pub title: String,
    /// Track artist, when known.
    pub artist: Option<String>,
    /// Original source URL, when applicable.
    pub original_url: Option<String>,
    /// Local path of the cached thumbnail.
    pub thumbnail_path: Option<String>,
    /// Remote URL of the thumbnail.
    pub remote_thumbnail_url: Option<String>,
    /// Normalized download state: `downloaded`, `not_downloaded`, or `missing`.
    pub download_status: String,
}

/// Input payload for adding an entry to the queue.
///
/// Deserialized in camelCase from the frontend and passed to
/// `queue::queue_add_to_queue` and `queue::queue_play_next`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueFileInput {
    /// File name or source title.
    pub name: String,
    /// File system path or canonical URL.
    pub path: String,
    /// File size in bytes.
    pub size: i64,
    /// File modification time in milliseconds.
    pub modified_at: i64,
    /// Lower-case file extension.
    pub extension: String,
    /// Media duration in seconds, when known.
    pub duration: Option<f64>,
    /// Track title override.
    pub title: Option<String>,
    /// Track artist.
    pub artist: Option<String>,
    /// Original source URL.
    pub original_url: Option<String>,
    /// Local path of a cached thumbnail.
    pub thumbnail_path: Option<String>,
    /// Remote URL of a thumbnail.
    pub remote_thumbnail_url: Option<String>,
    /// Explicit download state; defaults based on the extension when omitted.
    pub download_status: Option<String>,
}

/// Partial metadata update for an existing queue entry.
///
/// Only `Some` fields are written; omitted fields are left unchanged. Passed
/// to `queue::queue_update_metadata`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueMetadataUpdate {
    /// New duration in seconds.
    pub duration: Option<f64>,
    /// New track title.
    pub title: Option<String>,
    /// New track artist.
    pub artist: Option<String>,
    /// New local thumbnail path.
    pub thumbnail_path: Option<String>,
    /// New remote thumbnail URL.
    pub remote_thumbnail_url: Option<String>,
}

/// Position update addressed by queue row id.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdPositionUpdate {
    /// Id of the row to move.
    pub id: i64,
    /// New sort position.
    pub position: i64,
}

/// Position update addressed by file path.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPositionUpdate {
    /// File path (or canonical URL) identifying the row to move.
    pub path: String,
    /// New sort position.
    pub position: i64,
}

/// Tauri-managed queue store wrapping the shared SQLite connection.
///
/// Registered with `.manage(...)` at startup (see [`initialize_queue_store`])
/// and injected into every `queue_*` command as `State<'_, QueueStore>`.
/// Commands lock [`QueueStore::conn`] for the duration of their query.
pub struct QueueStore {
    /// Connection to `lumen.db`, serialized behind an async mutex so
    /// concurrent commands cannot interleave transactions.
    conn: Mutex<Connection>,
}

/// Opens `lumen.db`, creates the `queue` table, applies column migrations,
/// and returns the managed [`QueueStore`].
///
/// Called once during app setup. Migration adds the `original_url`,
/// `thumbnail_path`, `remote_thumbnail_url`, and `download_status` columns
/// when upgrading from older schema versions, then ensures the
/// `original_url` index exists.
///
/// # Errors
///
/// Returns an error string when the base directory cannot be resolved or the
/// database cannot be opened, migrated, or indexed.
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

/// Tauri command: returns the full queue ordered by position.
///
/// Entries are converted to [`QueueItem`] with normalized defaults.
///
/// # Examples
///
/// ```js
/// const items = await invoke("queue_load");
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the queue cannot be read.
#[tauri::command]
pub async fn queue_load(store: State<'_, QueueStore>) -> Result<Vec<QueueItem>, String> {
    let conn = store.conn.lock().await;
    load_rows(&conn).map(|rows| rows.into_iter().map(QueueRow::into_item).collect())
}

/// Tauri command: returns the full queue as raw [`QueueRow`] records.
///
/// Unlike [`queue_load`], no defaulting is applied.
///
/// # Errors
///
/// Returns a SQLite error string when the queue cannot be read.
#[tauri::command]
pub async fn queue_load_rows(store: State<'_, QueueStore>) -> Result<Vec<QueueRow>, String> {
    let conn = store.conn.lock().await;
    load_rows(&conn)
}

/// Tauri command: returns only trigger entries (`file_path LIKE 'trigger://%'`).
///
/// # Errors
///
/// Returns a SQLite error string when the query fails.
#[tauri::command]
pub async fn queue_load_trigger_entries(
    store: State<'_, QueueStore>,
) -> Result<Vec<QueueRow>, String> {
    let conn = store.conn.lock().await;
    load_rows_where(&conn, "SELECT * FROM queue WHERE file_path LIKE 'trigger://%' ORDER BY position ASC")
}

/// Tauri command: adds a trigger entry to the queue, or returns the existing
/// one.
///
/// Keyed by `entry_id` (`trigger://{entry_id}`); if a matching row already
/// exists its id is returned unchanged, otherwise the entry is appended at
/// the end with `config_json` stored in `original_url` and `tag` as the
/// artist.
///
/// # Examples
///
/// ```js
/// const id = await invoke("queue_add_trigger_entry", {
///   entryId: "abc",
///   triggerId: "start-confetti",
///   configJson: "{}",
///   title: "Confetti",
///   tag: "visual",
/// });
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the lookup or insert fails.
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

/// Tauri command: removes a trigger entry.
///
/// Deletes the row whose path is `trigger://{entry_id}`.
///
/// # Errors
///
/// Returns a SQLite error string when the delete fails.
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

/// Tauri command: flips the played flag of a trigger entry.
///
/// # Errors
///
/// Returns a SQLite error string when the update fails.
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

/// Tauri command: checks whether a file or URL is already queued.
///
/// The input is canonicalized as a YouTube URL first, then matched against
/// either `file_path` or `original_url`, so equivalent URL forms are treated
/// as duplicates.
///
/// # Examples
///
/// ```js
/// const alreadyQueued = await invoke("queue_exists", { filePath: "https://youtu.be/abc" });
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the count query fails.
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

/// Tauri command: appends a file to the end of the queue.
///
/// Returns the new row id.
///
/// # Examples
///
/// ```js
/// const id = await invoke("queue_add_to_queue", {
///   file: { name: "song.mp3", path: "C:\\media\\song.mp3", size: 1024, modifiedAt: 0, extension: "mp3" },
/// });
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the insert fails.
#[tauri::command]
pub async fn queue_add_to_queue(
    store: State<'_, QueueStore>,
    file: QueueFileInput,
) -> Result<i64, String> {
    let conn = store.conn.lock().await;
    let position = next_position(&conn)?;
    insert_at_position(&conn, &file, position)
}

/// Tauri command: inserts a file at the front of the queue ("play next").
///
/// Assigns a position below the current minimum and returns the new row id.
///
/// # Errors
///
/// Returns a SQLite error string when the insert fails.
#[tauri::command]
pub async fn queue_play_next(
    store: State<'_, QueueStore>,
    file: QueueFileInput,
) -> Result<i64, String> {
    let conn = store.conn.lock().await;
    let position = prev_position(&conn)?;
    insert_at_position(&conn, &file, position)
}

/// Tauri command: resolves a URL's metadata and appends it to the queue.
///
/// Resolves the URL with the media resolver (title, artist, thumbnails,
/// canonical form), builds a `url`-extension entry marked `not_downloaded`,
/// and appends it. Returns the new row id.
///
/// # Examples
///
/// ```js
/// const id = await invoke("queue_add_url_to_queue", { url: "https://youtu.be/abc" });
/// ```
///
/// # Errors
///
/// Returns an error string when the URL cannot be resolved, or a SQLite
/// error string when the insert fails.
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

/// Tauri command: removes a queue entry by id.
///
/// # Examples
///
/// ```js
/// await invoke("queue_remove", { id: 7 });
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the delete fails.
#[tauri::command]
pub async fn queue_remove(store: State<'_, QueueStore>, id: i64) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("DELETE FROM queue WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Tauri command: marks a queue entry as played (`played = 1`).
///
/// # Errors
///
/// Returns a SQLite error string when the update fails.
#[tauri::command]
pub async fn queue_mark_played(store: State<'_, QueueStore>, id: i64) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("UPDATE queue SET played = 1 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Tauri command: flips the played flag of a queue entry.
///
/// # Errors
///
/// Returns a SQLite error string when the update fails.
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

/// Tauri command: pops the next unplayed entry and marks it played.
///
/// Selects the lowest-position entry with `played = 0`, optionally skipping
/// the entry whose path matches `exclude_path` (canonicalized), then sets it
/// to played and returns it. Returns `None` when no unplayed entry remains.
///
/// # Examples
///
/// ```js
/// const next = await invoke("queue_shift", { excludePath: null });
/// if (next) play(next.path);
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the select or update fails.
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

/// Tauri command: removes every entry from the queue.
///
/// # Errors
///
/// Returns a SQLite error string when the delete fails.
#[tauri::command]
pub async fn queue_clear(store: State<'_, QueueStore>) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("DELETE FROM queue", []).map_err(|e| e.to_string())?;
    Ok(())
}

/// Tauri command: reorders the queue following an explicit id order.
///
/// `ordered_ids`'s index becomes each row's `position`, applied atomically
/// inside a transaction.
///
/// # Examples
///
/// ```js
/// await invoke("queue_reorder", { orderedIds: [3, 1, 2] });
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the transaction or an update fails.
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

/// Tauri command: applies a batch of position updates by id and by path.
///
/// `id_updates` are applied first, then `path_updates`, all within a single
/// transaction. Useful for reconciling the queue after a drag-and-drop that
/// mixes persisted and unsaved entries.
///
/// # Errors
///
/// Returns a SQLite error string when the transaction or any update fails.
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

/// Tauri command: randomizes the queue order.
///
/// Assigns each row a new position based on a time-seeded Fisher-Yates
/// shuffle, applied in a single transaction. No-op when the queue is empty.
///
/// # Examples
///
/// ```js
/// await invoke("queue_shuffle");
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when loading or updating fails.
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

/// Tauri command: updates metadata fields of a queue entry.
///
/// Only `Some` fields of `metadata` are written; the row is matched by
/// `file_path` or its canonicalized `original_url`. Returns early without
/// touching the database when no fields are provided.
///
/// # Examples
///
/// ```js
/// await invoke("queue_update_metadata", {
///   filePath: "https://youtu.be/abc",
///   metadata: { title: "New title", duration: 213.5 },
/// });
/// ```
///
/// # Errors
///
/// Returns a SQLite error string when the update fails.
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