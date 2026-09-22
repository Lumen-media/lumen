import { invoke } from '@tauri-apps/api/core';
import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { getAppBasePath, getMediaTypePath as getResolvedMediaTypePath } from './app-paths';
import { mediaDbService } from './media-db-service';
import type { FileInfo, MediaType } from './types';

interface ScannedFile {
  name: string;
  path: string;
  folder: string;
  size: number;
  modifiedAt: number;
  extension: string;
}

function toFileInfo(scanned: ScannedFile): FileInfo {
  return {
    name: scanned.name,
    path: scanned.path,
    size: scanned.size,
    modifiedAt: new Date(scanned.modifiedAt),
    extension: scanned.extension,
    folder: scanned.folder,
  };
}

export interface FileInitService {
  initializeMediaFolders(): Promise<void>;
  getMediaTypePath(mediaType: MediaType): Promise<string>;
  getFolderFiles(mediaType: MediaType): Promise<FileInfo[]>;
}

class FileInitServiceImpl implements FileInitService {
  private readonly MEDIA_TYPES: MediaType[] = [
    'lyrics',
    'video',
    'image',
    'text',
    'audio',
    'files',
    'themes',
    'presentation',
  ];

  private initPromise: Promise<void> | null = null;

  async initializeMediaFolders(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      const basePath = await getAppBasePath();
      if (!(await exists(basePath))) {
        await mkdir(basePath, { recursive: true });
      }

      for (const mediaType of this.MEDIA_TYPES) {
        const mediaTypePath = await getResolvedMediaTypePath(mediaType);
        if (!(await exists(mediaTypePath))) {
          await mkdir(mediaTypePath, { recursive: true });
        }
      }

      await mediaDbService.initialize();
      for (const mediaType of this.MEDIA_TYPES) {
        try {
          const fsFiles = await this.readFolderFiles(mediaType);
          if (mediaType === 'themes') {
            await mediaDbService.syncThemes(fsFiles);
          } else {
            await mediaDbService.syncMediaType(mediaType, fsFiles);
          }
        } catch (err) {
          console.warn(`DB sync skipped for ${mediaType}:`, err);
        }
      }
    } catch (error) {
      console.error('Failed to initialize media folders:', error);
      throw new Error(
        `Failed to initialize media folders: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async readFolderFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const scanned = await invoke<ScannedFile[]>('scan_media_files', { mediaType });
    return scanned.map(toFileInfo);
  }

  async getMediaTypePath(mediaType: MediaType): Promise<string> {
    try {
      const mediaTypePath = await getResolvedMediaTypePath(mediaType);
      if (!(await exists(mediaTypePath))) {
        await mkdir(mediaTypePath, { recursive: true });
      }
      return mediaTypePath;
    } catch (error) {
      console.error(`Failed to get path for media type ${mediaType}:`, error);
      throw new Error(
        `Failed to get path for media type ${mediaType}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFolderFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const scanned = await invoke<ScannedFile[]>('scan_media_files', { mediaType });
    return scanned.map(toFileInfo);
  }
}

export const fileInitService = new FileInitServiceImpl();
