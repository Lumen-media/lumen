import { invoke } from '@tauri-apps/api/core';

export interface PlayerSyncPayload {
  event: 'player_sync';
  media: {
    url?: string;
    title?: string;
    artist?: string;
    type?: 'audio' | 'video' | 'stream' | 'lyric';
  };
  playback: {
    is_playing: boolean;
    position: number;
    duration: number;
    sent_at: number;
  };
  state: {
    is_loop: boolean;
    is_muted: boolean;
    volume: number;
  };
  lyric: {
    active: boolean;
    url?: string;
    slide_index?: number;
    total_slides?: number;
  };
  action?: string;
}

class RemoteSyncService {
  async broadcast(payload: PlayerSyncPayload, requiredPermission?: string): Promise<void> {
    await invoke('broadcast_remote_event', {
      envelope: payload,
      required_permission: requiredPermission ?? null,
    });
  }
}

export const remoteSyncService = new RemoteSyncService();
