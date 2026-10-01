'use client';

import { create } from 'zustand';

interface ReleaseNote {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

interface ReleaseNotesState {
  releaseNotes: ReleaseNote[];
  selectedVersion: string | null;
  loading: boolean;
  error: string | null;
  dialogOpen: boolean;
  fetchReleaseNotes: () => Promise<void>;
  selectVersion: (version: string) => void;
  closeDialog: () => void;
  openDialog: () => void;
}

export const useReleaseNotesStore = create<ReleaseNotesState>((set, get) => ({
  releaseNotes: [],
  selectedVersion: null,
  loading: false,
  error: null,
  dialogOpen: false,

  fetchReleaseNotes: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const response = await fetch('https://api.github.com/repos/Lumen-media/lumen/releases?per_page=20', {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }
      const data: ReleaseNote[] = await response.json();
      set((state) => ({
        releaseNotes: data,
        loading: false,
        selectedVersion:
          state.selectedVersion ?? data[0]?.tag_name ?? null,
      }));
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : 'Failed to fetch release notes', loading: false });
    }
  },

  selectVersion: (version: string) => set({ selectedVersion: version }),

  closeDialog: () => set({ dialogOpen: false }),

  openDialog: () => {
    set({ dialogOpen: true });
    if (get().releaseNotes.length === 0) {
      get().fetchReleaseNotes();
    } else if (get().selectedVersion === null) {
      set({ selectedVersion: get().releaseNotes[0]?.tag_name ?? null });
    }
  },
}));