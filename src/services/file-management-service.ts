import { remove } from '@tauri-apps/plugin-fs';
import { downloadService } from './download-service';
import { fileInitService } from './file-init-service';
import { mediaDbService } from './media-db-service';
import type {
  DownloadProvider,
  DownloadQuality,
  FileInfo,
  MediaPoolListing,
  MediaType,
} from './types';
import { urlMediaService } from './url-media-service';

export interface FileManagementService {
  /**
   * List all files in a specific media type folder
   * @param mediaType - The media type (lyrics, video, etc.)
   * @returns Promise resolving to array of file information
   */
  listFiles(mediaType: MediaType): Promise<FileInfo[]>;

  /**
   * List the folders and files of a specific subfolder (1 level) of a media type
   * @param mediaType - The media type folder
   * @param folder - Relative subfolder path ('' = root), '/' separated
   */
  listFolder(mediaType: MediaType, folder: string): Promise<MediaPoolListing>;

  /**
   * Upload files to a specific media type folder
   * @param mediaType - The media type destination
   * @param filePaths - Array of source file paths to copy
   * @param folder - Relative destination subfolder ('' = root)
   * @returns Promise resolving to array of successfully copied files
   * @throws Error if validation or copy fails
   */
  uploadFiles(mediaType: MediaType, filePaths: string[], folder?: string): Promise<FileInfo[]>;

  /**
   * Open file picker dialog for selecting files
   * @param mediaType - The media type to filter file extensions
   * @returns Promise resolving to selected file paths or null if cancelled
   */
  openFilePicker(mediaType: MediaType): Promise<string[] | null>;

  /**
   * Validate file extension against media type
   * @param filePath - Path to the file
   * @param mediaType - The target media type
   * @returns boolean indicating if file is valid
   */
  validateFileType(filePath: string, mediaType: MediaType): boolean;

  /**
   * Delete a file from disk and remove it from the DB index
   * @param file - The file to delete
   */
  deleteFile(file: FileInfo): Promise<void>;

  /**
   * Delete a subfolder recursively (files on disk + DB rows)
   * @param mediaType - The media type folder
   * @param folder - Relative subfolder path to delete
   */
  deleteFolder(mediaType: MediaType, folder: string): Promise<void>;

  /**
   * Sync the DB with the actual filesystem for a media type, then return the updated list
   * @param mediaType - The media type folder to refresh
   */
  refreshFiles(mediaType: MediaType): Promise<FileInfo[]>;

  /**
   * Sync the DB with the actual filesystem for a media type, then return the listing of a subfolder
   * @param mediaType - The media type folder to refresh
   * @param folder - Relative subfolder path to return ('' = root)
   */
  refreshFolder(mediaType: MediaType, folder: string): Promise<MediaPoolListing>;

  /**
   * Add a supported URL as media without copying a local file.
   * Currently only YouTube URLs are accepted and they are always video media.
   */
  addUrl(mediaType: 'video', url: string): Promise<FileInfo>;
}

const EXTENSION_MAP: Record<MediaType, string[]> = {
  video: ['.mp4', '.avi', '.mov', '.mkv', '.webm'],
  audio: ['.mp3', '.wav', '.ogg', '.flac', '.m4a'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
  text: ['.txt', '.md', '.doc', '.docx', '.pdf'],
  lyrics: ['.txt', '.lrc', '.srt', '.md'],
  themes: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.webm'],
  presentation: ['.ppt', '.pptx'],
  files: [],
};

class FileManagementServiceImpl implements FileManagementService {
  async addUrl(mediaType: 'video', url: string): Promise<FileInfo> {
    if (mediaType !== 'video' || !urlMediaService.isSupportedUrl(url)) {
      throw new Error('Only YouTube video URLs are supported');
    }

    return mediaDbService.insertUrlMedia(url);
  }

  async downloadMedia(file: FileInfo, quality: DownloadQuality): Promise<void> {
    const url = file.originalUrl || file.path;
    const provider: DownloadProvider = 'youtube';

    await mediaDbService.updateDownloadStatus(url, 'downloading');

    try {
      await downloadService.downloadVideo(url, provider, quality);
    } catch (error) {
      await mediaDbService.updateDownloadStatus(url, 'not_downloaded');
      throw error;
    }
  }

  async listFiles(mediaType: MediaType): Promise<FileInfo[]> {
    try {
      return await mediaDbService.listFiles(mediaType);
    } catch (error) {
      console.error(`Failed to list files for media type ${mediaType}:`, error);
      throw new Error(
        `Failed to list files: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listFolder(mediaType: MediaType, folder: string): Promise<MediaPoolListing> {
    try {
      return await mediaDbService.listFolder(mediaType, folder);
    } catch (error) {
      console.error(`Failed to list folder "${folder}" for media type ${mediaType}:`, error);
      throw new Error(
        `Failed to list folder: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async uploadFiles(
    mediaType: MediaType,
    filePaths: string[],
    folder: string = ''
  ): Promise<FileInfo[]> {
    const results = await mediaDbService.uploadFiles(mediaType, filePaths, folder);
    const uploadedFiles = results.filter((r): r is { file: FileInfo } & typeof r => r.file !== null).map(
      (r) => r.file
    );
    const errors = results
      .filter((r) => r.error !== null)
      .map((r) => ({ path: r.sourcePath, error: r.error as string }));

    if (uploadedFiles.length === 0 && errors.length > 0) {
      const errorMessages = errors.map((e) => e.error).join('; ');
      throw new Error(`Failed to upload files: ${errorMessages}`);
    }

    if (errors.length > 0) {
      console.warn(`Partial upload success. ${errors.length} file(s) failed:`, errors);
    }

    return uploadedFiles;
  }

  async deleteFile(file: FileInfo): Promise<void> {
    await remove(file.path);
    await mediaDbService.deleteFile(file.path);
  }

  async deleteFolder(mediaType: MediaType, folder: string): Promise<void> {
    await mediaDbService.deleteFolder(mediaType, folder);
  }

  async refreshFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const fsFiles = await fileInitService.getFolderFiles(mediaType);
    await mediaDbService.syncMediaType(mediaType, fsFiles);
    return mediaDbService.listFiles(mediaType);
  }

  async refreshFolder(mediaType: MediaType, folder: string): Promise<MediaPoolListing> {
    const fsFiles = await fileInitService.getFolderFiles(mediaType);
    await mediaDbService.syncMediaType(mediaType, fsFiles);
    return mediaDbService.listFolder(mediaType, folder);
  }

  async openFilePicker(mediaType: MediaType): Promise<string[] | null> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');

      const extensions = EXTENSION_MAP[mediaType];

      const filters =
        mediaType === 'files'
          ? []
          : [
              {
                name: mediaType,
                extensions: extensions.map((ext) => ext.slice(1)),
              },
            ];

      const selected = await open({
        multiple: true,
        filters: filters,
      });

      if (!selected) {
        return null;
      }

      return Array.isArray(selected) ? selected : [selected];
    } catch (error) {
      console.error(`Failed to open file picker for media type ${mediaType}:`, error);
      throw new Error(
        `Failed to open file picker: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  validateFileType(filePath: string, mediaType: MediaType): boolean {
    if (mediaType === 'files') {
      return true;
    }

    const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    const allowedExtensions = EXTENSION_MAP[mediaType];

    return allowedExtensions.includes(extension);
  }
}

export const fileManagementService = new FileManagementServiceImpl();
