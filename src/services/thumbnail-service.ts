import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

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
}

export const thumbnailService = new ThumbnailService();
