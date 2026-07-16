import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readFile } from '@tauri-apps/plugin-fs';
import { create } from 'zustand';
import { useModuleStore } from '@/modules/store';
import { getSetting, saveSetting } from '@/services/db';
import { remoteSyncService } from '@/services/remote-sync-service';
import { urlMediaService } from '@/services/url-media-service';
import { useQueueEntriesStore } from '@/stores/queue-entries-store';
import { useQueueStore } from '@/stores/queue-store';

interface PlayerStore {
  localTime: number;
  localDuration: number;
  localTitle: string;
  localArtist: string;
  localUrl: string | undefined;
  localMediaType: 'audio' | 'video' | 'stream' | undefined;
  isLiveStream: boolean;
  isLoop: boolean;
  isScreenOpen: boolean;
  volume: number;
  isMuted: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  ws: WebSocket | null;
  restoredFilePath: string | null;
  currentFilePath: string | null;
  currentLyricPath: string | null;
  currentLyricSlideIndex: number;
  currentLyricTotalSlides: number;
  currentImagePath: string | null;

  initWs: () => () => void;
  initListeners: () => () => void;
  sendWs: (message: object) => void;
  handlePlayPause: () => Promise<void>;
  handleStop: () => Promise<void>;
  handlePrevious: () => void;
  handleNext: () => void;
  handleLoop: () => void;
  handleVolumeChange: (value: number[]) => void;
  handleVolumeCommit: (value: number[]) => void;
  handleMuteToggle: () => void;
  handleToggleScreen: () => Promise<void>;
  handleSliderChange: (value: number[]) => void;
  handleSliderCommit: (value: number[]) => void;
  setIsDragging: (dragging: boolean) => void;
  loadFile: (filePath: string, seekTime?: number) => Promise<void>;
  presentLyric: (filePath: string, startIndex?: number) => Promise<void>;
  presentImage: (filePath: string) => Promise<void>;
  restoreLastMedia: () => Promise<void>;
}

let volumeCommitTimeout: ReturnType<typeof setTimeout> | null = null;
let seekCommitTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingMute = false;
const SOCKET_COMMIT_DEBOUNCE_MS = 150;
const LIVE_STREAM_MIN_DURATION_SECONDS = 24 * 60 * 60;

let audioElement: HTMLAudioElement | null = null;
let audioBlobUrl: string | null = null;

function getAudioPlayer(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.addEventListener('timeupdate', () => {
      const store = usePlayerStore.getState();
      if (store.isDragging) return;
      if (audioElement?.duration) {
        store.sendWs({
          event: 'progress',
          value: audioElement.currentTime,
          duration: audioElement.duration,
        });
      }
    });
    audioElement.addEventListener('ended', () => {
      usePlayerStore.getState().handleStop();
    });
  }
  return audioElement;
}

async function playAudio(source: string, seekTime: number): Promise<void> {
  const audio = getAudioPlayer();
  audio.pause();
  audio.src = '';
  if (audioBlobUrl) {
    URL.revokeObjectURL(audioBlobUrl);
    audioBlobUrl = null;
  }

  const blobUrl = URL.createObjectURL(new Blob([await readFile(source)]));
  audioBlobUrl = blobUrl;
  audio.src = blobUrl;

  if (seekTime > 0) {
    audio.currentTime = seekTime;
  }

  await audio.play();
}

async function getMediaWindow() {
  return WebviewWindow.getByLabel('media-window');
}

async function waitForMediaWindowReady(timeoutMs = 3000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let done = false;
    let timeoutId: number | undefined;
    let cleanupPromise: Promise<UnlistenFn> | null = null;

    const finish = (callback: () => void) => {
      if (done) return;
      done = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (cleanupPromise) {
        cleanupPromise.then((unlisten) => unlisten()).catch(() => {});
      }
      callback();
    };

    cleanupPromise = listen('media-window-ready', () => {
      finish(resolve);
    });

    timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error('Timed out waiting for media window readiness')));
    }, timeoutMs);
  });
}

