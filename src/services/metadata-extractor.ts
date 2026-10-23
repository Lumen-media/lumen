import { ipc } from '@/lib/ipc';

export interface MediaMetadata {
  duration?: number;
  title?: string;
  artist?: string;
}

export async function extractMetadata(filePath: string): Promise<MediaMetadata> {
  try {
    const result = await ipc('extract_metadata', { path: filePath });
    return {
      duration: result.duration ?? undefined,
    };
  } catch {
    return {};
  }
}
