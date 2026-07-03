import Database from '@tauri-apps/plugin-sql';
import { getDbPath } from './app-paths';
import type { FileInfo } from './types';
import { urlMediaService } from './url-media-service';

interface QueueRow {
  id: number;
  position: number;
  file_path: string;
  file_name: string;
  file_size: number;
  file_modified_at: number;
  file_extension: string;
  played: number;
  duration: number | null;
  title: string | null;
  artist: string | null;
  original_url: string | null;
  thumbnail_path: string | null;
  remote_thumbnail_url: string | null;
  download_status: string | null;
}

export interface QueueDbItem extends FileInfo {
  id: number;
  played: boolean;
}

type ColumnSpec = {
  name: string;
  sql: string;
};

const QUEUE_URL_COLUMNS: ColumnSpec[] = [
  { name: 'original_url', sql: 'ALTER TABLE queue ADD COLUMN original_url TEXT' },
  { name: 'thumbnail_path', sql: 'ALTER TABLE queue ADD COLUMN thumbnail_path TEXT' },
  { name: 'remote_thumbnail_url', sql: 'ALTER TABLE queue ADD COLUMN remote_thumbnail_url TEXT' },
  {
    name: 'download_status',
    sql: "ALTER TABLE queue ADD COLUMN download_status TEXT NOT NULL DEFAULT 'downloaded'",
  },
];

class QueueDbService {
  private readyPromise: Promise<Database> | null = null;

  private ready(): Promise<Database> {
    if (!this.readyPromise) {
      this.readyPromise = this.connect();
    }
    return this.readyPromise;
  }

