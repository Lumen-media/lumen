import { toast } from 'sonner';
import { create } from 'zustand';
import { useModuleStore } from '@/modules/store';
import { queueDbService } from '@/services/queue-db-service';
import type { FileInfo } from '@/services/types';
import { useQueueStore, type QueueItem } from './queue-store';

export type TriggerInstance = { id: string; triggerId: string; config: unknown; showLabel: boolean };

export type ListEntry =
  | { kind: 'item'; id: string; item: QueueItem }
  | { kind: 'trigger'; id: string; inst: TriggerInstance };

type AdvanceResult =
  | { type: 'play'; path: string }
  | { type: 'triggered' }
  | { type: 'end' };

interface QueueEntriesStore {
  entries: ListEntry[];
  pendingIndex: number;
  dropTargetIndex: number | null;
  dragFileInfo: FileInfo | null;
  syncQueue: (queue: QueueItem[]) => void;
  setEntries: (entries: ListEntry[]) => void;
  setDropTargetIndex: (index: number | null) => void;
  setDragFileInfo: (file: FileInfo | null) => void;
  insertFileAtItemIndex: (file: FileInfo, itemIndex: number) => Promise<void>;
  advanceQueue: (currentFilePath: string | null) => AdvanceResult;
}

export const useQueueEntriesStore = create<QueueEntriesStore>((set, get) => ({
  entries: [],
  pendingIndex: -1,
  dropTargetIndex: null,
  dragFileInfo: null,

  syncQueue: (queue) => {
    set((state) => {
      const prevItemIds = new Set(
        state.entries
          .filter((e): e is Extract<ListEntry, { kind: 'item' }> => e.kind === 'item')
          .map((e) => e.id)
      );
      const currIds = new Set(queue.map((i) => String(i.id)));

      const filtered = state.entries
        .filter((e) => e.kind === 'trigger' || currIds.has(e.id))
        .map((e): ListEntry => {
          if (e.kind === 'item') {
            const updated = queue.find((i) => String(i.id) === e.id);
            return updated ? { ...e, item: updated } : e;
          }
          return e;
        });

      const newItems = queue
        .filter((i) => !prevItemIds.has(String(i.id)))
        .map((i): ListEntry => ({ kind: 'item', id: String(i.id), item: i }));

      return { entries: [...filtered, ...newItems] };
    });
  },

  setEntries: (entries) => set({ entries }),

  setDropTargetIndex: (index) => set({ dropTargetIndex: index }),
  setDragFileInfo: (file) => set({ dragFileInfo: file }),

  insertFileAtItemIndex: async (file, itemIndex) => {
    const already = await queueDbService.exists(file.path);
    if (already) {
      toast.info('Already in queue', { description: file.name });
      return;
    }

    const id = await queueDbService.addToQueue(file);
    const newItem: QueueItem = { id, file, played: false };
    const newEntry: ListEntry = { kind: 'item', id: String(id), item: newItem };

    set((state) => {
      let itemCount = 0;
      let entryIdx = state.entries.length;
      for (let i = 0; i < state.entries.length; i++) {
        if (itemCount >= itemIndex) { entryIdx = i; break; }
        if (state.entries[i]?.kind === 'item') itemCount++;
      }

      return {
        entries: [
          ...state.entries.slice(0, entryIdx),
          newEntry,
          ...state.entries.slice(entryIdx),
        ],
      };
    });

    const newEntries = get().entries;
    const orderedIds = newEntries
      .filter((e): e is Extract<ListEntry, { kind: 'item' }> => e.kind === 'item')
      .map((e) => e.item.id);

    useQueueStore.setState((s) => {
      const updated = [...s.queue, newItem];
      const map = new Map(updated.map((i) => [i.id, i]));
      return { queue: orderedIds.map((id) => map.get(id)!).filter(Boolean) };
    });

    await queueDbService.reorderQueue(orderedIds);
  },

  advanceQueue: (currentFilePath) => {
    const { entries, pendingIndex } = get();

    let startIdx: number;
    if (pendingIndex >= 0) {
      startIdx = pendingIndex;
      set({ pendingIndex: -1 });
    } else {
      startIdx = currentFilePath
        ? entries.findIndex((e) => e.kind === 'item' && e.item.file.path === currentFilePath)
        : -1;
    }

    for (let i = startIdx + 1; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.kind === 'item') {
        useQueueStore.getState().markPlayed(entry.item.id);
        return { type: 'play', path: entry.item.file.path };
      }
      if (entry.kind === 'trigger') {
        const specs = useModuleStore.getState().getQueueTriggerSpecs();
        const spec = specs.find((s) => s.id === entry.inst.triggerId);
        if (spec) {
          set({ pendingIndex: i });
          spec.onFire(entry.inst.config);
          return { type: 'triggered' };
        }
      }
    }

    return { type: 'end' };
  },
}));
