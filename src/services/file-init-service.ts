import { join } from '@tauri-apps/api/path';
import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { getAppBasePath, getMediaBasePath } from './app-paths';
import { mediaDbService } from './media-db-service';
import type { FileInfo, MediaType } from './types';

interface ScannedFile {
  name: string;
  path: string;
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
  };
}

export interface FileInitService {
  /**
   * Initialize the media folder structure
   * Creates files/media/ and all media type subdirectories
   * @returns Promise resolving to success status
   * @throws Error if folder creation fails
   */
  initializeMediaFolders(): Promise<void>;

  /**
   * Get the base media directory path
   * @returns Promise resolving to the media directory path
   */
  getMediaBasePath(): Promise<string>;

  /**
   * Get the path for a specific media type folder
   * @param mediaType - The media type
   * @returns Promise resolving to the media type folder path
   */
  getMediaTypePath(mediaType: MediaType): Promise<string>;

  /**
   * Scan a media type folder and return its files in a single IPC call
   * @param mediaType - The media type
   * @returns Promise resolving to scanned file info entries
   */
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

  async initializeMediaFolders(): Promise<void> {
    try {
      const basePath = await getAppBasePath();
      const mediaPath = await getMediaBasePath();

      if (!(await exists(basePath))) {
        await mkdir(basePath, { recursive: true });
      }

      if (!(await exists(mediaPath))) {
        await mkdir(mediaPath, { recursive: true });
      }

      for (const mediaType of this.MEDIA_TYPES) {
        const mediaTypePath = await join(mediaPath, mediaType);
        if (!(await exists(mediaTypePath))) {
          await mkdir(mediaTypePath);
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
        `Failed to initialize media folders: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async readFolderFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const scanned = await invoke<ScannedFile[]>('scan_media_files', { mediaType });
    return scanned.map(toFileInfo);
  }

  async getMediaBasePath(): Promise<string> {
    return getMediaBasePath();
  }

  async getMediaTypePath(mediaType: MediaType): Promise<string> {
    try {
      const mediaPath = await getMediaBasePath();
      const mediaTypePath = await join(mediaPath, mediaType);

      if (!(await exists(mediaTypePath))) {
        await mkdir(mediaTypePath, { recursive: true });
      }

      return mediaTypePath;
    } catch (error) {
      console.error(`Failed to get path for media type ${mediaType}:`, error);
      throw new Error(
        `Failed to get path for media type ${mediaType}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getFolderFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const scanned = await invoke<ScannedFile[]>('scan_media_files', { mediaType });
    return scanned.map(toFileInfo);
  }
}

export const fileInitService = new FileInitServiceImpl();
