import { toast } from 'sonner';
import { create } from 'zustand';
import { queueDbService } from '@/services/queue-db-service';
import type { FileInfo } from '@/services/types';

export interface QueueItem {
  id: number;
  file: FileInfo;
  played: boolean;
}

interface QueueStore {
  queue: QueueItem[];
  loadFromDb: () => Promise<void>;
  addToQueue: (file: FileInfo) => Promise<void>;
  playNext: (file: FileInfo) => Promise<void>;
  removeFromQueue: (id: number) => Promise<void>;
  markPlayed: (id: number) => Promise<void>;
  togglePlayed: (id: number) => Promise<void>;
  shiftQueue: (excludePath?: string) => Promise<FileInfo | null>;
}

export const useQueueStore = create<QueueStore>((set) => ({
  queue: [],

  loadFromDb: async () => {
    const items = await queueDbService.loadQueue();
    set({ queue: items.map((item) => ({ id: item.id, file: item, played: item.played })) });
  },

  addToQueue: async (file) => {
    const already = await queueDbService.exists(file.path);
    if (already) {
      toast.info('Already in queue', { description: file.name });
      return;
    }
    const id = await queueDbService.addToQueue(file);
    set((s) => ({ queue: [...s.queue, { id, file, played: false }] }));
  },

  playNext: async (file) => {
    const already = await queueDbService.exists(file.path);
    if (already) {
      toast.info('Already in queue', { description: file.name });
      return;
    }
    const id = await queueDbService.playNext(file);
    set((s) => ({ queue: [{ id, file, played: false }, ...s.queue] }));
  },

  removeFromQueue: async (id) => {
    await queueDbService.removeFromQueue(id);
    set((s) => ({ queue: s.queue.filter((item) => item.id !== id) }));
  },

  markPlayed: async (id) => {
    await queueDbService.markPlayed(id);
    set((s) => ({
      queue: s.queue.map((item) => (item.id === id ? { ...item, played: true } : item)),
    }));
  },

  togglePlayed: async (id) => {
    await queueDbService.togglePlayed(id);
    set((s) => ({
      queue: s.queue.map((item) => (item.id === id ? { ...item, played: !item.played } : item)),
    }));
  },

  shiftQueue: async (excludePath) => {
    const next = await queueDbService.shiftQueue(excludePath);
    if (!next) return null;
    // Mark the item as played in the local state (it remains in the list)
    set((s) => ({
      queue: s.queue.map((item) => (item.id === next.id ? { ...item, played: true } : item)),
    }));
    return next;
  },
}));
