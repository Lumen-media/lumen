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
    await db.execute(`DROP TRIGGER IF EXISTS mf_ai`);
    await db.execute(`DROP TRIGGER IF EXISTS mf_au`);
    await db.execute(`DROP TRIGGER IF EXISTS mf_ad`);
    await db.execute(`DROP TABLE IF EXISTS media_search`);
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
      `SELECT * FROM media_files WHERE media_type = $1 AND name LIKE $2 ESCAPE '#'
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
    const trimmed = query.trim();
    if (!trimmed) return [];

    const terms = trimmed.split(/\s+/).filter(Boolean);
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    for (const term of terms) {
      const like = `%${escapeLike(term)}%`;
      if (opts.fullContent) {
        conditions.push(
          `(name LIKE $${paramIdx} ESCAPE '#' OR COALESCE(artist, '') LIKE $${paramIdx + 1} ESCAPE '#' OR COALESCE(content, '') LIKE $${paramIdx + 2} ESCAPE '#')`
        );
        params.push(like, like, like);
        paramIdx += 3;
      } else {
        conditions.push(
          `(name LIKE $${paramIdx} ESCAPE '#' OR COALESCE(artist, '') LIKE $${paramIdx + 1} ESCAPE '#')`
        );
        params.push(like, like);
        paramIdx += 2;
      }
    }

    let typeFilter = '';
    if (opts.mediaType) {
      typeFilter = ` AND media_type = $${paramIdx}`;
      params.push(opts.mediaType);
      paramIdx++;
    }
    params.push(limit);

    const rows = await db.select<DbRow[]>(
      `SELECT * FROM media_files WHERE ${conditions.join(' AND ')}${typeFilter}
       ORDER BY name COLLATE NOCASE LIMIT $${paramIdx}`,
      params
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      media_type: r.media_type as MediaType,
      artist: r.artist,
      duration: r.duration,
      modified_at: r.modified_at,
      rank: 0,
    }));
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
  return s.replace(/#/g, '##').replace(/%/g, '#%').replace(/_/g, '#_');
}


export const mediaDbService = new MediaDbService();
