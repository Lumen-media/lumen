import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import type { FileInfo } from './types';

const MAX_CONCURRENT = 2;
const REMOTE_THUMB_SIZE = 480;
const REMOTE_THUMB_MIME = 'image/webp';

/**
 * Resolves downscaled blob URLs for thumbnails, hiding all pipeline details.
 *
 * How it works:
 * - Local files go through the Rust `get_thumbnail` command, which downsizes to
 *   the requested size and persists the result on disk under `cache/thumbs/{hash(path)}_{size}.jpg`,
 *   so each size is generated once and survives restarts.
 * - Remote images (http/https) go through the Rust `get_remote_thumbnail` command,
 *   which fetches, downscales to at most `REMOTE_THUMB_SIZE` px and persists the result
 *   as WebP under `cache/remote-thumbs/thumb_{hash(url)}_{size}.webp`
 *   (the same folder/pattern as YouTube thumbnails). Every load reuses that file —
 *   no re-download, no re-process, no full-size decode in the DOM.
 * - Results live in an in-memory Map for the session, and blob URLs are shared
 *   across callers, so the same image shown in many places decodes only once.
 * - Concurrent requests for the same key are deduped (a single fetch/generation),
 *   and disk I/O is throttled to `MAX_CONCURRENT` operations.
 *
 * All entry points return blob URLs owned by this service — callers must NOT revoke them.
 */
class ThumbnailService {
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
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

  /** Returns an already-in-flight promise for `key` or runs `loader`, so N identical requests share one fetch/generation. */
  private withDedup<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const promise = loader();
    this.pending.set(key, promise as Promise<string>);
    promise.finally(() => {
      this.pending.delete(key);
    });
    return promise;
  }

  /**
   * Thumbnail for a local media file. Powered by the Rust `get_thumbnail` command,
   * which downsizes the file and persists it on disk — each size is generated once
   * and reused forever.
   * @param filePath Absolute path of the file.
   * @param size Longest edge in px (default 200). Different sizes are cached separately.
   * @returns A blob URL for the downscaled image. Do not revoke it.
   */
  async getThumbnail(filePath: string, size = 200): Promise<string> {
    const key = `${filePath}:${size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.withDedup(key, () => this.fetchThumbnail(key, filePath, size));
  }

  private async fetchThumbnail(key: string, filePath: string, size: number): Promise<string> {
    const hit = this.cache.get(key);
    if (hit) return hit;

    await this.acquireSlot();
    try {
      const hit2 = this.cache.get(key);
      if (hit2) return hit2;

      const cachePath = await invoke<string>('get_thumbnail', { path: filePath, size });
      const bytes = await readFile(cachePath);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));

      this.cache.set(key, blobUrl);
      return blobUrl;
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Thumbnail for a media file, preferring its pre-generated thumbnail when available.
   * Falls back to a file-system thumbnail for plain files.
   * @param file The file descriptor (`thumbnailPath`/`remoteThumbnailUrl` win when set).
   * @param size Longest edge in px (default 200) for the Rust fallback.
   * @returns A blob URL for the thumbnail. Do not revoke it.
   */
  async getMediaThumbnail(file: FileInfo, size = 200): Promise<string> {
    if (file.extension !== 'url' && !file.originalUrl) {
      return this.getThumbnail(file.path, size);
    }

    const key = `${file.path}:${file.thumbnailPath ?? file.remoteThumbnailUrl ?? ''}:${size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.withDedup(key, () => this.fetchMediaThumbnail(key, file));
  }

  private async fetchMediaThumbnail(key: string, file: FileInfo): Promise<string> {
    const hit = this.cache.get(key);
    if (hit) return hit;

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

  /**
   * Thumbnail for a remote (http/https) image. Powered by the Rust
   * `get_remote_thumbnail` command, which fetches once, downsizes and persists
   * the result as WebP under `cache/remote-thumbs/`, so restarts never
   * re-download or re-process it.
   * @param url The remote image URL.
   * @param maxSize Longest edge in px (default 480).
   * @returns A blob URL for the downscaled image. Do not revoke it.
   */
  async getRemoteThumbnail(url: string, maxSize = REMOTE_THUMB_SIZE): Promise<string> {
    const key = `remote:${url}:${maxSize}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.withDedup(key, async () => {
      const cachePath = await invoke<string>('get_remote_thumbnail', { url, maxSize });
      const bytes = await readFile(cachePath);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: REMOTE_THUMB_MIME }));
      this.cache.set(key, blobUrl);
      return blobUrl;
    });
  }
}

export const thumbnailService = new ThumbnailService();
