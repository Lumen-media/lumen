import { create } from 'zustand';

export type LyricModalTitle = 'Lyric Editor' | 'Quick Presentation';

interface LyricModalStore {
  isOpen: boolean;
  filePath: string | null;
  title: LyricModalTitle;
  open: (filePath?: string) => void;
  openQuick: () => void;
  close: () => void;
}

export const useLyricModalStore = create<LyricModalStore>((set) => ({
  isOpen: false,
  filePath: null,
  title: 'Lyric Editor',
  open: (filePath) => set({ isOpen: true, title: 'Lyric Editor', filePath: filePath ?? null }),
  openQuick: () => set({ isOpen: true, title: 'Quick Presentation', filePath: null }),
  close: () => set({ isOpen: false, filePath: null }),
}));