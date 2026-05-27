import { exists, mkdir } from '@tauri-apps/plugin-fs';
import Database from '@tauri-apps/plugin-sql';
import { getAppBasePath, getDbPath } from './app-paths';
import { extractMetadata } from './metadata-extractor';
import type { FileInfo, MediaType } from './types';

interface DbRow {
  id: number;
  name: string;
  path: string;
  size: number;
  modified_at: number;
  extension: string;
  media_type: string;
  duration: number | null;
  artist: string | null;
  content: string | null;
}

export interface SearchHit {
  id: number;
  name: string;
  path: string;
  media_type: MediaType;
  artist: string | null;
  duration: number | null;
  modified_at: number;
  rank: number;
}

class MediaDbService {
  private readyPromise: Promise<Database> | null = null;

  private ready(): Promise<Database> {
    if (!this.readyPromise) {
      this.readyPromise = this.connect();
    }
    return this.readyPromise;
  }

  private async connect(): Promise<Database> {
    const basePath = await getAppBasePath();
    if (!(await exists(basePath))) {
      await mkdir(basePath, { recursive: true });
    }

    const db = await Database.load(await getDbPath());
    await db.execute(`
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
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_mf_type ON media_files (media_type)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_mf_name ON media_files (name COLLATE NOCASE)`);

    const cols = await db.select<{ name: string }[]>('PRAGMA table_info(media_files)');
    if (!cols.some((c) => c.name === 'content')) {
      await db.execute(`ALTER TABLE media_files ADD COLUMN content TEXT`);
    }

    await db.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS media_search USING fts5(
        name,
        artist,
        content,
        content='media_files',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      )
    `);

    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS media_files_ai AFTER INSERT ON media_files BEGIN
        INSERT INTO media_search (rowid, name, artist, content)
        VALUES (new.id, new.name, COALESCE(new.artist, ''), COALESCE(new.content, ''));
      END
    `);
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS media_files_ad AFTER DELETE ON media_files BEGIN
        INSERT INTO media_search (media_search, rowid, name, artist, content)
        VALUES ('delete', old.id, old.name, COALESCE(old.artist, ''), COALESCE(old.content, ''));
      END
    `);
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS media_files_au AFTER UPDATE ON media_files BEGIN
        INSERT INTO media_search (media_search, rowid, name, artist, content)
        VALUES ('delete', old.id, old.name, COALESCE(old.artist, ''), COALESCE(old.content, ''));
        INSERT INTO media_search (rowid, name, artist, content)
        VALUES (new.id, new.name, COALESCE(new.artist, ''), COALESCE(new.content, ''));
      END
    `);

    const ftsCount = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM media_search');
    if ((ftsCount[0]?.n ?? 0) === 0) {
      await db.execute(`
        INSERT INTO media_search (rowid, name, artist, content)
        SELECT id, name, COALESCE(artist, ''), COALESCE(content, '') FROM media_files
      `);
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS theme_files (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        path        TEXT    NOT NULL UNIQUE,
        size        INTEGER NOT NULL DEFAULT 0,
        modified_at INTEGER NOT NULL DEFAULT 0,
        extension   TEXT    NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_tf_name ON theme_files (name COLLATE NOCASE)`);

    return db;
  }

  async initialize(): Promise<void> {
    await this.ready();
  }

  async syncMediaType(mediaType: MediaType, fsFiles: FileInfo[]): Promise<void> {
    const db = await this.ready();

    const existing = await db.select<{ path: string }[]>(
      'SELECT path FROM media_files WHERE media_type = $1',
      [mediaType]
    );
    const existingPaths = new Set(existing.map((r) => r.path));
    const fsPaths = new Set(fsFiles.map((f) => f.path));

    for (const file of fsFiles) {
      if (!existingPaths.has(file.path)) {
        let metadata: { duration?: number; artist?: string } = {};
        try {
          metadata = await extractMetadata(file.path);
        } catch {}

        await db.execute(
          `INSERT OR IGNORE INTO media_files (name, path, size, modified_at, extension, media_type, duration, artist, content)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            file.name,
            file.path,
            file.size,
            file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
            file.extension,
            mediaType,
            metadata.duration ?? null,
            metadata.artist ?? null,
            null,
          ]
        );
      }
    }

    for (const { path } of existing) {
      if (!fsPaths.has(path)) {
        await db.execute('DELETE FROM media_files WHERE path = $1', [path]);
      }
    }
  }

  async listFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const db = await this.ready();
    const rows = await db.select<DbRow[]>(
      'SELECT * FROM media_files WHERE media_type = $1 ORDER BY name COLLATE NOCASE',
      [mediaType]
    );
    return rows.map(rowToFileInfo);
  }

  async searchFiles(mediaType: MediaType, query: string): Promise<FileInfo[]> {
    const db = await this.ready();
    const rows = await db.select<DbRow[]>(
      `SELECT * FROM media_files WHERE media_type = $1 AND name LIKE $2 ESCAPE '\\'
       ORDER BY name COLLATE NOCASE`,
      [mediaType, `%${escapeLike(query)}%`]
    );
    return rows.map(rowToFileInfo);
  }

  async insertFile(file: FileInfo, mediaType: MediaType, content?: string): Promise<void> {
    const db = await this.ready();

    let metadata: { duration?: number; artist?: string } = {};
    try {
      metadata = await extractMetadata(file.path);
    } catch {}

    await db.execute(
      `INSERT INTO media_files (name, path, size, modified_at, extension, media_type, duration, artist, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(path) DO UPDATE SET
         name        = excluded.name,
         size        = excluded.size,
         modified_at = excluded.modified_at,
         extension   = excluded.extension,
         duration    = excluded.duration,
         artist      = excluded.artist,
         content     = COALESCE(excluded.content, media_files.content)`,
      [
        file.name,
        file.path,
        file.size,
        file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
        file.extension,
        mediaType,
        metadata.duration ?? null,
        metadata.artist ?? null,
        content ?? null,
      ]
    );
  }

  async search(
    query: string,
    opts: { mediaType?: MediaType; fullContent?: boolean; limit?: number } = {}
  ): Promise<SearchHit[]> {
    const db = await this.ready();
    const limit = opts.limit ?? 50;
    const term = sanitizeFtsTerm(query);
    if (!term) return [];

    const columns = opts.fullContent ? 'name OR artist OR content' : 'name OR artist';
    const matchExpr = `{${columns}} : ${term}`;

    const params: unknown[] = [matchExpr];
    let typeFilter = '';
    if (opts.mediaType) {
      typeFilter = ' AND mf.media_type = $2';
      params.push(opts.mediaType);
    }
    params.push(limit);
    const limitIdx = params.length;

    const rows = await db.select<SearchHit[]>(
      `SELECT mf.id, mf.name, mf.path, mf.media_type, mf.artist, mf.duration, mf.modified_at,
              bm25(media_search) AS rank
         FROM media_search
         JOIN media_files mf ON mf.id = media_search.rowid
        WHERE media_search MATCH $1${typeFilter}
        ORDER BY rank
        LIMIT $${limitIdx}`,
      params
    );
    return rows;
  }

  async listByType(mediaType: MediaType, limit = 50): Promise<SearchHit[]> {
    const db = await this.ready();
    const rows = await db.select<SearchHit[]>(
      `SELECT id, name, path, media_type, artist, duration, modified_at, 0 AS rank
         FROM media_files
        WHERE media_type = $1
        ORDER BY name COLLATE NOCASE
        LIMIT $2`,
      [mediaType, limit]
    );
    return rows;
  }

  async getById(id: number): Promise<SearchHit | null> {
    const db = await this.ready();
    const rows = await db.select<SearchHit[]>(
      `SELECT id, name, path, media_type, artist, duration, modified_at, 0 AS rank
         FROM media_files
        WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async getByPath(path: string): Promise<SearchHit | null> {
    const db = await this.ready();
    const rows = await db.select<SearchHit[]>(
      `SELECT id, name, path, media_type, artist, duration, modified_at, 0 AS rank
         FROM media_files
        WHERE path = $1`,
      [path]
    );
    return rows[0] ?? null;
  }

  async deleteFile(path: string): Promise<void> {
    const db = await this.ready();
    await db.execute('DELETE FROM media_files WHERE path = $1', [path]);
  }

  async syncThemes(fsFiles: FileInfo[]): Promise<void> {
    const db = await this.ready();
    const existing = await db.select<{ path: string }[]>('SELECT path FROM theme_files');
    const existingPaths = new Set(existing.map((r) => r.path));
    const fsPaths = new Set(fsFiles.map((f) => f.path));

    for (const file of fsFiles) {
      if (!existingPaths.has(file.path)) {
        await db.execute(
          `INSERT OR IGNORE INTO theme_files (name, path, size, modified_at, extension)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            file.name,
            file.path,
            file.size,
            file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
            file.extension,
          ]
        );
      }
    }

    for (const { path } of existing) {
      if (!fsPaths.has(path)) {
        await db.execute('DELETE FROM theme_files WHERE path = $1', [path]);
      }
    }
  }

  async listThemes(): Promise<FileInfo[]> {
    const db = await this.ready();
    const rows = await db.select<Omit<DbRow, 'media_type' | 'duration' | 'artist'>[]>(
      'SELECT * FROM theme_files ORDER BY name COLLATE NOCASE'
    );
    return rows.map((row) => ({
      name: row.name,
      path: row.path,
      size: row.size,
      modifiedAt: new Date(row.modified_at),
      extension: row.extension,
    }));
  }

  async insertTheme(file: FileInfo): Promise<void> {
    const db = await this.ready();
    await db.execute(
      `INSERT OR IGNORE INTO theme_files (name, path, size, modified_at, extension)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        file.name,
        file.path,
        file.size,
        file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
        file.extension,
      ]
    );
  }
  async deleteTheme(path: string): Promise<void> {
    const db = await this.ready();
    await db.execute('DELETE FROM theme_files WHERE path = $1', [path]);
  }
}

function rowToFileInfo(row: DbRow): FileInfo {
  return {
    name: row.name,
    path: row.path,
    size: row.size,
    modifiedAt: new Date(row.modified_at),
    extension: row.extension,
    duration: row.duration ?? undefined,
    artist: row.artist ?? undefined,
  };
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function sanitizeFtsTerm(raw: string): string {
  const tokens = raw
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' AND ');
}

export const mediaDbService = new MediaDbService();
