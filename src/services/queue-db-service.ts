import Database from '@tauri-apps/plugin-sql';
import { getDbPath } from './app-paths';
import type { FileInfo } from './types';

interface QueueRow {
  id: number;
  position: number;
  file_path: string;
  file_name: string;
  file_size: number;
  file_modified_at: number;
  file_extension: string;
  played: number;
}

export interface QueueDbItem extends FileInfo {
  id: number;
  played: boolean;
}

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
        played           INTEGER NOT NULL DEFAULT 0
      )
    `);
    return db;
  }

  async loadQueue(): Promise<QueueDbItem[]> {
    const db = await this.ready();
    const rows = await db.select<QueueRow[]>('SELECT * FROM queue ORDER BY position ASC');
    return rows.map(rowToItem);
  }

  async exists(filePath: string): Promise<boolean> {
    const db = await this.ready();
    const [{ count }] = await db.select<[{ count: number }]>(
      'SELECT COUNT(*) as count FROM queue WHERE file_path = $1',
      [filePath]
    );
    return count > 0;
  }

  async addToQueue(file: FileInfo): Promise<number> {
    const db = await this.ready();
    const [{ max_pos }] = await db.select<[{ max_pos: number | null }]>(
      'SELECT MAX(position) as max_pos FROM queue'
    );
    const result = await db.execute(
      `INSERT INTO queue (position, file_path, file_name, file_size, file_modified_at, file_extension)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        (max_pos ?? -1) + 1,
        file.path,
        file.name,
        file.size,
        file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
        file.extension,
      ]
    );
    return result.lastInsertId!;
  }

  async playNext(file: FileInfo): Promise<number> {
    const db = await this.ready();
    const [{ min_pos }] = await db.select<[{ min_pos: number | null }]>(
      'SELECT MIN(position) as min_pos FROM queue'
    );
    const result = await db.execute(
      `INSERT INTO queue (position, file_path, file_name, file_size, file_modified_at, file_extension)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        (min_pos ?? 1) - 1,
        file.path,
        file.name,
        file.size,
        file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
        file.extension,
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
    await db.execute('UPDATE queue SET played = CASE WHEN played = 0 THEN 1 ELSE 0 END WHERE id = $1', [id]);
  }

  /**
   * Finds the first unplayed item, skipping `excludePath` if provided (same video as currently playing).
   * Marks the found item as played and returns it without deleting it from the queue.
   */
  async shiftQueue(excludePath?: string): Promise<QueueDbItem | null> {
    const db = await this.ready();
    const rows = excludePath
      ? await db.select<QueueRow[]>(
          'SELECT * FROM queue WHERE played = 0 AND file_path != $1 ORDER BY position ASC LIMIT 1',
          [excludePath]
        )
      : await db.select<QueueRow[]>(
          'SELECT * FROM queue WHERE played = 0 ORDER BY position ASC LIMIT 1'
        );

    if (rows.length === 0) return null;
    await db.execute('UPDATE queue SET played = 1 WHERE id = $1', [rows[0].id]);
    return rowToItem(rows[0]);
  }
}

function rowToItem(row: QueueRow): QueueDbItem {
  return {
    id: row.id,
    name: row.file_name,
    path: row.file_path,
    size: row.file_size,
    modifiedAt: new Date(row.file_modified_at),
    extension: row.file_extension,
    played: row.played === 1,
  };
}

export const queueDbService = new QueueDbService();
