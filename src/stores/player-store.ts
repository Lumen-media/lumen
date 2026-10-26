import { convertFileSrc } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { ensureMediaWindow, getMediaWindow } from '@/lib/present-window';
import { createStreamSocket } from '@/lib/stream-socket';
import { useModuleStore } from '@/modules/store';
import { getSetting, saveSetting } from '@/services/db';
import { mediaDbService } from '@/services/media-db-service';
import { remoteSyncService } from '@/services/remote-sync-service';
import { urlMediaService } from '@/services/url-media-service';
import { useDownloadStore } from '@/stores/download-store';
import { usePresentationStore } from '@/stores/presentation-store';
import { useQueueEntriesStore } from '@/stores/queue-entries-store';
import {
  broadcastQueueSync,
  setQueueCurrentPathProvider,
  useQueueStore,
} from '@/stores/queue-store';

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
let pendingPlayPause = false;
const SOCKET_COMMIT_DEBOUNCE_MS = 150;
const LIVE_STREAM_MIN_DURATION_SECONDS = 24 * 60 * 60;
const PLAYER_TICK_INTERVAL_MS = 1000;
const PLAY_PAUSE_ECHO_TIMEOUT_MS = 500;

/**
 * Marks a locally issued play/pause command so the `play-pause` event coming
 * back through the WebSocket is not applied a second time.
 */
function markPlayPauseCommand(): void {
  pendingPlayPause = true;
  setTimeout(() => {
    pendingPlayPause = false;
  }, PLAY_PAUSE_ECHO_TIMEOUT_MS);
}

setQueueCurrentPathProvider(() => usePlayerStore.getState().currentFilePath);

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

  const assetUrl = convertFileSrc(source);
  audioBlobUrl = assetUrl;
  audio.src = assetUrl;

  if (seekTime > 0) {
    audio.currentTime = seekTime;
  }

  await audio.play();
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

