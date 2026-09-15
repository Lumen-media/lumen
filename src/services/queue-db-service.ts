import { invoke } from '@tauri-apps/api/core';
import type { FileInfo } from './types';

export interface QueueDbItem extends FileInfo {
  id: number;
  played: boolean;
}

interface QueueRow {
  id: number;
  position: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  fileModifiedAt: number;
  fileExtension: string;
  played: number;
  duration: number | null;
  title: string | null;
  artist: string | null;
  originalUrl: string | null;
  thumbnailPath: string | null;
  remoteThumbnailUrl: string | null;
  downloadStatus: string | null;
}

interface QueueFileInput {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  extension: string;
  duration?: number | null;
  title?: string | null;
  artist?: string | null;
  originalUrl?: string | null;
  thumbnailPath?: string | null;
  remoteThumbnailUrl?: string | null;
  downloadStatus?: string | null;
}

function toQueueFileInput(file: FileInfo): QueueFileInput {
  return {
    name: file.title ?? file.name,
    path: file.path,
    size: file.size,
    modifiedAt: file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
    extension: file.extension,
    duration: file.duration ?? null,
    title: file.title ?? null,
    artist: file.artist ?? null,
    originalUrl: file.originalUrl ?? null,
    thumbnailPath: file.thumbnailPath ?? null,
    remoteThumbnailUrl: file.remoteThumbnailUrl ?? null,
    downloadStatus: file.downloadStatus ?? null,
  };
}

function toDbItem(item: QueueDbItem & { modifiedAt: number }): QueueDbItem {
  return { ...item, modifiedAt: new Date(item.modifiedAt) };
}

class QueueDbService {
  async loadQueue(): Promise<QueueDbItem[]> {
    const items = await invoke<Array<QueueDbItem & { modifiedAt: number }>>('queue_load');
    return items.map(toDbItem);
  }

  async loadAllRows(): Promise<QueueRow[]> {
    return invoke<QueueRow[]>('queue_load_rows');
  }

  async addTriggerEntry(
    entryId: string,
    triggerId: string,
    configJson: string,
    title: string,
    tag: string
  ): Promise<number> {
    return invoke<number>('queue_add_trigger_entry', { entryId, triggerId, configJson, title, tag });
  }

  async removeTriggerEntry(entryId: string): Promise<void> {
    await invoke('queue_remove_trigger_entry', { entryId });
  }

  async toggleTriggerPlayed(entryId: string): Promise<void> {
    await invoke('queue_toggle_trigger_played', { entryId });
  }

  async loadTriggerEntries(): Promise<QueueRow[]> {
    return invoke<QueueRow[]>('queue_load_trigger_entries');
  }

  async exists(filePath: string): Promise<boolean> {
    return invoke<boolean>('queue_exists', { filePath });
  }

  async addToQueue(file: FileInfo): Promise<number> {
    return invoke<number>('queue_add_to_queue', { file: toQueueFileInput(file) });
  }

  async playNext(file: FileInfo): Promise<number> {
    return invoke<number>('queue_play_next', { file: toQueueFileInput(file) });
  }

  async addUrlToQueue(url: string): Promise<number> {
    return invoke<number>('queue_add_url_to_queue', { url });
  }

  async removeFromQueue(id: number): Promise<void> {
    await invoke('queue_remove', { id });
  }

  async markPlayed(id: number): Promise<void> {
    await invoke('queue_mark_played', { id });
  }

  async togglePlayed(id: number): Promise<void> {
    await invoke('queue_toggle_played', { id });
  }

  /**
   * Finds the first unplayed item, skipping `excludePath` if provided (same video as currently playing).
   * Marks the found item as played and returns it without deleting it from the queue.
   */
  async shiftQueue(excludePath?: string): Promise<QueueDbItem | null> {
    const item = await invoke<QueueDbItem | null>('queue_shift', {
      excludePath: excludePath ?? null,
    });
    return item ? (toDbItem(item as QueueDbItem & { modifiedAt: number }) ?? null) : null;
  }

  async clearQueue(): Promise<void> {
    await invoke('queue_clear');
  }

  async reorderQueue(orderedIds: number[]): Promise<void> {
    await invoke('queue_reorder', { orderedIds });
  }

  async updateAllPositions(
    idUpdates: { id: number; position: number }[],
    pathUpdates: { path: string; position: number }[]
  ): Promise<void> {
    await invoke('queue_update_all_positions', { idUpdates, pathUpdates });
  }

  async shuffleQueue(): Promise<void> {
    await invoke('queue_shuffle');
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
    await invoke('queue_update_metadata', { filePath, metadata });
  }
}

export function rowToItem(row: QueueRow): QueueDbItem {
  const valid = (value: string | null): boolean =>
    value === 'not_downloaded' || value === 'downloaded' || value === 'missing';

  return {
    id: row.id,
    name: row.title ?? row.fileName,
    path: row.filePath,
    size: row.fileSize,
    modifiedAt: new Date(row.fileModifiedAt),
    extension: row.fileExtension,
    played: row.played === 1,
    duration: row.duration ?? undefined,
    title: row.title ?? row.fileName,
    artist: row.artist ?? undefined,
    originalUrl: row.originalUrl ?? undefined,
    thumbnailPath: row.thumbnailPath ?? undefined,
    remoteThumbnailUrl: row.remoteThumbnailUrl ?? undefined,
    downloadStatus: valid(row.downloadStatus)
      ? row.downloadStatus as NonNullable<FileInfo['downloadStatus']>
      : row.fileExtension === 'url'
        ? 'not_downloaded'
        : 'downloaded',
  };
}

export const queueDbService = new QueueDbService();