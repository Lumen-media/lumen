'use client';

import { create } from 'zustand';

interface ReleaseNote {
  version: string;
  name: string;
  published_at: string;
  body: string;
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
      const data = await response.json();
      set({ releaseNotes: data, loading: false });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : 'Failed to fetch release notes', loading: false });
    }
  },

  selectVersion: (version: string) => set({ selectedVersion: version }),

  closeDialog: () => set({ dialogOpen: false, selectedVersion: null }),

  openDialog: () => {
    set({ dialogOpen: true });
    if (get().releaseNotes.length === 0) {
      get().fetchReleaseNotes();
    }
  },
}));