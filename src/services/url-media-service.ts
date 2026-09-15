import { invoke } from '@tauri-apps/api/core';
import type { FileInfo } from './types';

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

    return invoke<UrlMediaMetadata>('resolve_youtube', { url });
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
}

export const urlMediaService = new UrlMediaService();
