export type MediaType = 'lyrics' | 'video' | 'image' | 'text' | 'audio' | 'files' | 'themes';
export type DownloadStatus = 'not_downloaded' | 'downloaded' | 'missing';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
  extension: string;
  duration?: number;
  title?: string;
  artist?: string;
  originalUrl?: string;
  thumbnailPath?: string;
  remoteThumbnailUrl?: string;
  downloadStatus?: DownloadStatus;
}

export interface FileUploadResult {
  success: FileInfo[];
  failed: Array<{
    path: string;
    error: string;
  }>;
}

export interface MediaFolderConfig {
  basePath: string;
  folders: Record<MediaType, string>;
}
