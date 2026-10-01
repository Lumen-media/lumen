import { create } from 'zustand';
import type { UpdateInfo, UpdatePhase, UpdateProgress } from '@/services/app-update-service';

const SHOWN_RELEASE_NOTES_KEY = 'lumen-shown-release-notes';

interface AppUpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  downloaded: number;
  total: number | null;
  error: string | null;
  dialogOpen: boolean;
  showReleaseNotes: boolean;
  releaseNotesVersion: string | null;
  applyProgress: (progress: UpdateProgress) => void;
  announce: (info: UpdateInfo) => void;
  closeDialog: () => void;
  markReleaseNotesShown: (version: string) => void;
  checkAndShowReleaseNotes: (currentVersion: string) => void;
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  phase: 'idle',
  info: null,
  downloaded: 0,
  total: null,
  error: null,
  dialogOpen: false,
  showReleaseNotes: false,
  releaseNotesVersion: null,

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

  closeDialog: () => set({ dialogOpen: false, showReleaseNotes: false, releaseNotesVersion: null }),

  markReleaseNotesShown: (version: string) => {
    try {
      localStorage.setItem(SHOWN_RELEASE_NOTES_KEY, version);
    } catch { /* ignore */ }
    set({ showReleaseNotes: false, releaseNotesVersion: null });
  },

  checkAndShowReleaseNotes: (currentVersion: string) => {
    try {
      const shown = localStorage.getItem(SHOWN_RELEASE_NOTES_KEY);
      if (shown !== currentVersion) {
        set({ showReleaseNotes: true, releaseNotesVersion: currentVersion, dialogOpen: true });
      }
    } catch { /* ignore */ }
  },
}));
