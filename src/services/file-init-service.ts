import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { join, appLocalDataDir } from '@tauri-apps/api/path';
import type { MediaType } from './types';

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
  private readonly MEDIA_TYPES: MediaType[] = ['lyrics', 'video', 'image', 'text', 'audio', 'files'];
  
  async initializeMediaFolders(): Promise<void> {
    try {
      const appDataPath = await appLocalDataDir();
      
      const filesPath = await join(appDataPath, 'files');
      const mediaPath = await join(filesPath, 'media');
      
      if (!await exists(filesPath)) {
        await mkdir(filesPath, { recursive: true });
      }
      
      if (!await exists(mediaPath)) {
        await mkdir(mediaPath, { recursive: true });
      }
      
      for (const mediaType of this.MEDIA_TYPES) {
        const mediaTypePath = await join(mediaPath, mediaType);
        if (!await exists(mediaTypePath)) {
          await mkdir(mediaTypePath);
        }
      }
    } catch (error) {
      console.error('Failed to initialize media folders:', error);
      throw new Error(`Failed to initialize media folders: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async getMediaBasePath(): Promise<string> {
    try {
      const appDataPath = await appLocalDataDir();
      return await join(appDataPath, 'files', 'media');
    } catch (error) {
      console.error('Failed to get media base path:', error);
      throw new Error(`Failed to get media base path: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async getMediaTypePath(mediaType: MediaType): Promise<string> {
    try {
      const basePath = await this.getMediaBasePath();
      return await join(basePath, mediaType);
    } catch (error) {
      console.error(`Failed to get path for media type ${mediaType}:`, error);
      throw new Error(`Failed to get path for media type ${mediaType}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const fileInitService = new FileInitServiceImpl();