  private async connect(): Promise<Database> {
    const db = await Database.load(await getDbPath());
    await db.execute(`
      CREATE TABLE IF NOT EXISTS queue (
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
      )
    `);
    await this.ensureColumns(db, 'queue', QUEUE_URL_COLUMNS);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_queue_original_url ON queue (original_url)`);
    return db;
  }

  private async ensureColumns(
    db: Database,
    tableName: string,
    columns: ColumnSpec[]
  ): Promise<void> {
    const existing = await db.select<{ name: string }[]>(`PRAGMA table_info(${tableName})`);
    const names = new Set(existing.map((column) => column.name));
    for (const column of columns) {
      if (!names.has(column.name)) {
        await db.execute(column.sql);
      }
    }
  }

  async loadQueue(): Promise<QueueDbItem[]> {
    const db = await this.ready();
    const rows = await db.select<QueueRow[]>('SELECT * FROM queue ORDER BY position ASC');
    return rows.map(rowToItem);
  }

  async exists(filePath: string): Promise<boolean> {
    const db = await this.ready();
    const parsed = urlMediaService.parseYouTubeUrl(filePath);
    const sourceUrl = parsed?.canonicalUrl ?? filePath;
    const [{ count }] = await db.select<[{ count: number }]>(
      'SELECT COUNT(*) as count FROM queue WHERE file_path = $1 OR original_url = $2',
      [sourceUrl, sourceUrl]
    );
    return count > 0;
  }

  async addToQueue(file: FileInfo): Promise<number> {
    const db = await this.ready();
    const [{ max_pos }] = await db.select<[{ max_pos: number | null }]>(
      'SELECT MAX(position) as max_pos FROM queue'
    );
    return this.insertAtPosition(db, file, (max_pos ?? -1) + 1);
  }

  async playNext(file: FileInfo): Promise<number> {
    const db = await this.ready();
    const [{ min_pos }] = await db.select<[{ min_pos: number | null }]>(
      'SELECT MIN(position) as min_pos FROM queue'
    );
    return this.insertAtPosition(db, file, (min_pos ?? 1) - 1);
  }

  async addUrlToQueue(url: string): Promise<number> {
    const file = await urlMediaService.createYouTubeFileInfo(url);
    return this.addToQueue(file);
  }

  private async insertAtPosition(db: Database, file: FileInfo, position: number): Promise<number> {
    const result = await db.execute(
      `INSERT INTO queue (
         position, file_path, file_name, file_size, file_modified_at, file_extension,
         duration, title, artist, original_url, thumbnail_path, remote_thumbnail_url, download_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        position,
        file.path,
        file.title ?? file.name,
        file.size,
        file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
        file.extension,
        file.duration ?? null,
        file.title ?? null,
        file.artist ?? null,
        file.originalUrl ?? null,
        file.thumbnailPath ?? null,
        file.remoteThumbnailUrl ?? null,
        file.downloadStatus ?? (file.extension === 'url' ? 'not_downloaded' : 'downloaded'),
      ]
    );
    return result.lastInsertId!;
  }

  async removeFromQueue(id: number): Promise<void> {
    const db = await this.ready();
    await db.execute('DELETE FROM queue WHERE id = $1', [id]);
  }

  async markPlayed(id: number): Promise<void> {
    const db = await this.ready();
    await db.execute('UPDATE queue SET played = 1 WHERE id = $1', [id]);
  }

  async togglePlayed(id: number): Promise<void> {
    const db = await this.ready();
    await db.execute(
      'UPDATE queue SET played = CASE WHEN played = 0 THEN 1 ELSE 0 END WHERE id = $1',
      [id]
    );
  }

  /**
   * Finds the first unplayed item, skipping `excludePath` if provided (same video as currently playing).
   * Marks the found item as played and returns it without deleting it from the queue.
   */
  async shiftQueue(excludePath?: string): Promise<QueueDbItem | null> {
    const db = await this.ready();
    const parsed = excludePath ? urlMediaService.parseYouTubeUrl(excludePath) : null;
    const normalizedExcludePath = parsed?.canonicalUrl ?? excludePath;
    const rows = normalizedExcludePath
      ? await db.select<QueueRow[]>(
          'SELECT * FROM queue WHERE played = 0 AND file_path != $1 ORDER BY position ASC LIMIT 1',
          [normalizedExcludePath]
        )
      : await db.select<QueueRow[]>(
          'SELECT * FROM queue WHERE played = 0 ORDER BY position ASC LIMIT 1'
        );

    if (rows.length === 0) return null;
    await db.execute('UPDATE queue SET played = 1 WHERE id = $1', [rows[0].id]);
    return rowToItem(rows[0]);
  }

  async clearQueue(): Promise<void> {
    const db = await this.ready();
    await db.execute('DELETE FROM queue');
  }

  async reorderQueue(orderedIds: number[]): Promise<void> {
    const db = await this.ready();
    for (let i = 0; i < orderedIds.length; i++) {
      await db.execute('UPDATE queue SET position = $1 WHERE id = $2', [i, orderedIds[i]]);
    }
  }

  async shuffleQueue(): Promise<void> {
    const db = await this.ready();
    const rows = await db.select<QueueRow[]>('SELECT * FROM queue ORDER BY position ASC');
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      await db.execute('UPDATE queue SET position = $1 WHERE id = $2', [i, shuffled[i].id]);
    }
  }

  async updateMetadata(
    filePath: string,
    metadata: {
      duration?: number;
      title?: string;
      artist?: string;
      thumbnailPath?: string;
      remoteThumbnailUrl?: string;
    }
  ): Promise<void> {
    const db = await this.ready();
    const updates: string[] = [];
    const values: (number | string | null)[] = [];

    if (metadata.duration !== undefined) {
      updates.push(`duration = $${updates.length + 1}`);
      values.push(metadata.duration);
    }
    if (metadata.title !== undefined) {
      updates.push(`title = $${updates.length + 1}`);
      values.push(metadata.title);
    }
    if (metadata.artist !== undefined) {
      updates.push(`artist = $${updates.length + 1}`);
      values.push(metadata.artist);
    }
    if (metadata.thumbnailPath !== undefined) {
      updates.push(`thumbnail_path = $${updates.length + 1}`);
      values.push(metadata.thumbnailPath);
    }
    if (metadata.remoteThumbnailUrl !== undefined) {
      updates.push(`remote_thumbnail_url = $${updates.length + 1}`);
      values.push(metadata.remoteThumbnailUrl);
    }

    if (updates.length === 0) return;

    const parsed = urlMediaService.parseYouTubeUrl(filePath);
    const sourceUrl = parsed?.canonicalUrl ?? filePath;
    values.push(sourceUrl);
    const query = `UPDATE queue SET ${updates.join(', ')} WHERE file_path = $${values.length} OR original_url = $${values.length}`;
    await db.execute(query, values);
  }
}

function isDownloadStatus(value: string | null): value is NonNullable<FileInfo['downloadStatus']> {
  return value === 'not_downloaded' || value === 'downloaded' || value === 'missing';
}

function rowToItem(row: QueueRow): QueueDbItem {
  return {
    id: row.id,
    name: row.title ?? row.file_name,
    path: row.file_path,
    size: row.file_size,
    modifiedAt: new Date(row.file_modified_at),
    extension: row.file_extension,
    played: row.played === 1,
    duration: row.duration ?? undefined,
    title: row.title ?? row.file_name,
    artist: row.artist ?? undefined,
    originalUrl: row.original_url ?? undefined,
    thumbnailPath: row.thumbnail_path ?? undefined,
    remoteThumbnailUrl: row.remote_thumbnail_url ?? undefined,
    downloadStatus: isDownloadStatus(row.download_status)
      ? row.download_status
      : row.file_extension === 'url'
        ? 'not_downloaded'
        : 'downloaded',
  };
}

export const queueDbService = new QueueDbService();
