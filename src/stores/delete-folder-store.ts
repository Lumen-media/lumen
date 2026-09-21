import { create } from 'zustand';
import type { MediaFolder } from '@/services';

interface DeleteFolderStore {
  isOpen: boolean;
  folder: MediaFolder | null;
  openDeleteDialog: (folder: MediaFolder) => void;
  closeDeleteDialog: () => void;
}

export const useDeleteFolderStore = create<DeleteFolderStore>((set) => ({
  isOpen: false,
  folder: null,
  openDeleteDialog: (folder: MediaFolder) => set({ isOpen: true, folder }),
  closeDeleteDialog: () => set({ isOpen: false, folder: null }),
}));
