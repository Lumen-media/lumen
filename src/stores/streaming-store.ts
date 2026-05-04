import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

import {
  type StreamingConfig,
  type StreamingStatus,
  streamingService,
} from '@/services/streaming-service';

interface MobileStreamState {
  device_id: string;
  device_name: string;
  has_video: boolean;
  has_audio: boolean;
  video_orientation?: 'portrait' | 'landscape' | null;
}

interface StreamingStore {
  initialized: boolean;
  config: StreamingConfig;
  status: StreamingStatus;
  mobileStreams: Record<string, MobileStreamState>;
  init: () => Promise<void>;
  updateConfig: (partial: Partial<StreamingConfig>) => Promise<void>;
  setContentProtection: (isProtected: boolean) => Promise<void>;
  pushBlank: () => Promise<void>;
}

const DEFAULT_CONFIG: StreamingConfig = {
  preview_enabled: true,
  main_fps: 1,
  main_resolution: '1080p',
  html_server_enabled: false,
  html_server_port: 8090,
  hardware_encoding: false,
  content_protection: true,
};

const DEFAULT_STATUS: StreamingStatus = {
  preview_subs: 0,
  main_subs: 0,
  mobile_connected: false,
  html_active: false,
  html_url: null,
};

let unlistenStatus: UnlistenFn | null = null;
let unlistenMobileStarted: UnlistenFn | null = null;
let unlistenMobileEnded: UnlistenFn | null = null;
let unlistenMobileOrientationChanged: UnlistenFn | null = null;

export const useStreamingStore = create<StreamingStore>((set, get) => ({
  initialized: false,
  config: DEFAULT_CONFIG,
  status: DEFAULT_STATUS,
  mobileStreams: {},

  init: async () => {
    if (get().initialized) {
      return;
    }

    const [config, status] = await Promise.all([
      streamingService.getConfig(),
      streamingService.getStatus(),
    ]);

    set({ config, status, initialized: true });

    unlistenStatus?.();
    unlistenMobileStarted?.();
    unlistenMobileEnded?.();
    unlistenMobileOrientationChanged?.();

    unlistenStatus = await listen<StreamingStatus>('streaming_status_changed', ({ payload }) => {
      set({ status: payload });
    });

    unlistenMobileStarted = await listen<MobileStreamState>('mobile_stream_started', ({ payload }) => {
      const nextPayload: MobileStreamState = {
        device_id: payload.device_id,
        device_name: (payload.device_name as string) || payload.device_id,
        has_video: Boolean(payload.has_video),
        has_audio: Boolean(payload.has_audio),
        video_orientation: payload.video_orientation ?? null,
      };
      set((state) => ({
        mobileStreams: {
          ...state.mobileStreams,
          [nextPayload.device_id]: nextPayload,
        },
      }));
    });

    unlistenMobileEnded = await listen<{ device_id: string }>('mobile_stream_ended', ({ payload }) => {
      set((state) => {
        if (!state.mobileStreams[payload.device_id]) {
          return state;
        }
        const next = { ...state.mobileStreams };
        delete next[payload.device_id];
        return { mobileStreams: next };
      });
    });

    unlistenMobileOrientationChanged = await listen<{
      device_id: string;
      video_orientation?: 'portrait' | 'landscape' | null;
    }>('mobile_stream_orientation_changed', ({ payload }) => {
      set((state) => {
        const current = state.mobileStreams[payload.device_id];
        if (!current) {
          return state;
        }

        return {
          mobileStreams: {
            ...state.mobileStreams,
            [payload.device_id]: {
              ...current,
              video_orientation: payload.video_orientation ?? null,
            },
          },
        };
      });
    });
  },

  updateConfig: async (partial) => {
    const next = { ...get().config, ...partial } as StreamingConfig;
    const saved = await streamingService.updateConfig(next);
    set({ config: saved });
  },

  setContentProtection: async (isProtected) => {
    await streamingService.setContentProtected(isProtected);
  },

  pushBlank: async () => {
    await streamingService.pushBlank();
  },
}));
