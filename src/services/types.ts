export type MediaType =
  | 'lyrics'
  | 'video'
  | 'image'
  | 'text'
  | 'audio'
  | 'files'
  | 'themes'
  | 'presentation';
export type DownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'missing';
export type DownloadProvider = 'youtube';
export type DownloadQuality = 'best' | 'high' | 'medium' | 'low' | 'audio_only';

export interface FileInfo {
  id?: number;
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

export interface DownloadProgress {
  downloadId: string;
  progress: number;
  speed: string;
  eta: string;
  status: string;
}

export interface DownloadResult {
  downloadId: string;
  filePath: string;
  fileSize: number;
  mediaType: string;
  fileExtension: string;
}

export interface DownloadError {
  downloadId: string;
  message: string;
  code: string;
}

export interface DependencyStatus {
  ytdlpInstalled: boolean;
  ytdlpVersion: string | null;
  ffmpegInstalled: boolean;
  ffmpegVersion: string | null;
  toolsDir: string;
}

export interface DependencyInfo {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  platform: string;
}
