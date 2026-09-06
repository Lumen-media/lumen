import { join } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs';
import { getAppBasePath } from './app-paths';

type PresentationPreviewMeta = {
  filePath: string;
  fileSize: number;
  mtimeMs: number;
  slideCount: number;
};

export interface CachedPresentationPreviews {
  slideCount: number;
  thumbnails: string[];
}

/**
 * Disk-backed, session-sticky cache for the slide thumbnails shown in the
 * Presentations tab.
 *
 * Layout: `cache/presentation-previews/{sha256(filePath).slice(0,16)}/`
 *   - `slide-0.jpg` … `slide-N.jpg` — one JPEG per slide.
 *   - `meta.json` — source file's `size` + `mtimeMs` and the slide count. Written
 *     LAST, so its presence means the whole deck was rendered; a folder without
 *     it is treated as partial and regenerated.
 *
 * Revalidation against the file on disk (size + mtime) happens only ONCE per
 * app session, the first time a file is requested: if the file changed (or the
 * cache is incomplete) the folder is deleted and the caller re-renders. After
 * that, thumbnails stay cached in memory for the whole session — leaving and
 * returning to the screen never touches the disk again.
 *
 * Callers are expected to render all slides into the cache on a miss (via
 * `saveSlide` + `finish`), and to call `invalidate()` when a source file is
 * replaced so it re-renders. Only the Presentations tab uses this; the live
 * presentation (media window) is untouched.
 *
 * Returned values are blob URLs owned by this service — callers must not revoke them.
 */
class PresentationPreviewsCacheService {
  private blobUrls = new Map<string, string>();
  private pending = new Map<string, Promise<unknown>>();
  private session = new Map<string, CachedPresentationPreviews>();

  private async cacheDirFor(filePath: string): Promise<string> {
    const base = await getAppBasePath();
    const hash = await sha256Hex(filePath);
    return join(base, 'cache', 'presentation-previews', hash.slice(0, 16));
  }

  private blobUrlFor(filePath: string, index: number, bytes: Uint8Array<ArrayBuffer>): string {
    const key = `${filePath}:${index}`;
    const existing = this.blobUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    this.blobUrls.set(key, url);
    return url;
  }

  /**
   * Loads the cached thumbnails for `filePath`.
   *
   * - First call of the session: validates against the disk (`stat` size+mtime vs
   *   `meta.json`) and returns cached slides on a hit, or `null` on a miss (after
   *   deleting any stale folder) so the caller renders.
   * - Subsequent calls of the session: returns the same result as the first call
   *   (`null` only if nothing was cached yet), never touching the disk again.
   */
  async get(filePath: string): Promise<CachedPresentationPreviews | null> {
    const dedupKey = `get:${filePath}`;
    const existing = this.pending.get(dedupKey);
    if (existing) return existing as Promise<CachedPresentationPreviews | null>;

    const run = (async (): Promise<CachedPresentationPreviews | null> => {
      const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
      const tag = `[presentation-previews] ${fileName}`;

      const sessionHit = this.session.get(filePath);
      if (sessionHit) {
        console.log(`${tag} HIT session`);
        return sessionHit;
      }

      const src = await stat(filePath).catch(() => null);
      if (!src) {
        console.log(`${tag} MISS source-stat-failed`);
        return null;
      }

      const dir = await this.cacheDirFor(filePath);
      const metaPath = await join(dir, 'meta.json');
      let cached: CachedPresentationPreviews | null = null;
      let invalidate = false;

      if (await exists(metaPath)) {
        try {
          const meta = JSON.parse(await readTextFile(metaPath)) as PresentationPreviewMeta;
          const mtimeMs = src.mtime?.getTime() ?? 0;
          if (meta.fileSize === src.size && meta.mtimeMs === mtimeMs) {
            cached = await this.loadSlides(filePath, dir, meta.slideCount);
            if (!cached) {
              console.log(`${tag} MISS folder-incomplete`);
              invalidate = true;
            }
          } else {
            console.log(`${tag} MISS changed size=${meta.fileSize}/${src.size} mtime=${meta.mtimeMs}/${mtimeMs}`);
            invalidate = true;
          }
        } catch {
          console.log(`${tag} MISS corrupt-meta`);
          invalidate = true;
        }
      } else {
        console.log(`${tag} MISS no-meta`);
      }

      if (invalidate) {
        await remove(dir, { recursive: true }).catch(() => {});
      } else if (cached) {
        this.session.set(filePath, cached);
      }

      console.log(cached ? `${tag} HIT disk` : `${tag} RENDER-REQUIRED`);
      return cached;
    })();

    this.pending.set(dedupKey, run);
    run.finally(() => {
      this.pending.delete(dedupKey);
    });
    return run;
  }

