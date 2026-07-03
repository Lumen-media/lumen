import { toast } from 'sonner';
import { create } from 'zustand';
import { queueDbService } from '@/services/queue-db-service';
import { urlMediaService } from '@/services/url-media-service';
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
  addUrlToQueue: (url: string) => Promise<void>;
  playUrlNext: (url: string) => Promise<void>;
  removeFromQueue: (id: number) => Promise<void>;
  markPlayed: (id: number) => Promise<void>;
  togglePlayed: (id: number) => Promise<void>;
  shiftQueue: (excludePath?: string) => Promise<FileInfo | null>;
  clearQueue: () => Promise<void>;
  shuffleQueue: () => Promise<void>;
  reorderQueue: (orderedIds: number[]) => Promise<void>;
  updateMetadata: (
    filePath: string,
    metadata: {
      duration?: number;
      title?: string;
      artist?: string;
      thumbnailPath?: string;
      remoteThumbnailUrl?: string;
    }
  ) => Promise<void>;
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

  addUrlToQueue: async (url) => {
    const file = await urlMediaService.createYouTubeFileInfo(url);
    const already = await queueDbService.exists(file.path);
    if (already) {
      toast.info('Already in queue', { description: file.name });
      return;
    }

    const id = await queueDbService.addToQueue(file);
    set((s) => ({ queue: [...s.queue, { id, file, played: false }] }));
  },

  playUrlNext: async (url) => {
    const file = await urlMediaService.createYouTubeFileInfo(url);
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
    set((s) => ({
      queue: s.queue.map((item) => (item.id === next.id ? { ...item, played: true } : item)),
    }));
    return next;
  },

  clearQueue: async () => {
    await queueDbService.clearQueue();
    set({ queue: [] });
  },

  shuffleQueue: async () => {
    await queueDbService.shuffleQueue();
    await queueDbService.loadQueue().then((items) => {
      set({ queue: items.map((item) => ({ id: item.id, file: item, played: item.played })) });
    });
  },

  reorderQueue: async (orderedIds) => {
    set((s) => {
      const map = new Map(s.queue.map((item) => [item.id, item]));
      return { queue: orderedIds.map((id) => map.get(id)!).filter(Boolean) };
    });
    await queueDbService.reorderQueue(orderedIds);
  },

  updateMetadata: async (filePath, metadata) => {
    await queueDbService.updateMetadata(filePath, metadata);
    set((s) => ({
      queue: s.queue.map((item) =>
        item.file.path === filePath
          ? {
              ...item,
              file: {
                ...item.file,
                duration: metadata.duration ?? item.file.duration,
                title: metadata.title ?? item.file.title,
                artist: metadata.artist ?? item.file.artist,
                thumbnailPath: metadata.thumbnailPath ?? item.file.thumbnailPath,
                remoteThumbnailUrl: metadata.remoteThumbnailUrl ?? item.file.remoteThumbnailUrl,
              },
            }
          : item
      ),
    }));
  },
}));
