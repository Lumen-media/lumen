import { invoke } from '@tauri-apps/api/core';
import { streamingService } from './streaming-service';

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

/**
 * Lightweight position re-anchor sent during playback so remote clients can
 * correct the drift accumulated while interpolating locally. `sent_at_ms` is
 * Unix milliseconds (unlike `player_sync.playback.sent_at`, which is seconds).
 */
export interface PlayerTickPayload {
  event: 'player_tick';
  position: number;
  duration: number;
  is_playing: boolean;
  sent_at_ms: number;
}

export interface QueueSyncItem {
  id: number;
  title: string;
  artist?: string;
  type?: string;
  is_playing: boolean;
  is_played: boolean;
  duration?: number;
}

export interface QueueSyncPayload {
  event: 'queue_sync';
  items: QueueSyncItem[];
  current_index: number;
}

export interface PresentationSyncPayload {
  event: 'presentation_sync';
  kind: 'lyrics' | 'presentation' | 'module' | 'none';
  current_deck?: string;
  slide_index: number;
  total_slides: number;
  is_black: boolean;
  is_wallpaper: boolean;
}

export type RemoteSyncPayload =
  | PlayerSyncPayload
  | PlayerTickPayload
  | QueueSyncPayload
  | PresentationSyncPayload;

class RemoteSyncService {
  /**
   * Broadcasts a full player state envelope. Content protection is applied
   * along the way because video payloads must blank the stream for remotes.
   */
  async broadcast(payload: PlayerSyncPayload, requiredPermission?: string): Promise<void> {
    const mediaType = payload.media.type;
    const isProtected = mediaType === 'video';
    await streamingService.setContentProtected(isProtected);

    await this.broadcastRaw(payload, requiredPermission);
  }

  /**
   * Broadcasts any remote-sync envelope without touching content protection.
   * Used for `player_tick`, `queue_sync` and `presentation_sync`.
   */
  async broadcastRaw(payload: RemoteSyncPayload, requiredPermission?: string): Promise<void> {
    await invoke('broadcast_remote_event', {
      envelope: payload,
      required_permission: requiredPermission ?? null,
    });
  }
}

export const remoteSyncService = new RemoteSyncService();
