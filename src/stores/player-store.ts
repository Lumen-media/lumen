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
}

async function getMediaWindow() {
  return WebviewWindow.getByLabel('media-window');
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
      set({ isPlaying: false, isScreenOpen: false });
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
    const { sendWs, isPlaying } = get();

    const existing = await getMediaWindow();
    if (!existing) {
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        set({ isPlaying: true });
      } catch {}
      return;
    }

    sendWs({ event: 'play_pause' });
    set({ isPlaying: !isPlaying });
  },

  handleStop: async () => {
    const { sendWs } = get();
    sendWs({ event: 'stop' });
    set({ localTime: 0, isPlaying: false });

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
  },

  handleMuteToggle: () => {
    const { isMuted, volume, sendWs } = get();
    const next = !isMuted;
    set({ isMuted: next });
    sendWs({ event: 'set_volume', value: next ? 0 : volume });
  },

  handleToggleScreen: async () => {
    const existing = await getMediaWindow();
    if (!existing) {
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
}));