async function ensureMediaWindow(): Promise<WebviewWindow | null> {
  const existing = await getMediaWindow();
  if (existing) return existing;

  try {
    const readyPromise = waitForMediaWindowReady();
    await invoke('create_window', { label: 'media-window', title: 'Media Player' });
    await readyPromise;
    return await getMediaWindow();
  } catch {
    return null;
  }
}

async function waitForWsOpen(get: () => PlayerStore, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (get().ws?.readyState !== WebSocket.OPEN) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

function normalizeMediaSource(source: string): string {
  return urlMediaService.parseYouTubeUrl(source)?.canonicalUrl ?? source;
}

function getMediaTypeFromPath(filePath: string | null | undefined): PlayerStore['localMediaType'] {
  if (!filePath) return undefined;
  if (urlMediaService.parseYouTubeUrl(filePath)) return 'video';
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const videoExtensions = ['mp4', 'webm', 'mkv', 'avi', 'mov'];
  if (videoExtensions.includes(ext)) {
    return 'video';
  }
  return 'audio';
}

function isLiveLikeYouTubeStream(
  filePath: string | null | undefined,
  seconds: number,
  duration: number
): boolean {
  if (!filePath || !urlMediaService.parseYouTubeUrl(filePath)) return false;
  if (!Number.isFinite(seconds) || !Number.isFinite(duration)) return false;
  return duration >= LIVE_STREAM_MIN_DURATION_SECONDS;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  localTime: 0,
  localDuration: 0,
  localTitle: '',
  localArtist: '',
  localUrl: undefined,
  localMediaType: undefined,
  isLiveStream: false,
  isLoop: false,
  isScreenOpen: false,
  volume: 100,
  isMuted: false,
  isPlaying: false,
  isDragging: false,
  ws: null,
  restoredFilePath: null,
  currentFilePath: null,
  currentLyricPath: null,
  currentLyricSlideIndex: 0,
  currentLyricTotalSlides: 0,
  currentImagePath: null,

  initWs: () => {
    const socket = new WebSocket('ws://localhost:8080');
    socket.onopen = () => set({ ws: socket });
    socket.onclose = () => set({ ws: null });
    socket.onerror = () => set({ ws: null });
    return () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  },

  initListeners: () => {
    let lastSavedDuration = 0;
    let lastSyncBucket = -1;

    const unlistenProgress = listen<{ seconds: number; duration: number }>(
      'video-progress',
      (event) => {
        if (get().isDragging) return;
        const seconds = Number(event.payload.seconds) || 0;
        const duration = Number(event.payload.duration) || 0;
        const isLiveStream = isLiveLikeYouTubeStream(get().currentFilePath, seconds, duration);

        if (isLiveStream) {
          set({ localTime: 0, localDuration: 0, isLiveStream: true });
        } else {
          set({ localTime: seconds, isLiveStream: false });
          if (duration > 0) {
            set({ localDuration: duration });
            if (Math.abs(duration - lastSavedDuration) > 1) {
              lastSavedDuration = duration;
              saveSetting('last_duration', String(duration)).catch(() => {});

              const filePath = get().currentFilePath;
              if (filePath) {
                useQueueStore
                  .getState()
                  .updateMetadata(filePath, { duration })
                  .catch(() => {});
              }
            }
          }
        }

        const nextBucket = Math.floor(seconds / 10);
        if (get().isPlaying && nextBucket !== lastSyncBucket) {
          lastSyncBucket = nextBucket;
          void broadcastPlayerSync(get, 'interval');
        }
      }
    );

    const unlistenMeta = listen<{ title: string; url: string; artist: string }>(
      'video-metadata',
      (event) => {
        const { title, url, artist } = event.payload;
        set({ localTitle: title, localUrl: url, localArtist: artist });
        saveSetting('last_title', title).catch(() => {});
        saveSetting('last_artist', artist).catch(() => {});

        const metaFilePath = get().currentFilePath;
        if (metaFilePath) {
          useQueueStore
            .getState()
            .updateMetadata(metaFilePath, { title, artist })
            .catch(() => {});
        }

        void broadcastPlayerSync(get, 'metadata');
      }
    );

    const unlistenStop = listen('stop', () => {
      set({ isPlaying: false, isScreenOpen: false });
      saveSetting('last_time', '0').catch(() => {});
      void broadcastPlayerSync(get, 'stop');
      invoke('push_stream_blank').catch(() => {});

      const result = useQueueEntriesStore.getState().advanceQueue(get().currentFilePath);
      if (result.type === 'play') {
        void get().loadFile(result.path);
      }
    });

    const unlistenSetVolume = listen<number>('set-volume', (event) => {
      const nextVolume = Math.max(0, Math.min(100, Number(event.payload) || 0));
      set({
        volume: nextVolume,
        isMuted: nextVolume === 0,
      });
    });

    const unlistenMute = listen('mute', () => {
      if (pendingMute) {
        pendingMute = false;
        return;
      }
      const current = get();
      set({ isMuted: !current.isMuted });
    });

    const unlistenPlayPause = listen('play-pause', () => {
      set((state) => ({ isPlaying: !state.isPlaying }));
    });

    const unlistenSeek = listen<number>('seek', (event) => {
      if (get().isDragging) return;
      set({ localTime: Number(event.payload) || 0 });
    });

    const unlistenLoop = listen<boolean>('video-loop', (event) => {
      set({ isLoop: Boolean(event.payload) });
    });

    const unlistenLoadUrl = listen<{ url: string; time: number }>('load-url', (event) => {
      const filePath = normalizeMediaSource(event.payload.url);
      const seekTime = Number(event.payload.time) || 0;
      set({
        isPlaying: true,
        currentFilePath: filePath,
        currentLyricPath: null,
        currentImagePath: null,
        currentLyricSlideIndex: 0,
        currentLyricTotalSlides: 0,
        localMediaType: getMediaTypeFromPath(filePath),
        isLiveStream: false,
        localTime: seekTime,
        localDuration: seekTime > 0 ? get().localDuration : 0,
      });
    });

    const unlistenLoadLyric = listen<{ url: string }>('load-lyric', (event) => {
      set({
        currentLyricPath: event.payload.url,
        currentImagePath: null,
        currentLyricSlideIndex: 0,
        currentLyricTotalSlides: 0,
      });
    });

    const unlistenLyricSlideChanged = listen<{
      filePath: string;
      slideIndex: number;
      totalSlides: number;
    }>('lyric-slide-changed', (event) => {
      set({
        currentLyricPath: event.payload.filePath,
        currentLyricSlideIndex: event.payload.slideIndex,
        currentLyricTotalSlides: event.payload.totalSlides,
      });
      void broadcastPlayerSync(get, 'lyric_slide_changed');
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenMeta.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenSetVolume.then((f) => f());
      unlistenMute.then((f) => f());
      unlistenPlayPause.then((f) => f());
      unlistenSeek.then((f) => f());
      unlistenLoop.then((f) => f());
      unlistenLoadUrl.then((f) => f());
      unlistenLoadLyric.then((f) => f());
      unlistenLyricSlideChanged.then((f) => f());
    };
  },

  sendWs: (message) => {
    const { ws } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  },

  handlePlayPause: async () => {
    const { sendWs, isPlaying, restoredFilePath, localTime, localMediaType } = get();

    if (localMediaType === 'audio' && audioElement) {
      if (audioElement.paused) {
        await audioElement.play();
        set({ isPlaying: true });
        sendWs({ event: 'play_pause' });
      } else {
        audioElement.pause();
        set({ isPlaying: false });
        sendWs({ event: 'play_pause' });
      }
      void broadcastPlayerSync(get, 'play_pause');
      return;
    }

    if (restoredFilePath) {
      const seekTime = get().localTime;
      set({ restoredFilePath: null });
      await get().loadFile(restoredFilePath, seekTime);
      return;
    }

    const existing = await getMediaWindow();
    if (!existing) {
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        set({ isPlaying: true });
      } catch {}
      return;
    }

    saveSetting('last_time', String(localTime)).catch(() => {});

    sendWs({ event: 'play_pause' });
    set({ isPlaying: !isPlaying });
    void broadcastPlayerSync(get, 'play_pause');
  },

  handleStop: async () => {
    const { sendWs, localMediaType } = get();

    if (localMediaType === 'audio' && audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    sendWs({ event: 'stop' });
    set({ localTime: 0, isPlaying: false });
    saveSetting('last_time', '0').catch(() => {});
    void broadcastPlayerSync(get, 'stop');
    invoke('push_stream_blank').catch(() => {});

    const win = await getMediaWindow();
    if (win) {
      const visible = await win.isVisible();
      if (visible) {
        await win.hide();
        set({ isScreenOpen: false });
      }
    }
  },

  handlePrevious: () => {
    get().sendWs({ event: 'previous' });
    void broadcastPlayerSync(get, 'previous');
  },

  handleNext: () => {
    get().sendWs({ event: 'next' });
    void broadcastPlayerSync(get, 'next');
  },

  handleLoop: () => {
    const next = !get().isLoop;
    set({ isLoop: next });
    get().sendWs({ event: 'set_loop', value: next ? 1 : 0 });
    void broadcastPlayerSync(get, 'set_loop');
  },

  handleVolumeChange: (value) => {
    const v = value[0] ?? 100;
    set({ volume: v });
  },

  handleVolumeCommit: (value) => {
    const v = value[0] ?? get().volume;
    set({ volume: v });
    if (audioElement) {
      audioElement.volume = v / 100;
    }
    if (volumeCommitTimeout) {
      clearTimeout(volumeCommitTimeout);
    }
    volumeCommitTimeout = setTimeout(() => {
      get().sendWs({ event: 'set_volume', value: v });
      saveSetting('last_volume', String(v)).catch(() => {});
      void broadcastPlayerSync(get, 'set_volume');
      volumeCommitTimeout = null;
    }, SOCKET_COMMIT_DEBOUNCE_MS);
  },

  handleMuteToggle: () => {
    const { isMuted, sendWs } = get();
    pendingMute = true;
    set({ isMuted: !isMuted });
    if (audioElement) {
      audioElement.muted = !isMuted;
    }
    sendWs({ event: 'mute' });
    void broadcastPlayerSync(get, 'mute');
  },

  handleToggleScreen: async () => {
    const { localMediaType, isScreenOpen } = get();

    const existing = await getMediaWindow();
    if (!existing) {
      if (localMediaType !== 'video') return;
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        const win = await getMediaWindow();
        if (win) {
          await win.show();
          await win.setFullscreen(true);
        }
        set({ isScreenOpen: true });
      } catch {}
      return;
    }

    if (isScreenOpen) {
      const { currentLyricPath, currentImagePath } = get();
      const hasPresenter = useModuleStore.getState().presenterViewId !== null;
      const hasOtherContent = currentLyricPath || currentImagePath || hasPresenter;

      if (hasOtherContent) {
        invoke('push_stream_blank').catch(() => {});
        set({ isScreenOpen: false });
      } else {
        await existing.hide();
        set({ isScreenOpen: false });
      }
    } else {
      if (localMediaType !== 'video') return;
      await existing.show();
      const { currentFilePath, localTime } = get();
      if (currentFilePath) {
        get().sendWs({ event: 'load_url', url: currentFilePath, value: localTime });
      }
      set({ isScreenOpen: true });
    }
  },

  handleSliderChange: (value) => {
    const newTime = value[0] ?? 0;
    set({ localTime: newTime });
  },

  handleSliderCommit: (value) => {
    const newTime = value[0] ?? get().localTime;
    set({ localTime: newTime, isDragging: false });

    const { localMediaType } = get();
    if (localMediaType === 'audio' && audioElement) {
      audioElement.currentTime = newTime;
    }

    if (seekCommitTimeout) {
      clearTimeout(seekCommitTimeout);
    }
    seekCommitTimeout = setTimeout(() => {
      get().sendWs({ event: 'seek', value: newTime });
      void broadcastPlayerSync(get, 'seek');
      seekCommitTimeout = null;
    }, SOCKET_COMMIT_DEBOUNCE_MS);
  },

  setIsDragging: (dragging) => set({ isDragging: dragging }),

  loadFile: async (filePath: string, seekTime = 0) => {
    const source = normalizeMediaSource(filePath);
    const isVideo = getMediaTypeFromPath(source) === 'video';

    if (!isVideo) {
      try {
        await playAudio(source, seekTime);
      } catch {
        return;
      }
      await waitForWsOpen(get);
    }

    if (isVideo) {
      const win = await ensureMediaWindow();
      if (!win) return;
      const ok = await waitForWsOpen(get);
      if (!ok) return;
      await win.show();
      await win.setFullscreen(true);
      set({ isScreenOpen: true });
    }

    get().sendWs({ event: 'load_url', url: source, value: seekTime });
    set({
      isPlaying: true,
      localMediaType: isVideo ? 'video' : 'audio',
      isLiveStream: false,
      restoredFilePath: null,
      currentFilePath: source,
      currentLyricPath: null,
      currentLyricSlideIndex: 0,
      currentLyricTotalSlides: 0,
      localTime: seekTime > 0 ? seekTime : 0,
      localDuration: seekTime > 0 ? get().localDuration : 0,
    });

    saveSetting('last_media_path', source).catch(() => {});
    saveSetting('last_media_type', isVideo ? 'video' : 'audio').catch(() => {});
    saveSetting('last_time', '0').catch(() => {});
    void broadcastPlayerSync(get, 'load_url');
  },

  presentLyric: async (filePath: string, startIndex = 0) => {
    const win = await ensureMediaWindow();
    if (!win) return;

    const ok = await waitForWsOpen(get);
    if (!ok) return;

    await emit('load-lyric', { url: filePath });
    get().sendWs({ event: 'load_lyric', url: filePath, startIndex });
    emit('lyric-start-slide', { startIndex }).catch(() => {});
    set({
      currentLyricPath: filePath,
      currentImagePath: null,
      currentLyricSlideIndex: 0,
      currentLyricTotalSlides: 0,
    });
    void broadcastPlayerSync(get, 'load_lyric');

    await win.show();
    await win.setFullscreen(true);
    set({ isScreenOpen: true });
  },

  presentImage: async (filePath: string) => {
    const win = await ensureMediaWindow();
    if (!win) return;

    await emit('load-image', { url: filePath });
    set({ currentImagePath: filePath, currentLyricPath: null });

    await win.show();
    await win.setFullscreen(true);
    set({ isScreenOpen: true });
  },

  restoreLastMedia: async () => {
    try {
      const [path, type, title, artist, duration, time, volume] = await Promise.all([
        getSetting('last_media_path'),
        getSetting('last_media_type'),
        getSetting('last_title'),
        getSetting('last_artist'),
        getSetting('last_duration'),
        getSetting('last_time'),
        getSetting('last_volume'),
      ]);

      if (!path) return;

      set({
        restoredFilePath: path,
        localMediaType: (type as 'audio' | 'video') ?? undefined,
        isLiveStream: false,
        localTitle: title ?? '',
        localArtist: artist ?? '',
        localUrl: undefined,
        localDuration: duration ? Number(duration) : 0,
        localTime: time ? Number(time) : 0,
        volume: volume ? Number(volume) : 100,
      });
    } catch {}
  },
}));

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function broadcastPlayerSync(get: () => PlayerStore, action?: string): Promise<void> {
  const state = get();
  await remoteSyncService.broadcast(
    {
      event: 'player_sync',
      media: {
        url: state.currentFilePath ?? undefined,
        title: state.localTitle || undefined,
        artist: state.localArtist || undefined,
        type: state.localMediaType,
      },
      playback: {
        is_playing: state.isPlaying,
        position: state.localTime,
        duration: state.localDuration,
        sent_at: nowUnixSeconds(),
      },
      state: {
        is_loop: state.isLoop,
        is_muted: state.isMuted,
        volume: state.volume,
      },
      lyric: {
        active: Boolean(state.currentLyricPath),
        url: state.currentLyricPath ?? undefined,
        slide_index: state.currentLyricPath ? state.currentLyricSlideIndex : undefined,
        total_slides: state.currentLyricPath
          ? state.currentLyricTotalSlides || undefined
          : undefined,
      },
      action,
    },
    undefined
  );
}
