import { create } from 'zustand';

interface LyricModalStore {
  isOpen: boolean;
  filePath: string | null;
  open: (filePath?: string) => void;
  close: () => void;
}

export const useLyricModalStore = create<LyricModalStore>((set) => ({
  isOpen: false,
  filePath: null,
  open: (filePath) => set({ isOpen: true, filePath: filePath ?? null }),
  close: () => set({ isOpen: false, filePath: null }),
}));
