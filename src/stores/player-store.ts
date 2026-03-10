import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { create } from 'zustand';

interface PlayerStore {
  localTime: number;
  localDuration: number;
  localTitle: string;
  localUrl: string | undefined;
  isLoop: boolean;
  isScreenOpen: boolean;
  volume: number;
  isMuted: boolean;
  isPlaying: boolean;
  isDragging: boolean;
  ws: WebSocket | null;

  initWs: () => () => void;
  initListeners: () => () => void;
  sendWs: (message: object) => void;
  handlePlayPause: () => void;
  handleStop: () => void;
  handlePrevious: () => void;
  handleNext: () => void;
  handleLoop: () => void;
  handleVolumeChange: (value: number[]) => void;
  handleMuteToggle: () => void;
  handleToggleScreen: () => Promise<void>;
  handleSliderChange: (value: number[]) => void;
  setIsDragging: (dragging: boolean) => void;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  localTime: 0,
  localDuration: 0,
  localTitle: 'Untitled',
  localUrl: undefined,
  isLoop: false,
  isScreenOpen: false,
  volume: 100,
  isMuted: false,
  isPlaying: false,
  isDragging: false,
  ws: null,

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
    const unlistenProgress = listen<{ seconds: number; duration: number }>(
      'video-progress',
      (event) => {
        if (get().isDragging) return;
        set({ localTime: event.payload.seconds });
        if (event.payload.duration > 0) set({ localDuration: event.payload.duration });
      }
    );

    const unlistenMeta = listen<{ title: string; url: string }>('video-metadata', (event) => {
      set({ localTitle: event.payload.title, localUrl: event.payload.url });
    });

    const unlistenStop = listen('stop', () => {
      set({ isScreenOpen: false, isPlaying: false });
    });

    const unlistenPlayPause = listen('play-pause', () => {
      set((state) => ({ isPlaying: !state.isPlaying }));
    });

    const unlistenManualPause = listen('manual_pause', () => {
      set({ isPlaying: false });
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenMeta.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenPlayPause.then((f) => f());
      unlistenManualPause.then((f) => f());
    };
  },

  sendWs: (message) => {
    const { ws } = get();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  },

  handlePlayPause: () => {
    const { sendWs, isPlaying } = get();
    sendWs({ event: 'play_pause' });
    set({ isPlaying: !isPlaying });
  },

  handleStop: () => {
    const { sendWs } = get();
    sendWs({ event: 'stop' });
    set({ localTime: 0 });
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
  },

  handleMuteToggle: () => {
    const { isMuted, volume, sendWs } = get();
    const next = !isMuted;
    set({ isMuted: next });
    sendWs({ event: 'set_volume', value: next ? 0 : volume });
  },

  handleToggleScreen: async () => {
    const existing = await WebviewWindow.getByLabel('media-window');
    if (existing) {
      await existing.close();
      set({ isScreenOpen: false });
    } else {
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        set({ isScreenOpen: true });
      } catch {}
    }
  },

  handleSliderChange: (value) => {
    const newTime = value[0] ?? 0;
    get().sendWs({ event: 'seek', value: newTime });
    set({ localTime: newTime });
  },

  setIsDragging: (dragging) => set({ isDragging: dragging }),
}));
