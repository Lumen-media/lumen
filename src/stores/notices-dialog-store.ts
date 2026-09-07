import { create } from 'zustand';

interface NoticesDialogStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useNoticesDialogStore = create<NoticesDialogStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));