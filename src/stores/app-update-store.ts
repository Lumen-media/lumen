import { create } from 'zustand';
import type { UpdateInfo, UpdatePhase, UpdateProgress } from '@/services/app-update-service';

interface AppUpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  downloaded: number;
  total: number | null;
  error: string | null;
  dialogOpen: boolean;
  applyProgress: (progress: UpdateProgress) => void;
  announce: (info: UpdateInfo) => void;
  closeDialog: () => void;
}

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  phase: 'idle',
  info: null,
  downloaded: 0,
  total: null,
  error: null,
  dialogOpen: false,

  applyProgress: (progress) =>
    set({
      phase: progress.state as UpdatePhase,
      downloaded: progress.downloaded,
      total: progress.total,
      error: progress.state === 'error' ? progress.error : null,
    }),

  announce: (info) =>
    set({
      info,
      phase: 'available',
      error: null,
      dialogOpen: true,
      downloaded: 0,
      total: null,
    }),

  closeDialog: () => set({ dialogOpen: false }),
}));
