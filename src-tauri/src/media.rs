use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;

use crate::remote;
use crate::url_media::{canonicalize_youtube_url, resolve_youtube};

const MEDIA_BOOTSTRAP: &str = "
DROP TRIGGER IF EXISTS mf_ai;
DROP TRIGGER IF EXISTS mf_au;
DROP TRIGGER IF EXISTS mf_ad;
DROP TABLE IF EXISTS media_search;
CREATE TABLE IF NOT EXISTS media_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  path        TEXT    NOT NULL UNIQUE,
  size        INTEGER NOT NULL DEFAULT 0,
  modified_at INTEGER NOT NULL DEFAULT 0,
  extension   TEXT    NOT NULL DEFAULT '',
  media_type  TEXT    NOT NULL,
  duration    REAL,
  artist      TEXT,
  content     TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  folder      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mf_type ON media_files (media_type);
CREATE INDEX IF NOT EXISTS idx_mf_name ON media_files (name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS theme_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  path        TEXT    NOT NULL UNIQUE,
  size        INTEGER NOT NULL DEFAULT 0,
  modified_at INTEGER NOT NULL DEFAULT 0,
  extension   TEXT    NOT NULL DEFAULT '',
  content_hash TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tf_name ON theme_files (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tf_content_hash ON theme_files (content_hash);
";

const MEDIA_ALREADY_CREATED_TABLES: &[(&str, &[(&str, &str)])] = &[
    (
        "media_files",
        &[
            ("content", "ALTER TABLE media_files ADD COLUMN content TEXT"),
            (
                "original_url",
                "ALTER TABLE media_files ADD COLUMN original_url TEXT",
            ),
            (
                "thumbnail_path",
                "ALTER TABLE media_files ADD COLUMN thumbnail_path TEXT",
            ),
            (
                "remote_thumbnail_url",
                "ALTER TABLE media_files ADD COLUMN remote_thumbnail_url TEXT",
            ),
            (
                "download_status",
                "ALTER TABLE media_files ADD COLUMN download_status TEXT NOT NULL DEFAULT 'downloaded'",
            ),
            (
                "folder",
                "ALTER TABLE media_files ADD COLUMN folder TEXT NOT NULL DEFAULT ''",
            ),
        ],
    ),
    (
        "theme_files",
        &[(
            "content_hash",
            "ALTER TABLE theme_files ADD COLUMN content_hash TEXT",
        )],
    ),
];

const MEDIA_EXTRA_INDEXES: &str = "
CREATE INDEX IF NOT EXISTS idx_mf_original_url ON media_files (original_url);
CREATE INDEX IF NOT EXISTS idx_mf_content ON media_files (content);
CREATE INDEX IF NOT EXISTS idx_mf_type_content ON media_files (media_type, content);
";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileInput {
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified_at: i64,
    pub extension: String,
    pub duration: Option<f64>,
    pub artist: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
    pub download_status: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileInfo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified_at: i64,
    pub extension: String,
    pub folder: String,
    pub duration: Option<f64>,
    pub title: String,
    pub artist: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
    pub download_status: String,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub media_type: String,
    pub artist: Option<String>,
    pub duration: Option<f64>,
    pub modified_at: i64,
    pub rank: i64,
    pub title: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_path: Option<String>,
    pub remote_thumbnail_url: Option<String>,
    pub download_status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFile {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified_at: i64,
    pub extension: String,
}

pub struct MediaStore {
    conn: Mutex<Connection>,
}

pub fn initialize_media_store() -> Result<MediaStore, String> {
    let db_path = remote::app_base_dir()?.join("lumen.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(MEDIA_BOOTSTRAP).map_err(|e| e.to_string())?;

    for &(table, columns) in MEDIA_ALREADY_CREATED_TABLES {
        ensure_columns(&conn, table, columns)?;
    }
    conn.execute_batch(MEDIA_EXTRA_INDEXES)
        .map_err(|e| e.to_string())?;

    Ok(MediaStore {
        conn: Mutex::new(conn),
    })
}

fn ensure_columns(conn: &Connection, table: &str, columns: &[(&str, &str)]) -> Result<(), String> {
    let mut stmt = conn
        .prepare(format!("PRAGMA table_info({table})").as_str())
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let has = |name: &str| names.iter().any(|n| n == name);
    for &(name, sql) in columns {
        if !has(name) {
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[allow(dead_code)]
struct MediaRow {
    id: i64,
    name: String,
    path: String,
    size: i64,
    modified_at: i64,
    extension: String,
    media_type: String,
    duration: Option<f64>,
    artist: Option<String>,
    content: Option<String>,
    original_url: Option<String>,
    thumbnail_path: Option<String>,
    remote_thumbnail_url: Option<String>,
    download_status: Option<String>,
    folder: String,
}

fn row_from_media(row: &Row<'_>) -> rusqlite::Result<MediaRow> {
    Ok(MediaRow {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        size: row.get(3)?,
        modified_at: row.get(4)?,
        extension: row.get(5)?,
        media_type: row.get(6)?,
        duration: row.get(7)?,
        artist: row.get(8)?,
        content: row.get(9)?,
        original_url: row.get(10)?,
        thumbnail_path: row.get(11)?,
        remote_thumbnail_url: row.get(12)?,
        download_status: row.get(13)?,
        folder: row.get(14)?,
    })
}

fn file_info_from_row(row: &MediaRow) -> MediaFileInfo {
    let default_status = if row.extension == "url" {
        "not_downloaded"
    } else {
        "downloaded"
    };
    let download_status = match row.download_status.as_deref() {
        Some("not_downloaded") | Some("downloaded") | Some("missing") => {
            row.download_status.clone().unwrap()
        }
        _ => default_status.to_string(),
    };
    MediaFileInfo {
        id: row.id,
        name: row.name.clone(),
        path: row.path.clone(),
        size: row.size,
        modified_at: row.modified_at,
        extension: row.extension.clone(),
        folder: row.folder.clone(),
        duration: row.duration,
        title: row.name.clone(),
        artist: row.artist.clone(),
        original_url: row.original_url.clone(),
        thumbnail_path: row.thumbnail_path.clone(),
        remote_thumbnail_url: row.remote_thumbnail_url.clone(),
        download_status,
    }
}

fn search_hit_from_row(row: &MediaRow) -> SearchHit {
    SearchHit {
        id: row.id,
        name: row.name.clone(),
        path: row.path.clone(),
        media_type: row.media_type.clone(),
        artist: row.artist.clone(),
        duration: row.duration,
        modified_at: row.modified_at,
        rank: 0,
        title: Some(row.name.clone()),
        original_url: row.original_url.clone(),
        thumbnail_path: row.thumbnail_path.clone(),
        remote_thumbnail_url: row.remote_thumbnail_url.clone(),
        download_status: row.download_status.clone(),
    }
}

fn query_rows(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<MediaRow>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params, row_from_media)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn query_folder_names(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names = stmt
        .query_map(params, |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(names)
}

fn default_download_status(file: &MediaFileInput) -> String {
    file.download_status.clone().unwrap_or_else(|| {
        if file.extension == "url" {
            "not_downloaded".to_string()
        } else {
            "downloaded".to_string()
        }
    })
}

fn folder_of(file: &MediaFileInput) -> String {
    file.folder.clone().unwrap_or_default()
}

fn insert_media_file(conn: &Connection, file: &MediaFileInput, media_type: &str) -> Result<(), String> {
    let download_status = default_download_status(file);
    let folder = folder_of(file);
    conn.execute(
        "INSERT INTO media_files (name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(path) DO UPDATE SET
           name                 = excluded.name,
           size                 = excluded.size,
           modified_at          = excluded.modified_at,
           extension            = excluded.extension,
           duration             = excluded.duration,
           artist               = excluded.artist,
           content              = COALESCE(excluded.content, media_files.content),
           original_url         = excluded.original_url,
           thumbnail_path       = COALESCE(excluded.thumbnail_path, media_files.thumbnail_path),
           remote_thumbnail_url = COALESCE(excluded.remote_thumbnail_url, media_files.remote_thumbnail_url),
           download_status      = excluded.download_status,
           folder               = excluded.folder",
        params![
            file.name,
            file.path,
            file.size,
            file.modified_at,
            file.extension,
            media_type,
            file.duration,
            file.artist,
            file.content,
            file.original_url,
            file.thumbnail_path,
            file.remote_thumbnail_url,
            download_status,
            folder
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn escape_like(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '#' => out.push_str("##"),
            '%' => {
                out.push('#');
                out.push('%');
            }
            '_' => {
                out.push('#');
                out.push('_');
            }
            _ => out.push(ch),
        }
    }
    out
}

fn search_media_rows(
    conn: &Connection,
    trimmed: &str,
    full_content: bool,
    media_type: Option<&str>,
    limit: i64,
) -> Result<Vec<MediaRow>, String> {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    for term in trimmed.split_whitespace() {
        let like = format!("%{}%", escape_like(term));
        let next = params.len();
        if full_content {
            conditions.push(format!(
                "(name LIKE ?{} ESCAPE '#' OR COALESCE(artist, '') LIKE ?{} ESCAPE '#' OR COALESCE(content, '') LIKE ?{} ESCAPE '#')",
                next + 1,
                next + 2,
                next + 3
            ));
            params.push(rusqlite::types::Value::Text(like.clone()));
            params.push(rusqlite::types::Value::Text(like.clone()));
            params.push(rusqlite::types::Value::Text(like));
        } else {
            conditions.push(format!(
                "(name LIKE ?{} ESCAPE '#' OR COALESCE(artist, '') LIKE ?{} ESCAPE '#')",
                next + 1,
                next + 2
            ));
            params.push(rusqlite::types::Value::Text(like.clone()));
            params.push(rusqlite::types::Value::Text(like));
        }
    }

    if let Some(media_type) = media_type {
        conditions.push(format!("media_type = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(media_type.to_string()));
    }

    let sql = format!(
        "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE {} ORDER BY name COLLATE NOCASE LIMIT ?{}",
        conditions.join(" AND "),
        params.len() + 1
    );
    params.push(rusqlite::types::Value::Integer(limit));

    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    query_rows(conn, &sql, refs.as_slice())
}

#[tauri::command]
pub async fn media_initialize(store: State<'_, MediaStore>) -> Result<(), String> {
    let _conn = store.conn.lock().await;
    Ok(())
}

#[tauri::command]
pub async fn media_sync_type(
    store: State<'_, MediaStore>,
    media_type: String,
    files: Vec<MediaFileInput>,
) -> Result<(), String> {
    let conn = store.conn.lock().await;

    let existing = query_rows(
        &conn,
        "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type = ?1 AND extension != 'url'",
        &[&media_type],
    )?;
    let mut existing_paths: Vec<String> = existing.iter().map(|r| r.path.clone()).collect();
    existing_paths.sort_unstable();

    let mut fs_paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    fs_paths.sort_unstable();

    for file in &files {
        if existing_paths.binary_search(&file.path).is_err() {
            insert_media_file(&conn, file, &media_type)?;
        }
    }

    for path in &existing_paths {
        if fs_paths.binary_search(path).is_err() {
            conn.execute(
                "DELETE FROM media_files WHERE path = ?1 AND extension != 'url'",
                params![path],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn media_list(
    store: State<'_, MediaStore>,
    media_type: String,
) -> Result<Vec<MediaFileInfo>, String> {
    let conn = store.conn.lock().await;

    let (sql, rows) = if media_type == "files" {
        (
            "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type IN ('files', 'presentation') ORDER BY name COLLATE NOCASE",
            None,
        )
    } else {
        (
            "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type = ?1 ORDER BY name COLLATE NOCASE",
            Some(&media_type),
        )
    };
    let params: &[&dyn rusqlite::ToSql] = match rows {
        Some(rows) => &[rows],
        None => &[],
    };
    let rows = query_rows(&conn, sql, params)?;
    Ok(rows.iter().map(file_info_from_row).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFolderEntry {
    pub name: String,
    pub folder: String,
    pub absolute_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPoolListing {
    pub folders: Vec<MediaFolderEntry>,
    pub files: Vec<MediaFileInfo>,
}

#[tauri::command]
pub async fn media_list_folder(
    store: State<'_, MediaStore>,
    media_type: String,
    folder: Option<String>,
) -> Result<MediaPoolListing, String> {
    let folder = folder.unwrap_or_default();
    let conn = store.conn.lock().await;

    let file_rows = query_rows(
        &conn,
        &format!(
            "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type = ?1 AND folder = ?2 ORDER BY name COLLATE NOCASE"
        ),
        &[&media_type, &folder],
    )?;
    let files = file_rows.iter().map(file_info_from_row).collect();

    let (sql, pattern) = if folder.is_empty() {
        (
            "SELECT DISTINCT folder FROM media_files WHERE media_type = ?1 AND folder <> '' AND folder NOT LIKE '%/%' ORDER BY folder COLLATE NOCASE",
            None,
        )
    } else {
        (
            "SELECT DISTINCT folder FROM media_files WHERE media_type = ?1 AND folder LIKE ?2 ESCAPE '#' ORDER BY folder COLLATE NOCASE",
            Some(format!("{}/%", escape_like(&folder))),
        )
    };

    let mut params: Vec<rusqlite::types::Value> =
        vec![rusqlite::types::Value::Text(media_type.clone())];
    if let Some(pattern) = &pattern {
        params.push(rusqlite::types::Value::Text(pattern.clone()));
    }
    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let folder_names = query_folder_names(&conn, sql, refs.as_slice())?;

    let mut folders: Vec<MediaFolderEntry> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for name in folder_names {
        let rest = name.strip_prefix(&folder).unwrap_or(&name);
        let child = rest.trim_start_matches('/').split('/').next().unwrap_or("");
        if child.is_empty() {
            continue;
        }
        let child_folder = if folder.is_empty() {
            child.to_string()
        } else {
            format!("{folder}/{child}")
        };
        if seen.insert(child_folder.clone()) {
            let absolute_path = media_folder_dir(&media_type, &child_folder)
                .map_or_else(|_| String::new(), |p| p.to_string_lossy().to_string());
            folders.push(MediaFolderEntry {
                name: child.to_string(),
                folder: child_folder,
                absolute_path,
            });
        }
    }
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(MediaPoolListing { folders, files })
}

#[tauri::command]
pub async fn media_search_files(
    store: State<'_, MediaStore>,
    media_type: String,
    query: String,
) -> Result<Vec<MediaFileInfo>, String> {
    let conn = store.conn.lock().await;
    let like = format!("%{}%", escape_like(&query));
    let sql = "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type = ?1 AND name LIKE ?2 ESCAPE '#' ORDER BY name COLLATE NOCASE";
    let rows = query_rows(&conn, sql, &[&media_type, &like])?;
    Ok(rows.iter().map(file_info_from_row).collect())
}

#[tauri::command]
pub async fn media_insert(
    store: State<'_, MediaStore>,
    file: MediaFileInput,
    media_type: String,
    content: Option<String>,
) -> Result<(), String> {
    let conn = store.conn.lock().await;
    let mut file = file;
    if file.content.is_none() {
        file.content = content;
    }
    insert_media_file(&conn, &file, &media_type)
}

#[tauri::command]
pub async fn media_insert_url(
    store: State<'_, MediaStore>,
    url: String,
    refresh_metadata: bool,
    duration: Option<f64>,
) -> Result<MediaFileInfo, String> {
    let parsed = crate::url_media::parse_youtube_url(&url)
        .ok_or_else(|| "Only YouTube URLs are supported".to_string())?;

    if !refresh_metadata {
        let conn = store.conn.lock().await;
        let canonical = parsed.canonical_url.clone();
        let rows = query_rows(
            &conn,
            "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE original_url = ?1 OR original_url = ?2 OR path = ?2 LIMIT 1",
            &[&url, &canonical],
        )?;
        if let Some(row) = rows.first() {
            return Ok(file_info_from_row(row));
        }
    }

    let metadata = resolve_youtube(url.clone()).await?;
    let file = MediaFileInput {
        name: metadata.title.clone(),
        path: metadata.canonical_url.clone(),
        size: 0,
        modified_at: remote::now_ms(),
        extension: "url".into(),
        duration,
        artist: metadata.artist.clone(),
        original_url: Some(metadata.original_url.clone()),
        thumbnail_path: metadata.thumbnail_path.clone(),
        remote_thumbnail_url: metadata.remote_thumbnail_url.clone(),
        download_status: Some("not_downloaded".into()),
        content: None,
        folder: None,
    };

    let conn = store.conn.lock().await;
    insert_media_file(&conn, &file, "video")?;

    let rows = query_rows(
        &conn,
        "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE path = ?1 LIMIT 1",
        &[&file.path],
    )?;
    rows.first()
        .map(file_info_from_row)
        .ok_or_else(|| "media file not found after insert".to_string())
}

#[tauri::command]
pub async fn media_search(
    store: State<'_, MediaStore>,
    query: String,
    full_content: Option<bool>,
    media_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<SearchHit>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit.unwrap_or(50);
    let full_content = full_content.unwrap_or(false);

    let conn = store.conn.lock().await;
    let rows = search_media_rows(&conn, trimmed, full_content, media_type.as_deref(), limit)?;
    Ok(rows.iter().map(search_hit_from_row).collect())
}

#[tauri::command]
pub async fn media_search_multi(
    store: State<'_, MediaStore>,
    query: String,
    full_content: Option<bool>,
    media_types: Vec<String>,
    limit_per_group: Option<i64>,
) -> Result<Vec<SearchHit>, String> {
    let trimmed = query.trim();
    let full_content = full_content.unwrap_or(false);
    let limit_per_group = limit_per_group.unwrap_or(50);

    let conn = store.conn.lock().await;
    let mut hits: Vec<SearchHit> = Vec::new();
    for media_type in &media_types {
        let rows = if trimmed.is_empty() {
            let sql =
                "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type = ?1 ORDER BY name COLLATE NOCASE LIMIT ?2";
            query_rows(&conn, sql, &[media_type, &limit_per_group])?
        } else {
            search_media_rows(&conn, trimmed, full_content, Some(media_type), limit_per_group)?
        };
        hits.extend(rows.iter().map(search_hit_from_row));
    }
    Ok(hits)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadOutput {
    pub path: String,
    pub file: Option<MediaFileInfo>,
    pub error: Option<String>,
}

fn media_type_root(media_type: &str) -> Result<std::path::PathBuf, String> {
    Ok(remote::app_base_dir()?
        .join("files")
        .join("media")
        .join(media_type))
}

fn media_folder_dir(media_type: &str, folder: &str) -> Result<std::path::PathBuf, String> {
    let base = media_type_root(media_type)?;
    if folder.is_empty() {
        return Ok(base);
    }
    let mut dir = base;
    for segment in folder.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\') {
            return Err("invalid folder path".to_string());
        }
        dir = dir.join(segment);
    }
    Ok(dir)
}

fn extension_allowed(media_type: &str, extension: &str) -> bool {
    if media_type == "files" {
        return true;
    }
    const EXTENSION_MAP: &[(&str, &[&str])] = &[
        ("video", &[".mp4", ".avi", ".mov", ".mkv", ".webm"]),
        ("audio", &[".mp3", ".wav", ".ogg", ".flac", ".m4a"]),
        ("image", &[".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]),
        ("text", &[".txt", ".md", ".doc", ".docx", ".pdf"]),
        ("lyrics", &[".txt", ".lrc", ".srt", ".md"]),
        (
            "themes",
            &[".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm"],
        ),
        ("presentation", &[".ppt", ".pptx"]),
        ("files", &[]),
    ];
    EXTENSION_MAP
        .iter()
        .find(|(t, _)| *t == media_type)
        .map(|(_, extensions)| extensions.contains(&extension))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn media_upload_files(
    store: State<'_, MediaStore>,
    media_type: String,
    folder: Option<String>,
    file_paths: Vec<String>,
) -> Result<Vec<UploadOutput>, String> {
    let folder = folder.unwrap_or_default();
    let dest_dir = media_folder_dir(&media_type, &folder)?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let mut pending: Vec<(String, MediaFileInput)> = Vec::new();
    let mut errors: Vec<UploadOutput> = Vec::new();

    for source in &file_paths {
        let source_path = std::path::Path::new(source);
        let file_name = source_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| source.clone());

        let ext = source_path
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();

        if !extension_allowed(&media_type, &ext) {
            errors.push(UploadOutput {
                path: source.clone(),
                file: None,
                error: Some(format!(
                    "File \"{}\" has an invalid type for {} category",
                    file_name, media_type
                )),
            });
            continue;
        }

        let mut dest_name = file_name.clone();
        let mut counter = 1;
        let (base, named_ext) = match file_name.rsplit_once('.') {
            Some((b, e)) => (b.to_string(), format!(".{e}")),
            None => (file_name.clone(), String::new()),
        };
        while dest_dir.join(&dest_name).exists() {
            dest_name = format!("{} ({}){}", base, counter, named_ext);
            counter += 1;
        }
        let dest = dest_dir.join(&dest_name);

        if let Err(copy_err) = std::fs::copy(source, &dest) {
            errors.push(UploadOutput {
                path: source.clone(),
                file: None,
                error: Some(format!("Failed to copy \"{}\": {}", file_name, copy_err)),
            });
            continue;
        }

        let dest_metadata = match std::fs::metadata(&dest) {
            Ok(m) => m,
            Err(stat_err) => {
                errors.push(UploadOutput {
                    path: source.clone(),
                    file: None,
                    error: Some(format!("Failed to read file stat \"{}\": {}", file_name, stat_err)),
                });
                continue;
            }
        };

        let modified_at = dest_metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let dest_str = dest.to_string_lossy().into_owned();

        let mut duration: Option<f64> = None;
        if let Ok(meta) = crate::metadata::extract_metadata(dest_str.clone()).await {
            duration = meta.duration;
        }

        let mut content: Option<String> = None;
        if media_type == "presentation" {
            if let Ok(meta) = crate::presentation::extract_presentation_metadata(dest_str.clone()) {
                let parts: Vec<String> = meta
                    .slides
                    .into_iter()
                    .filter(|s| !s.text.trim().is_empty())
                    .map(|s| s.text.trim().to_string())
                    .collect();
                content = if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("\n\n"))
                };
            }
        }

        pending.push((
            source.clone(),
            MediaFileInput {
                name: dest_name,
                path: dest_str,
                size: dest_metadata.len() as i64,
                modified_at,
                extension: named_ext.trim_start_matches('.').to_string(),
                duration,
                artist: None,
                original_url: None,
                thumbnail_path: None,
                remote_thumbnail_url: None,
                download_status: Some("downloaded".to_string()),
                content,
                folder: Some(folder.clone()),
            },
        ));
    }

    let conn = store.conn.lock().await;
    let mut outputs: Vec<UploadOutput> = Vec::new();
    for (source, file) in pending {
        match insert_media_file(&conn, &file, &media_type) {
            Ok(()) => {
                let rows = query_rows(
                    &conn,
                    "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE path = ?1 LIMIT 1",
                    &[&file.path],
                )?;
                let info = rows.first().map(file_info_from_row);
                outputs.push(UploadOutput {
                    path: source,
                    file: info,
                    error: None,
                });
            }
            Err(insert_err) => {
                outputs.push(UploadOutput {
                    path: source,
                    file: None,
                    error: Some(format!("Failed to index \"{}\": {}", file.name, insert_err)),
                });
            }
        }
    }
    outputs.extend(errors);
    Ok(outputs)
}

#[tauri::command]
pub async fn media_list_by_type(
    store: State<'_, MediaStore>,
    media_type: String,
    limit: Option<i64>,
) -> Result<Vec<SearchHit>, String> {
    let conn = store.conn.lock().await;
    let limit = limit.unwrap_or(50);
    let sql = "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE media_type = ?1 ORDER BY name COLLATE NOCASE LIMIT ?2";
    let rows = query_rows(&conn, sql, &[&media_type, &limit])?;
    Ok(rows.iter().map(search_hit_from_row).collect())
}

#[tauri::command]
pub async fn media_get_by_id(
    store: State<'_, MediaStore>,
    id: i64,
) -> Result<Option<SearchHit>, String> {
    let conn = store.conn.lock().await;
    let rows = query_rows(&conn, "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE id = ?1", &[&id])?;
    Ok(rows.first().map(search_hit_from_row))
}

#[tauri::command]
pub async fn media_get_by_path(
    store: State<'_, MediaStore>,
    path: String,
) -> Result<Option<SearchHit>, String> {
    let conn = store.conn.lock().await;
    let rows = query_rows(&conn, "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE path = ?1", &[&path])?;
    Ok(rows.first().map(search_hit_from_row))
}

#[tauri::command]
pub async fn media_get_file_info_by_path(
    store: State<'_, MediaStore>,
    path: String,
) -> Result<Option<MediaFileInfo>, String> {
    let conn = store.conn.lock().await;
    let rows = query_rows(&conn, "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE path = ?1", &[&path])?;
    Ok(rows.first().map(file_info_from_row))
}

#[tauri::command]
pub async fn media_get_file_info_by_original_url(
    store: State<'_, MediaStore>,
    original_url: String,
    canonical_url: Option<String>,
) -> Result<Option<MediaFileInfo>, String> {
    let conn = store.conn.lock().await;
    let canonical = canonical_url.unwrap_or_else(|| canonicalize_youtube_url(&original_url));
    let rows = query_rows(
        &conn,
        "SELECT id, name, path, size, modified_at, extension, media_type, duration, artist, content, original_url, thumbnail_path, remote_thumbnail_url, download_status, folder FROM media_files WHERE original_url = ?1 OR original_url = ?2 OR path = ?2 LIMIT 1",
        &[&original_url, &canonical],
    )?;
    Ok(rows.first().map(file_info_from_row))
}

#[tauri::command]
pub async fn media_delete(store: State<'_, MediaStore>, path: String) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("DELETE FROM media_files WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn media_delete_folder(
    store: State<'_, MediaStore>,
    media_type: String,
    folder: String,
) -> Result<(), String> {
    if folder.is_empty() {
        return Err("cannot delete the root folder".to_string());
    }

    let dir = media_folder_dir(&media_type, &folder)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    let pattern = format!("{}/%", escape_like(&folder));
    let conn = store.conn.lock().await;
    conn.execute(
        "DELETE FROM media_files WHERE media_type = ?1 AND (folder = ?2 OR folder LIKE ?3 ESCAPE '#')",
        params![media_type, folder, pattern],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn media_update_download_status(
    store: State<'_, MediaStore>,
    original_url: String,
    status: String,
    new_path: Option<String>,
    new_size: Option<i64>,
    new_media_type: Option<String>,
    new_extension: Option<String>,
) -> Result<(), String> {
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    sets.push("download_status = ?1".to_string());
    params.push(rusqlite::types::Value::Text(status));

    if let Some(value) = &new_path {
        sets.push(format!("path = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }
    if let Some(value) = new_size {
        sets.push(format!("size = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Integer(value));
    }
    if let Some(value) = &new_media_type {
        sets.push(format!("media_type = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }
    if let Some(value) = &new_extension {
        sets.push(format!("extension = ?{}", params.len() + 1));
        params.push(rusqlite::types::Value::Text(value.clone()));
    }

    sets.push(format!("modified_at = ?{}", params.len() + 1));
    params.push(rusqlite::types::Value::Integer(remote::now_ms()));
    params.push(rusqlite::types::Value::Text(original_url));

    let query = format!(
        "UPDATE media_files SET {} WHERE original_url = ?{} OR path = ?{}",
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

#[tauri::command]
pub async fn media_sync_themes(
    store: State<'_, MediaStore>,
    files: Vec<MediaFileInput>,
) -> Result<(), String> {
    let conn = store.conn.lock().await;

    let mut stmt = conn
        .prepare("SELECT path FROM theme_files")
        .map_err(|e| e.to_string())?;
    let existing = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let mut existing_paths = existing;
    existing_paths.sort_unstable();

    let mut fs_paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    fs_paths.sort_unstable();

    for file in &files {
        if existing_paths.binary_search(&file.path).is_err() {
            conn.execute(
                "INSERT OR IGNORE INTO theme_files (name, path, size, modified_at, extension)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![file.name, file.path, file.size, file.modified_at, file.extension],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    for path in &existing_paths {
        if fs_paths.binary_search(path).is_err() {
            conn.execute("DELETE FROM theme_files WHERE path = ?1", params![path])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn media_list_themes(
    store: State<'_, MediaStore>,
) -> Result<Vec<ThemeFile>, String> {
    let conn = store.conn.lock().await;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, path, size, modified_at, extension FROM theme_files ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ThemeFile {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                size: row.get(3)?,
                modified_at: row.get(4)?,
                extension: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn media_insert_theme(
    store: State<'_, MediaStore>,
    file: MediaFileInput,
    content_hash: Option<String>,
) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute(
        "INSERT OR IGNORE INTO theme_files (name, path, size, modified_at, extension, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            file.name,
            file.path,
            file.size,
            file.modified_at,
            file.extension,
            content_hash
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn media_delete_theme(
    store: State<'_, MediaStore>,
    path: String,
) -> Result<(), String> {
    let conn = store.conn.lock().await;
    conn.execute("DELETE FROM theme_files WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}