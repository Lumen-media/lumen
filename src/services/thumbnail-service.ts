import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

class ThumbnailService {
  private cache = new Map<string, string>();

  async getThumbnail(filePath: string, size = 200): Promise<string> {
    const key = `${filePath}:${size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const cachePath = await invoke<string>('get_thumbnail', { path: filePath, size });
    const bytes = await readFile(cachePath);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));

    this.cache.set(key, blobUrl);
    return blobUrl;
  }
}

export const thumbnailService = new ThumbnailService();
