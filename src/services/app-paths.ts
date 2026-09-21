import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import type { MediaType } from './types';

export interface AppPaths {
  base: string;
  db: string;
  media: Record<MediaType, string>;
}

let _paths: AppPaths | null = null;

export async function getAppPaths(): Promise<AppPaths> {
  if (!_paths) {
    _paths = await invoke<AppPaths>('get_app_paths');
  }
  return _paths;
}

export function invalidateAppPathsCache(): void {
  _paths = null;
}

export async function getAppBasePath(): Promise<string> {
  return (await getAppPaths()).base;
}

export async function getMediaTypePath(mediaType: MediaType): Promise<string> {
  return (await getAppPaths()).media[mediaType];
}

export async function getThemesPath(): Promise<string> {
  return (await getAppPaths()).media.themes;
}

export async function getProfilesPath(): Promise<string> {
  return join(await getAppBasePath(), 'config', 'profiles');
}

export async function getQuickPresentationPath(): Promise<string> {
  return join(await getAppBasePath(), 'config', 'quick-presentation.md');
}

export async function getNoticesPath(): Promise<string> {
  return join(await getAppBasePath(), 'config', 'notices.md');
}

export async function getNotesPath(): Promise<string> {
  return join(await getAppBasePath(), 'files', 'notes');
}

export async function getDbPath(): Promise<string> {
  const db = (await getAppPaths()).db;
  return `sqlite:${db.replace(/\\/g, '/')}`;
}
