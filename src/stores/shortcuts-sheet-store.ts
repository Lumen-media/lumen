import { create } from 'zustand';

interface ShortcutsSheetStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useShortcutsSheetStore = create<ShortcutsSheetStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));