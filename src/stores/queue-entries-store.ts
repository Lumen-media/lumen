import { toast } from 'sonner';
import { create } from 'zustand';
import { useModuleStore } from '@/modules/store';
import { queueDbService, rowToItem } from '@/services/queue-db-service';
import type { FileInfo } from '@/services/types';
import { useQueueStore, type QueueItem } from './queue-store';

export type TriggerInstance = { id: string; triggerId: string; config: unknown; showLabel: boolean; played: boolean };

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
  loadFromDb: () => Promise<void>;
  syncQueue: (queue: QueueItem[]) => void;
  setEntries: (entries: ListEntry[]) => void;
  persistOrder: () => Promise<void>;
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

  loadFromDb: async () => {
    try {
      const rows = await queueDbService.loadAllRows();
      const entries: ListEntry[] = [];
      const seenPaths = new Set<string>();
      const seenIds = new Set<string>();
      for (const row of rows) {
        if (seenPaths.has(row.file_path)) continue;
        if (seenIds.has(String(row.id)) && !row.file_path.startsWith('trigger://')) continue;
        seenPaths.add(row.file_path);
        if (row.file_path.startsWith('trigger://')) {
          const config = row.original_url ? JSON.parse(row.original_url) : {};
          entries.push({
            kind: 'trigger' as const,
            id: row.file_path.slice('trigger://'.length),
            inst: {
              id: row.file_path.slice('trigger://'.length),
              triggerId: row.file_name,
              config,
              showLabel: true,
              played: row.played === 1,
            },
          });
          seenIds.add(row.file_path);
        } else {
          const item = rowToItem(row);
          entries.push({
            kind: 'item' as const,
            id: String(item.id),
            item: { id: item.id, file: item, played: item.played },
          });
          seenIds.add(String(item.id));
        }
      }
      set({ entries });
    } catch {}
  },

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

  persistOrder: () => {
    const { entries } = get();
    const pathUpdates: { path: string; position: number }[] = [];
    const idUpdates: { id: number; position: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.kind === 'trigger') {
        pathUpdates.push({ path: `trigger://${e.id}`, position: i });
      } else {
        idUpdates.push({ id: e.item.id, position: i });
      }
    }
    return queueDbService.updateAllPositions(idUpdates, pathUpdates);
  },

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

    const markTriggerPlayed = (index: number) => {
      const entry = entries[index];
      if (entry.kind !== 'trigger') return;
      set({
        entries: entries.map((e, idx) =>
          idx === index && e.kind === 'trigger'
            ? { ...e, inst: { ...e.inst, played: true } }
            : e
        ),
      });
      queueDbService.toggleTriggerPlayed(entry.id).catch(() => {});
    };

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
        const triggerSpecs = useModuleStore.getState().getQueueTriggerSpecs();
        const triggerSpec = triggerSpecs.find((s) => s.id === entry.inst.triggerId);
        if (triggerSpec) {
          markTriggerPlayed(i);
          set({ pendingIndex: i });
          triggerSpec.onFire(entry.inst.config);
          return { type: 'triggered' };
        }
        const actionSpecs = useModuleStore.getState().getQueueActionSpecs();
        const actionSpec = actionSpecs.find((s) => s.id === entry.inst.triggerId);
        if (actionSpec) {
          markTriggerPlayed(i);
          set({ pendingIndex: i });
          actionSpec.onFire(entry.inst.config);
          return { type: 'triggered' };
        }
      }
    }

    return { type: 'end' };
  },
}));
