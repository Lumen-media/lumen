import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/lib/ipc';
import type {
  CookieValidation,
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
    const result = await ipc('check_dependencies');

    return {
      ytdlpInstalled: result.ytdlp_installed,
      ytdlpVersion: result.ytdlp_version,
      ytdlpOutdated: result.ytdlp_outdated,
      ffmpegInstalled: result.ffmpeg_installed,
      ffmpegVersion: result.ffmpeg_version,
      cookiesInstalled: result.cookies_installed,
      nodeInstalled: result.node_installed,
      nodeDir: result.node_dir,
      toolsDir: result.tools_dir,
    };
  }

  async installDependencies(): Promise<void> {
    await ipc('download_dependencies');
  }

  async listDependencies(): Promise<DependencyInfo[]> {
    const result = await ipc('list_dependencies');

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
    quality: DownloadQuality,
    maxHeight?: number
  ): Promise<DownloadResult> {
    const result = await ipc('download_video', {
      url,
      provider,
      quality,
      maxHeight: maxHeight ?? null,
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
    await ipc('cancel_download', { downloadId });
  }

  async getDownloadStatus(
    downloadId: string
  ): Promise<{ status: string; progress?: number | null } | null> {
    return ipc('get_download_status', { downloadId });
  }

  async installCookiesFile(sourcePath: string): Promise<string> {
    return ipc('install_cookies_file', { sourcePath });
  }

  async validateCookies(): Promise<CookieValidation> {
    return await ipc('validate_cookies');
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
