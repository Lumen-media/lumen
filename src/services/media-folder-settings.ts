import { invoke } from '@tauri-apps/api/core';
import { getAppPaths, invalidateAppPathsCache } from './app-paths';
import type { MediaType } from './types';

export type MigrationMode = 'move' | 'copy' | 'none';

export async function getMediaFolders(): Promise<Record<MediaType, string>> {
  return (await getAppPaths()).media;
}

export async function setMediaFolder(opts: {
  mediaType: MediaType;
  path: string | null;
  migrate?: MigrationMode;
}): Promise<void> {
  await invoke('set_media_folder', {
    mediaType: opts.mediaType,
    path: opts.path,
    migrate: opts.migrate ?? null,
  });
  invalidateAppPathsCache();
}

export async function restartApp(): Promise<void> {
  try {
    await invoke('restart_app');
  } catch {
    // Fallback if invoke fails
  }
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
