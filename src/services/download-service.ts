import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  DependencyInfo,
  DependencyStatus,
  DownloadError,
  DownloadProgress,
  DownloadProvider,
  DownloadQuality,
  DownloadResult,
} from './types';

export interface DownloadCallbacks {
  onProgress?: (progress: DownloadProgress) => void;
  onComplete?: (result: DownloadResult) => void;
  onError?: (error: DownloadError) => void;
}

class DownloadService {
  private listeners: UnlistenFn[] = [];

  async checkDependencies(): Promise<DependencyStatus> {
    const result = await invoke<{
      ytdlp_installed: boolean;
      ytdlp_version: string | null;
      ffmpeg_installed: boolean;
      ffmpeg_version: string | null;
      tools_dir: string;
    }>('check_dependencies');

    return {
      ytdlpInstalled: result.ytdlp_installed,
      ytdlpVersion: result.ytdlp_version,
      ffmpegInstalled: result.ffmpeg_installed,
      ffmpegVersion: result.ffmpeg_version,
      toolsDir: result.tools_dir,
    };
  }

  async installDependencies(): Promise<void> {
    await invoke('download_dependencies');
  }

  async listDependencies(): Promise<DependencyInfo[]> {
    const result =
      await invoke<
        Array<{
          name: string;
          installed: boolean;
          version: string | null;
          path: string | null;
          platform: string;
        }>
      >('list_dependencies');

    return result.map((item) => ({
      name: item.name,
      installed: item.installed,
      version: item.version,
      path: item.path,
      platform: item.platform,
    }));
  }

  async downloadVideo(
    url: string,
    provider: DownloadProvider,
    quality: DownloadQuality
  ): Promise<DownloadResult> {
    const result = await invoke<{
      download_id: string;
      file_path: string;
      file_size: number;
      media_type: string;
      file_extension: string;
    }>('download_video', {
      url,
      provider,
      quality,
    });

    return {
      downloadId: result.download_id,
      filePath: result.file_path,
      fileSize: result.file_size,
      mediaType: result.media_type,
      fileExtension: result.file_extension,
    };
  }

  async cancelDownload(downloadId: string): Promise<void> {
    await invoke('cancel_download', { downloadId });
  }

  async getDownloadStatus(
    downloadId: string
  ): Promise<{ status: string; progress?: number } | null> {
    const result = await invoke<{ status: string; progress?: number } | null>(
      'get_download_status',
      {
        downloadId,
      }
    );
    return result;
  }

  onDependencyProgress(
    callback: (event: { tool: string; progress: number; status: string }) => void
  ): UnlistenFn {
    const promise = listen<{ tool: string; progress: number; status: string }>(
      'dependency-download-progress',
      (event) => callback(event.payload)
    );
    const unlisten: UnlistenFn = () => {
      promise.then((fn) => fn());
    };
    this.listeners.push(unlisten);
    return unlisten;
  }

  onDependencyComplete(callback: (event: { tool: string; version: string }) => void): UnlistenFn {
    const promise = listen<{ tool: string; version: string }>(
      'dependency-download-complete',
      (event) => callback(event.payload)
    );
    const unlisten: UnlistenFn = () => {
      promise.then((fn) => fn());
    };
    this.listeners.push(unlisten);
    return unlisten;
  }

  cleanup(): void {
    for (const unlisten of this.listeners) {
      unlisten();
    }
    this.listeners = [];
  }
}

export const downloadService = new DownloadService();