  /** Persists one rendered slide as `slide-<index>.jpg` and remembers its blob for the session. */
  async saveSlide(filePath: string, index: number, dataUrl: string): Promise<void> {
    const dir = await this.cacheDirFor(filePath);
    await mkdir(dir, { recursive: true });
    const bytes = dataUrlToBytes(dataUrl || placeholderDataUrl());
    await writeFile(await join(dir, `slide-${index}.jpg`), bytes);
    const key = `${filePath}:${index}`;
    if (dataUrl) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      this.blobUrls.set(key, url);
    } else {
      this.blobUrls.delete(key);
    }
  }

  /**
   * Marks the cache as complete by writing `meta.json` and this file as ensured
   * for the session. Only call after every slide has been saved.
   */
  async finish(filePath: string, slideCount: number): Promise<void> {
    const src = await stat(filePath).catch(() => null);
    if (!src) return;

    const dir = await this.cacheDirFor(filePath);
    await mkdir(dir, { recursive: true });

    const entries = await readDir(dir).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.startsWith('slide-')) continue;
      const match = entry.name.match(/^slide-(\d+)\.jpg$/);
      if (!match || Number(match[1]) >= slideCount) {
        await remove(await join(dir, entry.name), { recursive: true }).catch(() => {});
      }
    }

    const meta: PresentationPreviewMeta = {
      filePath,
      fileSize: src.size,
      mtimeMs: src.mtime?.getTime() ?? 0,
      slideCount,
    };
    await writeFile(await join(dir, 'meta.json'), new TextEncoder().encode(JSON.stringify(meta)));
    this.session.set(filePath, { slideCount, thumbnails: this.blobUrlsForAll(filePath, slideCount) });
  }

  /**
   * Forces a re-render on the next `get`. Used when a source file is replaced
   * during the session. The on-disk cache is left alone; the next `get`
   * validates it against the new stat.
   */
  invalidate(filePath: string): void {
    this.session.delete(filePath);
    for (const key of [...this.blobUrls.keys()]) {
      if (key.startsWith(`${filePath}:`)) this.blobUrls.delete(key);
    }
  }

  /** Removes cache folders whose source presentation no longer exists. */
  async purgeOrphans(activePaths: Set<string>): Promise<void> {
    const base = await getAppBasePath().catch(() => null);
    if (!base) return;

    const root = await join(base, 'cache', 'presentation-previews');
    const entries = await readDir(root).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const metaPath = await join(root, entry.name, 'meta.json');
      if (!(await exists(metaPath))) continue;
      try {
        const meta = JSON.parse(await readTextFile(metaPath)) as PresentationPreviewMeta;
        if (!activePaths.has(meta.filePath)) {
          await remove(await join(root, entry.name), { recursive: true });
        }
      } catch {
        // corrupt meta — leave the folder to be regenerated or purged later
      }
    }
  }

  private async loadSlides(
    filePath: string,
    dir: string,
    slideCount: number
  ): Promise<CachedPresentationPreviews | null> {
    const thumbnails: string[] = [];
    for (let i = 0; i < slideCount; i++) {
      const slidePath = await join(dir, `slide-${i}.jpg`);
      if (!(await exists(slidePath))) return null;
      const bytes = await readFile(slidePath);
      thumbnails.push(this.blobUrlFor(filePath, i, bytes));
    }
    return { slideCount, thumbnails };
  }

  private blobUrlsForAll(filePath: string, slideCount: number): string[] {
    const thumbs: string[] = [];
    for (let i = 0; i < slideCount; i++) {
      const key = `${filePath}:${i}`;
      thumbs.push(this.blobUrls.get(key) ?? '');
    }
    return thumbs;
  }
}

export const presentationPreviewsCache = new PresentationPreviewsCacheService();

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(input))
    .then((digest) => Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join(''));
}

function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function placeholderDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1, 1);
  }
  return canvas.toDataURL('image/jpeg', 0.2);
}