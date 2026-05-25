use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleEntry {
    pub id: String,
    pub version: String,
    pub source: String,
    pub enabled: bool,
    pub path: PathBuf,
}

pub struct Registry {
    conn: Connection,
}

impl Registry {
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

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE modules SET enabled = ?1 WHERE id = ?2",
            params![enabled as i64, id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM modules WHERE id = ?1", params![id])?;
        Ok(())
    }
}
