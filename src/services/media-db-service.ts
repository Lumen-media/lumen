import { invoke } from '@tauri-apps/api/core';
import { extractMetadata } from './metadata-extractor';
import type { DownloadStatus, FileInfo, MediaType } from './types';
import { urlMediaService } from './url-media-service';

export interface SearchHit {
  id: number;
  name: string;
  path: string;
  media_type: MediaType;
  artist: string | null;
  duration: number | null;
  modified_at: number;
  rank: number;
  title?: string | null;
  original_url?: string | null;
  thumbnail_path?: string | null;
  remote_thumbnail_url?: string | null;
  download_status?: string | null;
}

export interface UploadResult {
  sourcePath: string;
  file: FileInfo | null;
  error: string | null;
}

interface MediaFileInput {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  extension: string;
  duration?: number | null;
  artist?: string | null;
  originalUrl?: string | null;
  thumbnailPath?: string | null;
  remoteThumbnailUrl?: string | null;
  downloadStatus?: string | null;
  content?: string | null;
}

interface RawFileInfo {
  id: number;
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  extension: string;
  duration: number | null;
  title: string;
  artist: string | null;
  originalUrl: string | null;
  thumbnailPath: string | null;
  remoteThumbnailUrl: string | null;
  downloadStatus: string;
}

interface RawThemeFile {
  id: number;
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  extension: string;
}

function toMediaFileInput(file: FileInfo): MediaFileInput {
  return {
    name: file.name,
    path: file.path,
    size: file.size,
    modifiedAt: file.modifiedAt instanceof Date ? file.modifiedAt.getTime() : Number(file.modifiedAt),
    extension: file.extension,
    duration: file.duration ?? null,
    artist: file.artist ?? null,
    originalUrl: file.originalUrl ?? null,
    thumbnailPath: file.thumbnailPath ?? null,
    remoteThumbnailUrl: file.remoteThumbnailUrl ?? null,
    downloadStatus: file.downloadStatus ?? null,
  };
}

function isDownloadStatus(value: string): value is NonNullable<FileInfo['downloadStatus']> {
  return value === 'not_downloaded' || value === 'downloaded' || value === 'missing';
}

function toFileInfo(raw: RawFileInfo): FileInfo {
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    size: raw.size,
    modifiedAt: new Date(raw.modifiedAt),
    extension: raw.extension,
    duration: raw.duration ?? undefined,
    title: raw.title,
    artist: raw.artist ?? undefined,
    originalUrl: raw.originalUrl ?? undefined,
    thumbnailPath: raw.thumbnailPath ?? undefined,
    remoteThumbnailUrl: raw.remoteThumbnailUrl ?? undefined,
    downloadStatus: isDownloadStatus(raw.downloadStatus)
      ? raw.downloadStatus
      : raw.extension === 'url'
        ? 'not_downloaded'
        : 'downloaded',
  };
}

class MediaDbService {
  async initialize(): Promise<void> {
    await invoke('media_initialize');
  }

  async syncMediaType(mediaType: MediaType, fsFiles: FileInfo[]): Promise<void> {
    const files: MediaFileInput[] = [];
    for (const file of fsFiles) {
      let metadata: { duration?: number } = {};
      let content: string | null = null;
      try {
        metadata = await extractMetadata(file.path);
      } catch {}

      if (mediaType === 'presentation') {
        content = (await extractPresentationContent(file.path)) ?? null;
      }

      files.push({
        ...toMediaFileInput(file),
        duration: metadata.duration ?? null,
        content,
      });
    }
    await invoke('media_sync_type', { mediaType, files });
  }

