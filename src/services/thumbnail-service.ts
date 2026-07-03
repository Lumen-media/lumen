import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import type { FileInfo } from './types';

const MAX_CONCURRENT = 2;

class ThumbnailService {
  private cache = new Map<string, string>();
  private active = 0;
  private queue: Array<() => void> = [];

  private acquireSlot(): Promise<void> {
    if (this.active < MAX_CONCURRENT) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.active--;
    this.queue.shift()?.();
  }

  async getThumbnail(filePath: string, size = 200): Promise<string> {
    const key = `${filePath}:${size}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    await this.acquireSlot();
    try {
      const hit = this.cache.get(key);
      if (hit) return hit;

      const cachePath = await invoke<string>('get_thumbnail', { path: filePath, size });
      const bytes = await readFile(cachePath);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));

      this.cache.set(key, blobUrl);
      return blobUrl;
    } finally {
      this.releaseSlot();
    }
  }

  async getMediaThumbnail(file: FileInfo, size = 200): Promise<string> {
    if (file.extension !== 'url' && !file.originalUrl) {
      return this.getThumbnail(file.path, size);
    }

    const key = `${file.path}:${file.thumbnailPath ?? file.remoteThumbnailUrl ?? ''}:${size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    if (file.thumbnailPath) {
      const bytes = await readFile(file.thumbnailPath);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      this.cache.set(key, blobUrl);
      return blobUrl;
    }

    if (file.remoteThumbnailUrl) {
      const response = await fetch(file.remoteThumbnailUrl);
      if (!response.ok) throw new Error(`Failed to load remote thumbnail: ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      this.cache.set(key, blobUrl);
      return blobUrl;
    }

    throw new Error('No thumbnail available');
  }
}

export const thumbnailService = new ThumbnailService();
