import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { create } from 'zustand';
import { getSetting, saveSetting } from '@/services/db';
import { useQueueStore } from '@/stores/queue-store';

interface PlayerStore {
  localTime: number;
  localDuration: number;
  localTitle: string;
  localArtist: string;
  localUrl: string | undefined;
  localMediaType: 'audio' | 'video' | 'stream' | undefined;
  isLoop: boolean;
  isScreenOpen: boolean;
  volume: number;
  isMuted: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  ws: WebSocket | null;
  restoredFilePath: string | null;
  currentFilePath: string | null;

  initWs: () => () => void;
  initListeners: () => () => void;
  sendWs: (message: object) => void;
  handlePlayPause: () => Promise<void>;
  handleStop: () => Promise<void>;
  handlePrevious: () => void;
  handleNext: () => void;
  handleLoop: () => void;
  handleVolumeChange: (value: number[]) => void;
  handleMuteToggle: () => void;
  handleToggleScreen: () => Promise<void>;
  handleSliderChange: (value: number[]) => void;
  setIsDragging: (dragging: boolean) => void;
  loadFile: (filePath: string, seekTime?: number) => Promise<void>;
  restoreLastMedia: () => Promise<void>;
}

async function getMediaWindow() {
  return WebviewWindow.getByLabel('media-window');
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  localTime: 0,
  localDuration: 0,
  localTitle: '',
  localArtist: '',
  localUrl: undefined,
  localMediaType: undefined,
  isLoop: false,
  isScreenOpen: false,
  volume: 100,
  isMuted: false,
  isPlaying: false,
  isDragging: false,
  ws: null,
  restoredFilePath: null,
  currentFilePath: null,

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

    const unlistenProgress = listen<{ seconds: number; duration: number }>(
      'video-progress',
      (event) => {
        if (get().isDragging) return;
        set({ localTime: event.payload.seconds });
        if (event.payload.duration > 0) {
          set({ localDuration: event.payload.duration });
          if (Math.abs(event.payload.duration - lastSavedDuration) > 1) {
            lastSavedDuration = event.payload.duration;
            saveSetting('last_duration', String(event.payload.duration)).catch(() => {});

            if (get().currentFilePath) {
              useQueueStore
                .getState()
                .updateMetadata(get().currentFilePath, { duration: event.payload.duration })
                .catch(() => {});
            }
          }
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

        if (get().currentFilePath) {
          useQueueStore
            .getState()
            .updateMetadata(get().currentFilePath, { title, artist })
            .catch(() => {});
        }
      }
    );

    const unlistenStop = listen('stop', () => {
      set({ isPlaying: false, isScreenOpen: false });
      saveSetting('last_time', '0').catch(() => {});

      useQueueStore
        .getState()
        .shiftQueue(get().currentFilePath ?? undefined)
        .then((next) => {
          if (next) get().loadFile(next.path);
        });
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenMeta.then((f) => f());
      unlistenStop.then((f) => f());
    };
  },

  sendWs: (message) => {
    const { ws } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  },

  handlePlayPause: async () => {
    const { sendWs, isPlaying, restoredFilePath, localTime } = get();

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
  },

  handleStop: async () => {
    const { sendWs } = get();
    sendWs({ event: 'stop' });
    set({ localTime: 0, isPlaying: false });
    saveSetting('last_time', '0').catch(() => {});

    const win = await getMediaWindow();
    if (win) {
      const visible = await win.isVisible();
      if (visible) {
        await win.hide();
        set({ isScreenOpen: false });
      }
    }
  },

  handlePrevious: () => get().sendWs({ event: 'previous' }),

  handleNext: () => get().sendWs({ event: 'next' }),

  handleLoop: () => {
    const next = !get().isLoop;
    set({ isLoop: next });
    get().sendWs({ event: 'set_loop', value: next ? 1 : 0 });
  },

  handleVolumeChange: (value) => {
    const v = value[0] ?? 100;
    set({ volume: v });
    get().sendWs({ event: 'set_volume', value: v });
    saveSetting('last_volume', String(v)).catch(() => {});
  },

  handleMuteToggle: () => {
    const { isMuted, volume, sendWs } = get();
    const next = !isMuted;
    set({ isMuted: next });
    sendWs({ event: 'set_volume', value: next ? 0 : volume });
  },

  handleToggleScreen: async () => {
    const { localMediaType } = get();

    const existing = await getMediaWindow();
    if (!existing) {
      if (localMediaType !== 'video') return;
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        const win = await getMediaWindow();
        await win?.show();
        set({ isScreenOpen: true });
      } catch {}
      return;
    }

    const visible = await existing.isVisible();
    if (visible) {
      await existing.hide();
      set({ isScreenOpen: false });
    } else {
      if (localMediaType !== 'video') return;
      await existing.show();
      set({ isScreenOpen: true });
    }
  },

  handleSliderChange: (value) => {
    const newTime = value[0] ?? 0;
    get().sendWs({ event: 'seek', value: newTime });
    set({ localTime: newTime });
  },

  setIsDragging: (dragging) => set({ isDragging: dragging }),

  loadFile: async (filePath: string, seekTime = 0) => {
    const videoExtensions = ['mp4', 'webm', 'mkv', 'avi', 'mov'];
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const isVideo = videoExtensions.includes(ext);

    let win = await getMediaWindow();
    if (!win) {
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        await new Promise((r) => setTimeout(r, 800));
        win = await getMediaWindow();
      } catch {
        return;
      }
    }

    // Wait up to 3s for WS to be open before sending
    const deadline = Date.now() + 3000;
    while (get().ws?.readyState !== WebSocket.OPEN) {
      if (Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, 50));
    }

    get().sendWs({ event: 'load_url', url: filePath, value: seekTime });
    set({
      isPlaying: true,
      localMediaType: isVideo ? 'video' : 'audio',
      restoredFilePath: null,
      currentFilePath: filePath,
      localTime: seekTime > 0 ? seekTime : 0,
      localDuration: seekTime > 0 ? get().localDuration : 0,
    });

    saveSetting('last_media_path', filePath).catch(() => {});
    saveSetting('last_media_type', isVideo ? 'video' : 'audio').catch(() => {});
    saveSetting('last_time', '0').catch(() => {});

    if (isVideo && win) {
      await win.show();
      set({ isScreenOpen: true });
    }
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
