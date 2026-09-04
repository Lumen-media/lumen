import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { downloadService, type DownloadCallbacks } from '@/services/download-service';
import { mediaDbService } from '@/services/media-db-service';
import type {
  CookieValidation,
  DependencyStatus,
  DownloadProgress,
  DownloadProvider,
  DownloadQuality,
  DownloadResult,
  FileInfo,
} from '@/services/types';

interface RawDownloadProgress {
  download_id: string;
  progress: number;
  speed: string;
  eta: string;
  status: string;
}

interface RawDownloadComplete {
  download_id: string;
  file_path: string;
  file_size: number;
  media_type: string;
  file_extension: string;
}

interface RawDownloadError {
  download_id: string;
  message: string;
  code: string;
}

const STANDARD_HEIGHTS = [1080, 1440, 2160];

function autoMaxHeight(): number {
  const screenHeight = typeof window !== 'undefined' ? window.screen.height : 1080;
  const nextStandard = STANDARD_HEIGHTS.find((h) => h >= screenHeight) ?? 2160;
  return Math.max(1080, nextStandard);
}

interface ActiveDownload {
  downloadId: string;
  fileId?: number;
  url: string;
  provider: DownloadProvider;
  quality: DownloadQuality;
  progress: number;
  speed: string;
  eta: string;
  status: string;
}

interface DownloadStore {
  dependencyStatus: DependencyStatus | null;
  activeDownloads: Map<string, ActiveDownload>;
  isInstallingDeps: boolean;
  cookiesDialogOpen: boolean;
  cookieValidation: CookieValidation | null;
  cookieValidationLoading: boolean;

  checkDeps: () => Promise<DependencyStatus>;
  installDeps: () => Promise<void>;
  startDownload: (
    file: FileInfo,
    quality: DownloadQuality,
    callbacks?: DownloadCallbacks
  ) => Promise<DownloadResult>;
  cancelDownload: (downloadId: string) => Promise<void>;
  getActiveDownload: (downloadId: string) => ActiveDownload | undefined;
  updateDownloadProgress: (downloadId: string, progress: DownloadProgress) => void;
  removeDownload: (downloadId: string) => void;
  openCookiesDialog: () => void;
  closeCookiesDialog: () => void;
  installCookies: (sourcePath: string) => Promise<string>;
  validateCookies: () => Promise<CookieValidation>;
  setCookieValidation: (validation: CookieValidation | null) => void;
  refreshCookieValidation: () => Promise<void>;
}