export function getMediaTypeFromPath(
  filePath: string | null | undefined
): PlayerStore['localMediaType'] {
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

function hasOtherPresentedContent(): boolean {
  const state = usePlayerStore.getState();
  return Boolean(
    state.currentLyricPath ||
      state.currentImagePath ||
      usePresentationStore.getState().isActive ||
      useModuleStore.getState().presenterViewId !== null
  );
}

async function hideMediaWindow(): Promise<void> {
  const win = await getMediaWindow();
  if (!win) return;
  const visible = await win.isVisible().catch(() => false);
  if (visible) {
    await win.hide().catch(() => {});
  }
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
    const socket = createStreamSocket();
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

    const unlistenStop = listen<{ reason?: string }>('stop', (event) => {
      const endedNaturally = event.payload?.reason === 'ended';

      saveSetting('last_time', '0').catch(() => {});
      void broadcastPlayerSync(get, 'stop');
      ipc('push_stream_blank').catch(() => {});

      const result = useQueueEntriesStore.getState().advanceQueue(get().currentFilePath);
      if (result.type === 'play') {
        void get().loadFile(result.path);
        return;
      }

      if (!endedNaturally) return;

      if (hasOtherPresentedContent()) {
        // Presented content keeps the window on screen, and the media stays
        // loaded so play/pause keeps controlling it underneath the overlay.
        set({
          isPlaying: false,
          isScreenOpen: true,
        });
      } else {
        void hideMediaWindow().then(() => set({ isScreenOpen: false }));
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
      // Local play/pause commands round-trip through the WebSocket, so the
      // echo must not toggle the state a second time.
      if (pendingPlayPause) {
        pendingPlayPause = false;
        return;
      }
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
      const mediaType = getMediaTypeFromPath(filePath);
      // A visual track replaces whatever was being presented; audio keeps the
      // current overlay so lyrics remain on screen across tracks.
      const replacesPresentation = mediaType === 'video';
      set({
        isPlaying: true,
        currentFilePath: filePath,
        ...(replacesPresentation
          ? {
              currentLyricPath: null,
              currentImagePath: null,
              currentLyricSlideIndex: 0,
              currentLyricTotalSlides: 0,
            }
          : {}),
        localMediaType: mediaType,
        isLiveStream: false,
        localTime: seekTime,
        localDuration: seekTime > 0 ? get().localDuration : 0,
      });
    });

    const unlistenPlaybackError = listen('video-playback-error', () => {
      const filePath = get().currentFilePath;
      if (!filePath || !urlMediaService.parseYouTubeUrl(filePath)) return;
      if (get().localMediaType !== 'video') return;
      useDownloadStore.getState().openCookiesDialog();
      emit('open-cookies-dialog').catch(() => {});
      toast.warning(
        'Não foi possível reproduzir este vídeo do YouTube. Adicione os cookies da sua conta para desbloquear a reprodução.'
      );
    });

    const unlistenLoadLyric = listen<{ url: string }>('load-lyric', (event) => {
      set({
        currentLyricPath: event.payload.url,
        currentImagePath: null,
        currentLyricSlideIndex: 0,
        currentLyricTotalSlides: 0,
      });
    });

    const unlistenPresentedCleared = listen('presented-content-cleared', () => {
      set({
        currentLyricPath: null,
        currentImagePath: null,
        currentLyricSlideIndex: 0,
        currentLyricTotalSlides: 0,
      });
      void broadcastPlayerSync(get);
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
      void broadcastPresentationSync(get);
    });

    const enqueueRemoteAdd = async (payload: {
      url: string | null;
      media_id: number | null;
      position: number | null;
    }) => {
      try {
        if (payload.media_id !== null) {
          const file = await mediaDbService.getFileInfoById(payload.media_id);
          if (!file) return;
          await useQueueStore.getState().addToQueue(file);
        } else if (payload.url) {
          const id = await useQueueStore.getState().addUrlToQueue(payload.url);
          if (payload.position !== null && id !== undefined) {
            await useQueueStore
              .getState()
              .reorderQueue(reorderForInsert(useQueueStore.getState().queue, payload.position));
          }
        }
      } catch {}
      broadcastQueueSync(0);
    };

    const unlistenRemoteQueueAdd = listen<{
      url: string | null;
      media_id: number | null;
      position: number | null;
    }>('remote-queue-add', (event) => {
      void enqueueRemoteAdd({
        url: event.payload.url ?? null,
        media_id: event.payload.media_id ?? null,
        position: event.payload.position ?? null,
      });
    });

    const unlistenRemoteQueueRemove = listen<{ id: number | string }>(
      'remote-queue-remove',
      (event) => {
        const { id } = event.payload;
        if (typeof id === 'number') {
          void useQueueStore.getState().removeFromQueue(id).catch(() => {});
        } else {
          void useQueueEntriesStore.getState().removeTrigger(id).catch(() => {});
        }
      }
    );

    const unlistenRemoteQueueMove = listen<{ id: number | string; position: number }>(
      'remote-queue-move',
      (event) => {
        void useQueueEntriesStore
          .getState()
          .moveEntry(event.payload.id, event.payload.position)
          .catch(() => {});
      }
    );

    const unlistenRemoteQueueJump = listen<{ id: number | string }>(
      'remote-queue-jump',
      (event) => {
        const { id } = event.payload;
        if (typeof id === 'number') {
          const item = useQueueStore.getState().queue.find((entry) => entry.id === id);
          if (item) {
            void get().loadFile(item.file.path);
          }
        } else {
          void useQueueEntriesStore.getState().fireTrigger(id).catch(() => {});
        }
      }
    );

    const unlistenRemoteQueueShuffle = listen('remote-queue-shuffle', () => {
      void useQueueStore.getState().shuffleQueue().catch(() => {});
    });

    const unlistenRemoteQueueClear = listen('remote-queue-clear', () => {
      void useQueueEntriesStore.getState().clearAll().catch(() => {});
    });

    const tickTimer = setInterval(() => {
      if (get().isPlaying) {
        void broadcastPlayerTick(get);
      }
    }, PLAYER_TICK_INTERVAL_MS);

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
      unlistenPlaybackError.then((f) => f());
      unlistenLoadLyric.then((f) => f());
      unlistenPresentedCleared.then((f) => f());
      unlistenLyricSlideChanged.then((f) => f());
      unlistenRemoteQueueAdd.then((f) => f());
      unlistenRemoteQueueRemove.then((f) => f());
      unlistenRemoteQueueMove.then((f) => f());
      unlistenRemoteQueueJump.then((f) => f());
      unlistenRemoteQueueShuffle.then((f) => f());
      unlistenRemoteQueueClear.then((f) => f());
      clearInterval(tickTimer);
    };
  },

  sendWs: (message) => {
    const { ws } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  },

  handlePlayPause: async () => {
    const { sendWs, restoredFilePath, localTime, localMediaType, currentFilePath } = get();

    if (localMediaType === 'audio' && audioElement) {
      const nextPlaying = audioElement.paused;
      if (nextPlaying) {
        await audioElement.play();
      } else {
        audioElement.pause();
      }
      set({ isPlaying: nextPlaying });
      markPlayPauseCommand();
      sendWs({ event: 'play_pause' });
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
      // The media window owns video playback: reopen it with the current media
      // instead of spawning an empty player that can never be started.
      if (currentFilePath && localMediaType === 'video') {
        await get().loadFile(currentFilePath, localTime);
        return;
      }
      try {
        await ipc('create_window', { label: 'media-window', title: 'Media Player' });
        set({ isPlaying: true });
      } catch {}
      return;
    }

    saveSetting('last_time', String(localTime)).catch(() => {});

    const nextPlaying = !get().isPlaying;
    markPlayPauseCommand();
    if (get().ws?.readyState === WebSocket.OPEN) {
      sendWs({ event: 'play_pause' });
    } else {
      // Without a socket the command would be lost; drive the player window
      // directly so presented content never blocks playback controls.
      emit('play-pause').catch(() => {});
    }
    set({ isPlaying: nextPlaying });
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
    ipc('push_stream_blank').catch(() => {});

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
      const { currentFilePath, localTime } = get();
      // The window may have been closed while media was loaded; reopen it with
      // that media instead of spawning an empty player that can never start.
      if (currentFilePath) {
        await get().loadFile(currentFilePath, localTime);
        return;
      }
      try {
        await ipc('create_window', { label: 'media-window', title: 'Media Player' });
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
        ipc('push_stream_blank').catch(() => {});
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
    let source = normalizeMediaSource(filePath);
    if (urlMediaService.parseYouTubeUrl(source)) {
      try {
        const fileInfo = await mediaDbService.getFileInfoByOriginalUrl(source);
        if (
          fileInfo?.downloadStatus === 'downloaded' &&
          fileInfo.path &&
          !fileInfo.path.startsWith('http')
        ) {
          source = fileInfo.path;
        }
      } catch {}
    }

    const ext = source.split('.').pop()?.toLowerCase() ?? '';
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'svg'];
    const isPresentation = ext === 'ppt' || ext === 'pptx';
    const isImage = imageExtensions.includes(ext);

    if (isPresentation) {
      const win = await ensureMediaWindow();
      if (!win) return;
      usePresentationStore.getState().loadPresentation(source);
      await win.show();
      await win.setFullscreen(true);
      return;
    }

    if (isImage) {
      await get().presentImage(source);
      return;
    }

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

function nowUnixMillis() {
  return Date.now();
}

/**
 * Returns a new id order where `id` has been moved to `position`, or the
 * original order when `id` is not present.
 */
function reorderForInsert(queue: Array<{ id: number }>, position: number): number[] {
  const ids = queue.map((item) => item.id);
  if (ids.length === 0) return ids;
  const last = ids.pop() as number;
  const clamped = Math.max(0, Math.min(position, ids.length));
  ids.splice(clamped, 0, last);
  return ids;
}

async function broadcastPlayerTick(get: () => PlayerStore): Promise<void> {
  const state = get();
  await remoteSyncService
    .broadcastRaw(
      {
        event: 'player_tick',
        position: state.localTime,
        duration: state.localDuration,
        is_playing: state.isPlaying,
        sent_at_ms: nowUnixMillis(),
      },
      'player'
    )
    .catch(() => {});
}

async function broadcastPresentationSync(get: () => PlayerStore): Promise<void> {
  const state = get();
  const presentation = usePresentationStore.getState();

  let kind: 'lyrics' | 'presentation' | 'module' | 'none' = 'none';
  let slideIndex = 0;
  let totalSlides = 0;
  let currentDeck: string | undefined;

  if (state.currentLyricPath) {
    kind = 'lyrics';
    slideIndex = state.currentLyricSlideIndex;
    totalSlides = state.currentLyricTotalSlides;
    currentDeck = state.currentLyricPath;
  } else if (presentation.isActive) {
    kind = 'presentation';
    slideIndex = presentation.currentSlide;
    totalSlides = presentation.totalSlides;
    currentDeck = presentation.filePath ?? undefined;
  }

  await remoteSyncService
    .broadcastRaw(
      {
        event: 'presentation_sync',
        kind,
        current_deck: currentDeck,
        slide_index: slideIndex,
        total_slides: totalSlides,
        is_black: presentation.isBlackout,
        is_wallpaper: presentation.isWallpaper,
      },
      'presentation'
    )
    .catch(() => {});
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

usePlayerStore.subscribe((state, previous) => {
  if (
    state.currentFilePath !== previous.currentFilePath ||
    state.isPlaying !== previous.isPlaying
  ) {
    broadcastQueueSync(0);
  }
});

usePresentationStore.subscribe((state, previous) => {
  if (
    state.currentSlide !== previous.currentSlide ||
    state.totalSlides !== previous.totalSlides ||
    state.isActive !== previous.isActive ||
    state.filePath !== previous.filePath ||
    state.isBlackout !== previous.isBlackout ||
    state.isWallpaper !== previous.isWallpaper
  ) {
    void broadcastPresentationSync(() => usePlayerStore.getState());
  }
});