  async listFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const rows = await invoke<RawFileInfo[]>('media_list', { mediaType });
    return rows.map(toFileInfo);
  }

  async searchFiles(mediaType: MediaType, query: string): Promise<FileInfo[]> {
    const rows = await invoke<RawFileInfo[]>('media_search_files', { mediaType, query });
    return rows.map(toFileInfo);
  }

  async insertFile(file: FileInfo, mediaType: MediaType, content?: string): Promise<void> {
    let metadata: { duration?: number } = {};
    if (file.extension !== 'url') {
      try {
        metadata = await extractMetadata(file.path);
      } catch {}
    }

    if (mediaType === 'presentation' && !content) {
      content = (await extractPresentationContent(file.path)) ?? undefined;
    }

    await invoke('media_insert', {
      file: {
        ...toMediaFileInput(file),
        duration: metadata.duration ?? file.duration ?? null,
        artist: file.artist ?? null,
      },
      mediaType,
      content: content ?? null,
    });
  }

  async insertUrlMedia(
    url: string,
    opts: { refreshMetadata?: boolean; duration?: number } = {}
  ): Promise<FileInfo> {
    const parsed = urlMediaService.parseYouTubeUrl(url);
    if (!parsed) {
      throw new Error('Only YouTube URLs are supported');
    }

    const raw = await invoke<RawFileInfo>('media_insert_url', {
      url,
      refreshMetadata: opts.refreshMetadata ?? false,
      duration: opts.duration ?? null,
    });
    return toFileInfo(raw);
  }

  async search(
    query: string,
    opts: { mediaType?: MediaType; fullContent?: boolean; limit?: number } = {}
  ): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    return invoke<SearchHit[]>('media_search', {
      query,
      fullContent: opts.fullContent ?? false,
      mediaType: opts.mediaType ?? null,
      limit: opts.limit ?? 50,
    });
  }

  async searchMulti(
    query: string,
    opts: {
      mediaTypes?: MediaType[];
      fullContent?: boolean;
      limitPerGroup?: number;
    } = {}
  ): Promise<SearchHit[]> {
    return invoke<SearchHit[]>('media_search_multi', {
      query,
      fullContent: opts.fullContent ?? false,
      mediaTypes: opts.mediaTypes ?? [],
      limitPerGroup: opts.limitPerGroup ?? 50,
    });
  }

  async uploadFiles(mediaType: MediaType, filePaths: string[]): Promise<UploadResult[]> {
    const results = await invoke<
      Array<{ path: string; file: RawFileInfo | null; error: string | null }>
    >('media_upload_files', { mediaType, filePaths });
    return results.map((r) => ({
      sourcePath: r.path,
      file: r.file ? toFileInfo(r.file) : null,
      error: r.error,
    }));
  }

  async listByType(mediaType: MediaType, limit = 50): Promise<SearchHit[]> {
    return invoke<SearchHit[]>('media_list_by_type', { mediaType, limit });
  }

  async getById(id: number): Promise<SearchHit | null> {
    return invoke<SearchHit | null>('media_get_by_id', { id });
  }

  async getByPath(path: string): Promise<SearchHit | null> {
    return invoke<SearchHit | null>('media_get_by_path', { path });
  }

  async getFileInfoByPath(path: string): Promise<FileInfo | null> {
    const raw = await invoke<RawFileInfo | null>('media_get_file_info_by_path', { path });
    return raw ? toFileInfo(raw) : null;
  }

  async getFileInfoByOriginalUrl(
    originalUrl: string,
    canonicalUrl?: string
  ): Promise<FileInfo | null> {
    const raw = await invoke<RawFileInfo | null>('media_get_file_info_by_original_url', {
      originalUrl,
      canonicalUrl: canonicalUrl ?? null,
    });
    return raw ? toFileInfo(raw) : null;
  }

  async deleteFile(path: string): Promise<void> {
    await invoke('media_delete', { path });
  }

  async updateDownloadStatus(
    originalUrl: string,
    status: DownloadStatus,
    newPath?: string,
    newSize?: number,
    newMediaType?: string,
    newExtension?: string
  ): Promise<void> {
    await invoke('media_update_download_status', {
      originalUrl,
      status,
      newPath: newPath ?? null,
      newSize: newSize ?? null,
      newMediaType: newMediaType ?? null,
      newExtension: newExtension ?? null,
    });
  }

  async syncThemes(fsFiles: FileInfo[]): Promise<void> {
    await invoke('media_sync_themes', { files: fsFiles.map(toMediaFileInput) });
  }

  async listThemes(): Promise<FileInfo[]> {
    const rows = await invoke<RawThemeFile[]>('media_list_themes');
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      size: row.size,
      modifiedAt: new Date(row.modifiedAt),
      extension: row.extension,
    }));
  }

  async insertTheme(file: FileInfo, contentHash?: string): Promise<void> {
    await invoke('media_insert_theme', {
      file: toMediaFileInput(file),
      contentHash: contentHash ?? null,
    });
  }

  async deleteTheme(path: string): Promise<void> {
    await invoke('media_delete_theme', { path });
  }
}

async function extractPresentationContent(path: string): Promise<string | null> {
  try {
    const meta = await invoke<{
      slide_count: number;
      slides: Array<{ index: number; text: string }>;
      title?: string;
    }>('extract_presentation_metadata', { path });

    const parts = meta.slides.filter((s) => s.text.trim().length > 0).map((s) => s.text.trim());

    return parts.length > 0 ? parts.join('\n\n') : null;
  } catch (err) {
    console.error('Failed to extract presentation text:', err);
    return null;
  }
}

export const mediaDbService = new MediaDbService();