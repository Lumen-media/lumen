import { join } from '@tauri-apps/api/path';
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { getAppBasePath } from './app-paths';
import type { FileInfo } from './types';

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

export type UrlMediaMetadata = {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  artist?: string;
  remoteThumbnailUrl?: string;
  thumbnailPath?: string;
};

class UrlMediaService {
  isSupportedUrl(value: string): boolean {
    return this.parseYouTubeUrl(value) !== null;
  }

  isRemoteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  parseYouTubeUrl(value: string): { videoId: string; canonicalUrl: string } | null {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }

    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v');
      } else if (url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/').filter(Boolean)[1] ?? null;
      } else if (url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/').filter(Boolean)[1] ?? null;
      }
    }

    if (!videoId || !/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return null;

    return {
      videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  async resolveYouTube(url: string): Promise<UrlMediaMetadata> {
    const parsed = this.parseYouTubeUrl(url);
    if (!parsed) {
      throw new Error('Only YouTube URLs are supported');
    }

    const fallbackTitle = `YouTube video ${parsed.videoId}`;
    let metadata: YouTubeOEmbedResponse | null = null;

    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`
      );
      if (res.ok) {
        metadata = (await res.json()) as YouTubeOEmbedResponse;
      }
    } catch {
      metadata = null;
    }

    const remoteThumbnailUrl = metadata?.thumbnail_url;
    const thumbnailPath = remoteThumbnailUrl
      ? await this.cacheRemoteThumbnail(parsed.videoId, remoteThumbnailUrl).catch(() => undefined)
      : undefined;

    return {
      originalUrl: url,
      canonicalUrl: parsed.canonicalUrl,
      title: metadata?.title?.trim() || fallbackTitle,
      artist: metadata?.author_name?.trim() || undefined,
      remoteThumbnailUrl,
      thumbnailPath,
    };
  }

  async createYouTubeFileInfo(url: string, duration?: number): Promise<FileInfo> {
    const metadata = await this.resolveYouTube(url);
    return {
      name: metadata.title,
      path: metadata.canonicalUrl,
      size: 0,
      modifiedAt: new Date(),
      extension: 'url',
      title: metadata.title,
      artist: metadata.artist,
      duration,
      originalUrl: metadata.originalUrl,
      thumbnailPath: metadata.thumbnailPath,
      remoteThumbnailUrl: metadata.remoteThumbnailUrl,
      downloadStatus: 'not_downloaded',
    };
  }

  private async getRemoteThumbsPath(): Promise<string> {
    const basePath = await getAppBasePath();
    const cachePath = await join(basePath, 'cache', 'remote-thumbs');
    if (!(await exists(cachePath))) {
      await mkdir(cachePath, { recursive: true });
    }
    return cachePath;
  }

  private async cacheRemoteThumbnail(videoId: string, thumbnailUrl: string): Promise<string> {
    const cacheDir = await this.getRemoteThumbsPath();
    const filePath = await join(cacheDir, `youtube_${videoId}.jpg`);
    if (await exists(filePath)) return filePath;

    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      throw new Error(`Failed to download thumbnail: ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(filePath, bytes);
    return filePath;
  }
}

export const urlMediaService = new UrlMediaService();
