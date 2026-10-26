import { toast } from 'sonner';
import { create } from 'zustand';
import { queueDbService } from '@/services/queue-db-service';
import { type QueueSyncItem, remoteSyncService } from '@/services/remote-sync-service';
import type { FileInfo } from '@/services/types';
import { urlMediaService } from '@/services/url-media-service';

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
  addUrlToQueue: (url: string, duration?: number) => Promise<number | undefined>;
  playUrlNext: (url: string, duration?: number) => Promise<void>;
  removeFromQueue: (id: number) => Promise<void>;
  markPlayed: (id: number) => Promise<void>;
  togglePlayed: (id: number) => Promise<void>;
  shiftQueue: (excludePath?: string) => Promise<FileInfo | null>;
  clearQueue: () => Promise<void>;
  shuffleQueue: () => Promise<void>;
  insertAtIndex: (file: FileInfo, index: number) => Promise<void>;
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

export const useQueueStore = create<QueueStore>((set, get) => ({
  queue: [],

  loadFromDb: async () => {
    const items = await queueDbService.loadQueue();
    set({
      queue: items
        .filter((item) => !item.path.startsWith('trigger://'))
        .map((item) => ({ id: item.id, file: item, played: item.played })),
    });
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

  addUrlToQueue: async (url, duration) => {
    const file = await urlMediaService.createYouTubeFileInfo(url, duration);
    const already = await queueDbService.exists(file.path);
    if (already) {
      toast.info('Already in queue', { description: file.name });
      return undefined;
    }

    const id = await queueDbService.addToQueue(file);
    set((s) => ({ queue: [...s.queue, { id, file, played: false }] }));
    return id;
  },

  playUrlNext: async (url, duration) => {
    const file = await urlMediaService.createYouTubeFileInfo(url, duration);
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

  insertAtIndex: async (file, index) => {
    const already = await queueDbService.exists(file.path);
    if (already) {
      toast.info('Already in queue', { description: file.name });
      return;
    }
    const id = await queueDbService.addToQueue(file);
    set((s) => {
      const newQueue = [...s.queue, { id, file, played: false }];
      const item = newQueue.pop()!;
      const clampedIndex = Math.min(index, newQueue.length);
      newQueue.splice(clampedIndex, 0, item);
      return { queue: newQueue };
    });
    await queueDbService.reorderQueue(get().queue.map((i) => i.id));
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

/**
 * Returns the path of the media item currently loaded in the player, so the
 * queue sync can compute `current_index`. Registered by the player store at
 * import time to avoid a circular dependency between the two stores.
 */
let currentPathProvider: () => string | null = () => null;

export function setQueueCurrentPathProvider(provider: () => string | null) {
  currentPathProvider = provider;
}

/**
 * Ordering hint for the mixed queue list. Media entries only need `id` for
 * positioning (their data always comes from the authoritative queue); trigger
 * entries carry their display metadata. Registered by the queue-entries store
 * to avoid a circular dependency.
 */
export interface QueueSyncEntry {
  id: number | string;
  kind: 'media' | 'trigger';
  title?: string;
  isPlayed?: boolean;
  showLabel?: boolean;
}

let queueSyncEntriesProvider: (() => QueueSyncEntry[]) | null = null;

export function setQueueSyncEntriesProvider(provider: () => QueueSyncEntry[]) {
  queueSyncEntriesProvider = provider;
}

function mediaSyncItem(item: QueueItem, currentPath: string | null): QueueSyncItem {
  return {
    id: item.id,
    kind: 'media',
    title: item.file.title ?? item.file.name,
    artist: item.file.artist,
    type: item.file.extension,
    is_playing: currentPath !== null && item.file.path === currentPath,
    is_played: item.played,
    duration: item.file.duration,
  };
}

function triggerSyncItem(entry: QueueSyncEntry): QueueSyncItem {
  return {
    id: entry.id,
    kind: 'trigger',
    title: entry.title ?? String(entry.id),
    is_playing: false,
    is_played: entry.isPlayed ?? false,
    show_label: entry.showLabel,
  };
}

/**
 * Builds the merged list in playback order. The provider's media slots define
 * where triggers sit relative to playback, but the media content itself is
 * taken from the authoritative queue in queue order — so shuffles/reorders are
 * reflected immediately even before the entries store resyncs. Any media the
 * provider does not cover yet is appended in queue order.
 */
function buildQueueSyncItems(currentPath: string | null): QueueSyncItem[] {
  const queue = useQueueStore.getState().queue;
  const provided = queueSyncEntriesProvider?.() ?? [];

  const items: QueueSyncItem[] = [];
  const seenMedia = new Set<number>();
  let mediaCursor = 0;

  const takeNextMedia = (): QueueItem | null => {
    while (mediaCursor < queue.length && seenMedia.has(queue[mediaCursor].id)) {
      mediaCursor++;
    }
    const item = queue[mediaCursor];
    if (!item) return null;
    mediaCursor++;
    seenMedia.add(item.id);
    return item;
  };

  for (const entry of provided) {
    if (entry.kind === 'media') {
      const item = takeNextMedia();
      if (item) items.push(mediaSyncItem(item, currentPath));
    } else {
      items.push(triggerSyncItem(entry));
    }
  }

  for (const item of queue) {
    if (!seenMedia.has(item.id)) {
      items.push(mediaSyncItem(item, currentPath));
    }
  }

  return items;
}

/**
 * Broadcasts the current queue to remote clients. Coalesced with a trailing
 * debounce so bursty mutations (drag-drop reorders) collapse into one frame.
 *
 * # Errors
 * Swallowed: the caller is a UI mutation that must not fail because the
 * remote channel is unavailable.
 */
let queueSyncTimeout: ReturnType<typeof setTimeout> | null = null;
const QUEUE_SYNC_DEBOUNCE_MS = 300;

export function broadcastQueueSync(delay = QUEUE_SYNC_DEBOUNCE_MS): void {
  if (queueSyncTimeout) {
    clearTimeout(queueSyncTimeout);
  }
  queueSyncTimeout = setTimeout(() => {
    queueSyncTimeout = null;
    const currentPath = currentPathProvider();
    const items = buildQueueSyncItems(currentPath);
    const currentIndex = currentPath
      ? items.findIndex((item) => item.is_playing)
      : -1;
    void remoteSyncService
      .broadcastRaw({ event: 'queue_sync', items, current_index: currentIndex }, 'player')
      .catch(() => {});
  }, delay);
}

useQueueStore.subscribe((state, previous) => {
  if (state.queue !== previous.queue) {
    broadcastQueueSync();
  }
});
