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
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_mf_type ON media_files (media_type)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_mf_name ON media_files (name COLLATE NOCASE)`);
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
          `INSERT OR IGNORE INTO media_files (name, path, size, modified_at, extension, media_type, duration, artist)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            file.name,
            file.path,
            file.size,
            file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
            file.extension,
            mediaType,
            metadata.duration ?? null,
            metadata.artist ?? null,
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

  async insertFile(file: FileInfo, mediaType: MediaType): Promise<void> {
    const db = await this.ready();

    let metadata: { duration?: number; artist?: string } = {};
    try {
      metadata = await extractMetadata(file.path);
    } catch {}

    await db.execute(
      `INSERT OR IGNORE INTO media_files (name, path, size, modified_at, extension, media_type, duration, artist)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        file.name,
        file.path,
        file.size,
        file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
        file.extension,
        mediaType,
        metadata.duration ?? null,
        metadata.artist ?? null,
      ]
    );
  }

  async deleteFile(path: string): Promise<void> {
    const db = await this.ready();
    await db.execute('DELETE FROM media_files WHERE path = $1', [path]);
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

export const mediaDbService = new MediaDbService();
