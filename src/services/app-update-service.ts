import { listen } from '@tauri-apps/api/event';
import { ipc } from '@/lib/ipc';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'deferred'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'up-to-date'
  | 'error';

export interface UpdateProgress {
  state: string;
  version: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
  /** Publish date as unix seconds. */
  date: number | null;
}

export interface BootUpdateState {
  applying: boolean;
  version: string | null;
}

const PROGRESS_EVENT = 'app-update-progress';

export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<() => void> {
  return listen<UpdateProgress>(PROGRESS_EVENT, (event) => handler(event.payload));
}

export const getUpdateProgress = (): Promise<UpdateProgress> => ipc('app_update_progress_state');

export const bootUpdate = (): Promise<BootUpdateState> => ipc('app_update_boot');

export const checkForUpdate = (force = false): Promise<UpdateInfo | null> =>
  ipc('check_app_update', { force });

export const installUpdate = (): Promise<void> => ipc('install_app_update');

export const deferUpdate = (): Promise<void> => ipc('defer_app_update');
