import { invoke } from '@tauri-apps/api/core';

export interface StreamingConfig {
  preview_enabled: boolean;
  main_fps: 1 | 15 | 24 | 30 | 60;
  main_resolution: '720p' | '1080p' | '1440p' | '4K';
  html_server_enabled: boolean;
  html_server_port: number;
  hardware_encoding: boolean;
  content_protection: boolean;
}

export interface StreamingStatus {
  preview_subs: number;
  main_subs: number;
  mobile_connected: boolean;
  html_active: boolean;
  html_url: string | null;
}

class StreamingService {
  async getConfig(): Promise<StreamingConfig> {
    return invoke<StreamingConfig>('get_streaming_config');
  }

  async updateConfig(config: StreamingConfig): Promise<StreamingConfig> {
    return invoke<StreamingConfig>('update_streaming_config', { config });
  }

  async getStatus(): Promise<StreamingStatus> {
    return invoke<StreamingStatus>('get_streaming_status');
  }

  async setContentProtected(isProtected: boolean): Promise<void> {
    await invoke('set_stream_content_protected', { isProtected });
  }

  async pushBlank(): Promise<void> {
    await invoke('push_stream_blank');
  }
}

export const streamingService = new StreamingService();
