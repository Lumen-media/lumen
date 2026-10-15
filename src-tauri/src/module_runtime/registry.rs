//! Persistent registry of installed modules.
//!
//! The registry is the SQLite-backed index of every module Lumen knows about,
//! enabled or not. It stores the minimal metadata needed to locate a module on
//! disk ([`ModuleEntry`]) and is created lazily by [`Registry::open`].
//!
//! The database lives at `<app_data_dir>/lumen.sqlite` (see
//! [`crate::module_runtime::ModuleRuntime::init`]) and holds a single `modules`
//! table:
//!
//! | column    | type    | notes                                    |
//! |-----------|---------|------------------------------------------|
//! | `id`      | TEXT PK | reverse-DNS module id                    |
//! | `version` | TEXT    | module version string                    |
//! | `source`  | TEXT    | `sideload`, `dev` or `store`             |
//! | `enabled` | INTEGER | `0`/`1` flag                             |
//! | `path`    | TEXT    | absolute path to the module root on disk |
//!
//! Manifest contents are intentionally *not* stored here; they are read from
//! disk and cached by [`crate::module_runtime::ModuleRuntime`] instead.

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single row of the module registry.
///
/// Serialized directly to the frontend as part of
/// [`crate::module_runtime::InstalledModule`] and by the dev server's module
/// listing endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleEntry {
    /// Reverse-DNS module identifier (primary key).
    pub id: String,
    /// Version string recorded at install time.
    pub version: String,
    /// How the module was installed: `"sideload"`, `"dev"` or `"store"`.
    pub source: String,
    /// Whether the module is currently enabled.
    ///
    /// Disabled modules are not served over the `lumen-module://` protocol.
    pub enabled: bool,
    /// Absolute path to the module root directory on disk.
    pub path: PathBuf,
}

/// SQLite-backed store of installed module entries.
///
/// Holds an open [`rusqlite::Connection`] for the process lifetime. Access is
/// serialized by the [`std::sync::Mutex`] held in
/// [`crate::module_runtime::ModuleRuntime::registry`].
pub struct Registry {
    conn: Connection,
}

impl Registry {
    /// Opens (creating if needed) the registry database at `db_path`.
    ///
    /// Creates the `modules` table on first use; existing data is preserved.
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the database file cannot be opened or
    /// the schema statement fails to execute.
    pub fn open(db_path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS modules (
                id      TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                source  TEXT NOT NULL DEFAULT 'sideload',
                enabled INTEGER NOT NULL DEFAULT 1,
                path    TEXT NOT NULL
            );",
        )?;
        Ok(Self { conn })
    }

    /// Lists only the entries with `enabled = 1`.
    ///
    /// Backs the [`crate::module_runtime::module_list_installed`] Tauri command.
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the query or row decoding fails.
    pub fn list_enabled(&self) -> Result<Vec<ModuleEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, version, source, enabled, path FROM modules WHERE enabled = 1",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ModuleEntry {
                id: row.get(0)?,
                version: row.get(1)?,
                source: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                path: PathBuf::from(row.get::<_, String>(4)?),
            })
        })?;
        rows.collect()
    }

    /// Lists every registered entry, enabled or not.
    ///
    /// Used by the dev server (`GET /modules`).
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the query or row decoding fails.
    pub fn list_all(&self) -> Result<Vec<ModuleEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, version, source, enabled, path FROM modules",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ModuleEntry {
                id: row.get(0)?,
                version: row.get(1)?,
                source: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                path: PathBuf::from(row.get::<_, String>(4)?),
            })
        })?;
        rows.collect()
    }

    /// Looks up a single entry by `id`.
    ///
    /// # Returns
    ///
    /// `Ok(Some(entry))` when found, `Ok(None)` when no row matches.
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the query or row decoding fails.
    pub fn get(&self, id: &str) -> Result<Option<ModuleEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, version, source, enabled, path FROM modules WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(ModuleEntry {
                id: row.get(0)?,
                version: row.get(1)?,
                source: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                path: PathBuf::from(row.get::<_, String>(4)?),
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    /// Inserts `entry`, replacing any existing row with the same `id`.
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the statement fails.
    pub fn insert(&self, entry: &ModuleEntry) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO modules (id, version, source, enabled, path)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                entry.id,
                entry.version,
                entry.source,
                entry.enabled as i64,
                entry.path.to_string_lossy(),
            ],
        )?;
        Ok(())
    }

    /// Sets the `enabled` flag of the entry identified by `id`.
    ///
    /// A no-op if `id` is not present in the table.
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the statement fails.
    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE modules SET enabled = ?1 WHERE id = ?2",
            params![enabled as i64, id],
        )?;
        Ok(())
    }

    /// Deletes the entry identified by `id`.
    ///
    /// Does not touch the module's files on disk; callers (for example
    /// [`crate::module_runtime::module_uninstall`]) are responsible for
    /// removing the directory.
    ///
    /// # Errors
    ///
    /// Propagates [`rusqlite::Error`] if the statement fails.
    pub fn remove(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM modules WHERE id = ?1", params![id])?;
        Ok(())
    }
}
