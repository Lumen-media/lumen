import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';

let _basePath: string | null = null;

/**
 * Base directory for all app data (media files + database).
 * Derived from the executable's directory so data always lives
 * alongside the app, regardless of drive or OS:
 *   Windows (installed at C:\lumen\): C:\lumen\lumen\
 *   Dev mode:                         src-tauri\target\debug\lumen\
 *
 * Centralised here so changing one value moves everything together.
 */
export async function getAppBasePath(): Promise<string> {
  if (!_basePath) {
    const exeDir = await invoke<string>('get_exe_dir');
    _basePath = await join(exeDir, 'lumen');
  }
  return _basePath;
}

export async function getMediaBasePath(): Promise<string> {
  const base = await getAppBasePath();
  return join(base, 'files', 'media');
}

export async function getThemesPath(): Promise<string> {
  const base = await getAppBasePath();
  return join(base, 'files', 'themes');
}

export async function getDbPath(): Promise<string> {
  const base = await getAppBasePath();
  const dbFile = await join(base, 'lumen.db');
  return `sqlite:${dbFile.replace(/\\/g, '/')}`;
}
