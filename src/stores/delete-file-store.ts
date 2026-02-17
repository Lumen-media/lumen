import { create } from 'zustand';
import type { FileInfo } from '@/services';

interface DeleteFileStore {
	isOpen: boolean;
	file: FileInfo | null;
	openDeleteDialog: (file: FileInfo) => void;
	closeDeleteDialog: () => void;
}

export const useDeleteFileStore = create<DeleteFileStore>((set) => ({
	isOpen: false,
	file: null,
	openDeleteDialog: (file: FileInfo) => set({ isOpen: true, file }),
	closeDeleteDialog: () => set({ isOpen: false, file: null }),
}));
