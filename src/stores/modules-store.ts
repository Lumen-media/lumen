import { create } from 'zustand';
import {
  storeService,
  type StoreCatalog,
  type StoreProgressPhase,
} from '@/services/store-service';

export interface StoreProgressState {
  moduleId: string;
  phase: StoreProgressPhase;
  progress: number;
}

interface ModulesStoreState {
  catalog: StoreCatalog | null;
  catalogStale: boolean;
  catalogCached: boolean;
  catalogLoading: boolean;
  catalogError: string | null;
  progress: Record<string, StoreProgressState>;
  loadCatalog: (opts?: { force?: boolean }) => Promise<void>;
  setPhase: (moduleId: string, phase: StoreProgressPhase, progress?: number) => void;
  clearPhase: (moduleId: string) => void;
  bindDownloadProgress: () => () => void;
}

export const useModulesStore = create<ModulesStoreState>((set, get) => ({
  catalog: null,
  catalogStale: false,
  catalogCached: false,
  catalogLoading: false,
  catalogError: null,
  progress: {},

  loadCatalog: async (opts) => {
    const { catalog, catalogLoading } = get();
    if (catalogLoading && !opts?.force) return;
    if (!opts?.force && catalog) return;

    set({ catalogLoading: true, catalogError: null });
    try {
      const response = await storeService.fetchCatalog();
      set({
        catalog: response.catalog,
        catalogStale: response.stale,
        catalogCached: response.cached,
        catalogLoading: false,
        catalogError: null,
      });
    } catch (err) {
      set({
        catalogLoading: false,
        catalogError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setPhase: (moduleId, phase, progress = 0) => {
    set((s) => ({
      progress: { ...s.progress, [moduleId]: { moduleId, phase, progress } },
    }));
  },

  clearPhase: (moduleId) => {
    set((s) => {
      if (!(moduleId in s.progress)) return s;
      const next = { ...s.progress };
      delete next[moduleId];
      return { progress: next };
    });
  },

  bindDownloadProgress: () => {
    const unlisten = storeService.onDownloadProgress((payload) => {
      const phase: StoreProgressPhase =
        payload.phase === 'download' ? 'downloading' : 'installing';
      set((s) => ({
        progress: {
          ...s.progress,
          [payload.key]: { moduleId: payload.key, phase, progress: payload.progress },
        },
      }));
    });
    return unlisten;
  },
}));