import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { getAppBasePath } from './app-paths';
import type { FileInfo } from './types';

const MAX_CONCURRENT = 2;
const REMOTE_THUMB_SIZE = 480;
const REMOTE_THUMB_MIME = 'image/webp';
const REMOTE_THUMB_QUALITY = 0.8;

/**
 * Resolves downscaled blob URLs for thumbnails, hiding all pipeline details.
 *
 * How it works:
 * - Local files go through the Rust `get_thumbnail` command, which downsizes to
 *   the requested size and persists the result on disk under `cache/thumbs/{hash(path)}_{size}.jpg`,
 *   so each size is generated once and survives restarts.
 * - Remote images (http/https) are fetched, downscaled on a canvas to at most
 *   `REMOTE_THUMB_SIZE` px and persisted as WebP under `cache/remote-thumbs/thumb_{hash(url)}_{size}.webp`
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
  private remoteThumbsDir: Promise<string> | null = null;

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

  private remoteThumbsDirPath(): Promise<string> {
    if (!this.remoteThumbsDir) {
      this.remoteThumbsDir = getAppBasePath().then(async (base) => {
        const dir = await join(base, 'cache', 'remote-thumbs');
        await mkdir(dir, { recursive: true });
        return dir;
      });
    }
    return this.remoteThumbsDir;
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
   * Thumbnail for a remote (http/https) image. Fetches once, downsizes on a canvas
   * and persists the result as WebP under `cache/remote-thumbs/` (the same folder
   * as YouTube thumbnails), so restarts never re-download or re-process it.
   * @param url The remote image URL.
   * @param maxSize Longest edge in px (default 480).
   * @returns A blob URL for the downscaled image. Do not revoke it.
   */
  async getRemoteThumbnail(url: string, maxSize = REMOTE_THUMB_SIZE): Promise<string> {
    const key = `remote:${url}:${maxSize}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.withDedup(key, async () => {
      const dir = await this.remoteThumbsDirPath();
      const hash = await sha256Hex(url);
      const filePath = await join(dir, `thumb_${hash}_${maxSize}.webp`);

      if (await exists(filePath)) {
        const bytes = await readFile(filePath);
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: REMOTE_THUMB_MIME }));
        this.cache.set(key, blobUrl);
        return blobUrl;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch remote image: ${response.status}`);
      const blob = await response.blob();

      const thumbBlob = await downscaleBlob(blob, maxSize, REMOTE_THUMB_MIME, REMOTE_THUMB_QUALITY);
      const bytes = new Uint8Array(await thumbBlob.arrayBuffer());
      await writeFile(filePath, bytes);

      const blobUrl = URL.createObjectURL(thumbBlob);
      this.cache.set(key, blobUrl);
      return blobUrl;
    });
  }
}

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

function downscaleBlob(
  blob: Blob,
  maxSize: number,
  mimeType = 'image/jpeg',
  quality = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (out) => {
            if (out) {
              resolve(out);
              return;
            }
            canvas.toBlob(
              (out2) => {
                resolve(out2 ?? blob);
              },
              'image/jpeg',
              quality
            );
          },
          mimeType,
          quality
        );
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('remote image decode failed'));
    };
    img.src = url;
  });
}

export const thumbnailService = new ThumbnailService();
