import { extname, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, stat } from '@tauri-apps/plugin-fs';
import { getAppBasePath, getMediaBasePath } from './app-paths';
import { mediaDbService } from './media-db-service';
import type { FileInfo, MediaType } from './types';

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
    const folderPath = await this.getMediaTypePath(mediaType);
    const entries = await readDir(folderPath);
    const results: FileInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile) continue;
      const fullPath = await join(folderPath, entry.name);
      const meta = await stat(fullPath);
      results.push({
        name: entry.name,
        path: fullPath,
        size: meta.size,
        modifiedAt: meta.mtime ?? new Date(),
        extension: await extname(entry.name),
      });
    }
    return results;
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
}

export const fileInitService = new FileInitServiceImpl();
