import { create } from 'zustand';

interface GeneratorPresetsDialogStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Opens the Tools → Generators preset manager. */
export const useGeneratorPresetsDialogStore = create<GeneratorPresetsDialogStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
