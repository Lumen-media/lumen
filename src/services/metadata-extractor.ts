import { invoke } from '@tauri-apps/api/core';

export interface MediaMetadata {
  duration?: number;
  title?: string;
  artist?: string;
}

export async function extractMetadata(filePath: string): Promise<MediaMetadata> {
  try {
    const result = await invoke<{ duration?: number | null }>('extract_metadata', {
      path: filePath,
    });
    return {
      duration: result.duration ?? undefined,
    };
  } catch {
    return {};
  }
}