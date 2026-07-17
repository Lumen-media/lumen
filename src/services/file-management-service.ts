import { basename, extname, join } from '@tauri-apps/api/path';
import { copyFile, exists, readDir, remove, stat } from '@tauri-apps/plugin-fs';
import { fileInitService } from './file-init-service';
import { mediaDbService } from './media-db-service';
import type { FileInfo, MediaType } from './types';
import { urlMediaService } from './url-media-service';

export interface FileManagementService {
  /**
   * List all files in a specific media type folder
   * @param mediaType - The media type (lyrics, video, etc.)
   * @returns Promise resolving to array of file information
   */
  listFiles(mediaType: MediaType): Promise<FileInfo[]>;

  /**
   * Upload files to a specific media type folder
   * @param mediaType - The media type destination
   * @param filePaths - Array of source file paths to copy
   * @returns Promise resolving to array of successfully copied files
   * @throws Error if validation or copy fails
   */
  uploadFiles(mediaType: MediaType, filePaths: string[]): Promise<FileInfo[]>;

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
   * Sync the DB with the actual filesystem for a media type, then return the updated list
   * @param mediaType - The media type folder to refresh
   */
  refreshFiles(mediaType: MediaType): Promise<FileInfo[]>;

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

  async uploadFiles(mediaType: MediaType, filePaths: string[]): Promise<FileInfo[]> {
    const destFolder = await fileInitService.getMediaTypePath(mediaType);
    const uploadedFiles: FileInfo[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    for (const filePath of filePaths) {
      try {
        if (!this.validateFileType(filePath, mediaType)) {
          const fileName = await basename(filePath);
          const error = `File "${fileName}" has an invalid type for ${mediaType} category`;
          errors.push({ path: filePath, error });
          continue;
        }

        const fileName = await basename(filePath);
        let destPath = await join(destFolder, fileName);

        if (await exists(destPath)) {
          destPath = await this.generateUniqueFilename(destFolder, fileName);
        }

        await copyFile(filePath, destPath);

        const fileMetadata = await stat(destPath);
        const fileExtension = await extname(destPath);

        const fileInfo: FileInfo = {
          name: await basename(destPath),
          path: destPath,
          size: fileMetadata.size,
          modifiedAt: fileMetadata.mtime || new Date(),
          extension: fileExtension,
        };

        uploadedFiles.push(fileInfo);
        await mediaDbService.insertFile(fileInfo, mediaType);
      } catch (error) {
        const fileName = await basename(filePath);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to upload file "${fileName}":`, error);
        errors.push({
          path: filePath,
          error: `Failed to copy "${fileName}": ${errorMessage}`,
        });
      }
    }

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

  async refreshFiles(mediaType: MediaType): Promise<FileInfo[]> {
    const folderPath = await fileInitService.getMediaTypePath(mediaType);
    const entries = await readDir(folderPath);
    const fsFiles: FileInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile) continue;
      const fullPath = await join(folderPath, entry.name);
      const meta = await stat(fullPath);
      fsFiles.push({
        name: entry.name,
        path: fullPath,
        size: meta.size,
        modifiedAt: meta.mtime ?? new Date(),
        extension: await extname(entry.name),
      });
    }

    await mediaDbService.syncMediaType(mediaType, fsFiles);
    return mediaDbService.listFiles(mediaType);
  }

  private async generateUniqueFilename(folder: string, fileName: string): Promise<string> {
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '';

    let counter = 1;

    while (true) {
      const newName = `${baseName} (${counter})${extension}`;
      const newPath = await join(folder, newName);

      if (!(await exists(newPath))) {
        return newPath;
      }

      counter++;
    }
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
