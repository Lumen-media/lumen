export type MediaType = 'lyrics' | 'video' | 'image' | 'text' | 'audio' | 'files';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
  extension: string;
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
