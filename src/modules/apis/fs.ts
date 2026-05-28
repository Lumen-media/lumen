import { invoke } from '@tauri-apps/api/core';
import type { FsAPI } from '../types';

export function createFsAPI(moduleId: string): FsAPI {
  return {
    async read(path) {
      return invoke<Uint8Array>('module_fs_read', { moduleId, path });
    },
    async write(path, data) {
      await invoke('module_fs_write', { moduleId, path, data: Array.from(data) });
    },
    async exists(path) {
      return invoke<boolean>('module_fs_exists', { moduleId, path });
    },
    async list(path) {
      return invoke<string[]>('module_fs_list', { moduleId, path });
    },
    async remove(path) {
      await invoke('module_fs_remove', { moduleId, path });
    },
  };
}