export const COOKIE_VALIDATION_CACHE_KEY = 'lumen:cookie-validation-cache';

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  dependencyStatus: null,
  activeDownloads: new Map(),
  isInstallingDeps: false,
  cookiesDialogOpen: false,
  cookieValidation: null,
  cookieValidationLoading: false,

  checkDeps: async () => {
    const status = await downloadService.checkDependencies();
    set({ dependencyStatus: status });
    return status;
  },

  openCookiesDialog: () => set({ cookiesDialogOpen: true }),
  closeCookiesDialog: () => set({ cookiesDialogOpen: false }),

  installCookies: async (sourcePath) => {
    const installedPath = await downloadService.installCookiesFile(sourcePath);
    const status = await downloadService.checkDependencies();
    set({ dependencyStatus: status });
    return installedPath;
  },

  validateCookies: async () => {
    return await downloadService.validateCookies();
  },

  setCookieValidation: (validation) => set({ cookieValidation: validation }),

  refreshCookieValidation: async () => {
    try {
      const files = await mediaDbService.listFiles('video');
      const hasYoutubeMedia = files.some(
        (f) => f.extension === 'url' || Boolean(f.originalUrl)
      );
      if (!hasYoutubeMedia) {
        set({ cookieValidation: null, cookieValidationLoading: false });
        try {
          localStorage.removeItem(COOKIE_VALIDATION_CACHE_KEY);
        } catch {
          /* ignore storage errors */
        }
        return;
      }

      set({ cookieValidationLoading: true });
      const result = await downloadService.validateCookies();
      set({ cookieValidation: result, cookieValidationLoading: false });
      try {
        localStorage.setItem(
          COOKIE_VALIDATION_CACHE_KEY,
          JSON.stringify({ result, at: Date.now() })
        );
      } catch {
        /* ignore storage errors */
      }
    } catch (error) {
      console.error('[download-store] refreshCookieValidation failed:', error);
      set({ cookieValidationLoading: false });
    }
  },

  installDeps: async () => {
    set({ isInstallingDeps: true });
    try {
      await downloadService.installDependencies();
      const status = await downloadService.checkDependencies();
      set({ dependencyStatus: status, isInstallingDeps: false });
    } catch (error) {
      set({ isInstallingDeps: false });
      throw error;
    }
  },

  startDownload: async (file, quality, callbacks) => {
    const url = file.originalUrl || file.path;
    const provider: DownloadProvider = 'youtube';

    let targetDownloadId = '';

    const activeDownload: ActiveDownload = {
      downloadId: '',
      fileId: file.id,
      url,
      provider,
      quality,
      progress: 0,
      speed: '',
      eta: '',
      status: 'starting',
    };

    const progressUnlisten = await listen<RawDownloadProgress>(
      'video-download-progress',
      (event) => {
        if (event.payload.download_id !== targetDownloadId) return;
        const downloads = new Map(get().activeDownloads);
        const existing = downloads.get(event.payload.download_id);
        if (existing) {
          downloads.set(event.payload.download_id, {
            ...existing,
            progress: event.payload.progress,
            speed: event.payload.speed,
            eta: event.payload.eta,
            status: event.payload.status,
          });
          set({ activeDownloads: downloads });
        }
        callbacks?.onProgress?.({
          downloadId: event.payload.download_id,
          progress: event.payload.progress,
          speed: event.payload.speed,
          eta: event.payload.eta,
          status: event.payload.status,
        });
      }
    );

    const completeUnlisten = await listen<RawDownloadComplete>(
      'video-download-complete',
      (event) => {
        const p = event.payload;
        if (p.download_id !== targetDownloadId) return;
        console.log('[download-store] Complete for', p.download_id, '— path:', p.file_path);
        console.log('[download-store] Updating DB record for URL:', url);

        mediaDbService
          .updateDownloadStatus(
            url,
            'downloaded',
            p.file_path,
            p.file_size,
            p.media_type,
            p.file_extension
          )
          .then(() => {
            console.log('[download-store] DB updated — record now points to local file');
            window.dispatchEvent(new CustomEvent('lumen:media-files-changed'));
          })
          .catch((e) => console.error('[download-store] DB update FAILED:', e));

        const downloads = new Map(get().activeDownloads);
        downloads.delete(p.download_id);
        set({ activeDownloads: downloads });
        callbacks?.onComplete?.({
          downloadId: p.download_id,
          filePath: p.file_path,
          fileSize: p.file_size,
          mediaType: p.media_type,
          fileExtension: p.file_extension,
        });
        progressUnlisten();
        completeUnlisten();
        errorUnlisten();
      }
    );

    const errorUnlisten = await listen<RawDownloadError>('video-download-error', (event) => {
      const p = event.payload;
      if (p.download_id !== targetDownloadId) return;
      console.error('[download-store] Error for', p.download_id, ':', p.message);

      mediaDbService
        .updateDownloadStatus(url, 'not_downloaded')
        .then(() => {
          window.dispatchEvent(new CustomEvent('lumen:media-files-changed'));
        })
        .catch((e) => console.error('[download-store] Failed to revert download status:', e));

      const downloads = new Map(get().activeDownloads);
      downloads.delete(p.download_id);
      set({ activeDownloads: downloads });
      callbacks?.onError?.({ downloadId: p.download_id, message: p.message, code: p.code });
      progressUnlisten();
      completeUnlisten();
      errorUnlisten();
    });

    try {
      await mediaDbService.updateDownloadStatus(url, 'downloading');
    } catch (e) {
      console.error('[download-store] Failed to set downloading status:', e);
    }

    let result: DownloadResult;
    try {
      result = await downloadService.downloadVideo(
        url,
        provider,
        quality,
        autoMaxHeight()
      );
    } catch (e) {
      console.error('[download-store] Failed to start download:', e);
      progressUnlisten();
      completeUnlisten();
      errorUnlisten();
      await mediaDbService.updateDownloadStatus(url, 'not_downloaded').catch(() => {});
      window.dispatchEvent(new CustomEvent('lumen:media-files-changed'));
      throw e;
    }

    targetDownloadId = result.downloadId;

    activeDownload.downloadId = result.downloadId;
    const downloads = new Map(get().activeDownloads);
    downloads.set(result.downloadId, activeDownload);
    set({ activeDownloads: downloads });

    return result;
  },

  cancelDownload: async (downloadId) => {
    await downloadService.cancelDownload(downloadId);
    const downloads = new Map(get().activeDownloads);
    downloads.delete(downloadId);
    set({ activeDownloads: downloads });
  },

  getActiveDownload: (downloadId) => {
    return get().activeDownloads.get(downloadId);
  },

  updateDownloadProgress: (downloadId, progress) => {
    const downloads = new Map(get().activeDownloads);
    const existing = downloads.get(downloadId);
    if (existing) {
      downloads.set(downloadId, {
        ...existing,
        progress: progress.progress,
        speed: progress.speed,
        eta: progress.eta,
        status: progress.status,
      });
      set({ activeDownloads: downloads });
    }
  },

  removeDownload: (downloadId) => {
    const downloads = new Map(get().activeDownloads);
    downloads.delete(downloadId);
    set({ activeDownloads: downloads });
  },
}));
