import { create } from 'zustand';
import type { ModuleRecord, ModuleStatus, PanelSpec } from './types';

interface ModuleStore {
  modules: Map<string, ModuleRecord>;
  panels: Map<string, PanelSpec[]>;
  openDialogId: string | null;
  presenterViewId: string | null;
  presenterProps: unknown;

  registerModule(record: ModuleRecord): void;
  setStatus(id: string, status: ModuleStatus, error?: string): void;
  incrementErrorCount(id: string): void;
  removeModule(id: string): void;

  addPanel(moduleId: string, spec: PanelSpec): void;
  removePanel(moduleId: string, panelId: string): void;
  removePanelsForModule(moduleId: string): void;
  getPanelsForSlot(slot: string): PanelSpec[];

  openDialog(id: string): void;
  closeDialog(): void;
  projectPanel(viewId: string, props?: unknown): void;
  clearPresenter(): void;
}

export const useModuleStore = create<ModuleStore>((set, get) => ({
  modules: new Map(),
  panels: new Map(),
  openDialogId: null,
  presenterViewId: null,
  presenterProps: undefined,

  registerModule(record) {
    set((s) => {
      const next = new Map(s.modules);
      next.set(record.manifest.id, record);
      return { modules: next };
    });
  },

  setStatus(id, status, error) {
    set((s) => {
      const record = s.modules.get(id);
      if (!record) return s;
      const next = new Map(s.modules);
      next.set(id, {
        ...record,
        status,
        error,
        errorAt: error ? new Date().toISOString() : record.errorAt,
      });
      return { modules: next };
    });
  },

  incrementErrorCount(id) {
    set((s) => {
      const record = s.modules.get(id);
      if (!record) return s;
      const next = new Map(s.modules);
      next.set(id, { ...record, errorCount: record.errorCount + 1 });
      return { modules: next };
    });
  },

  removeModule(id) {
    set((s) => {
      const nextModules = new Map(s.modules);
      const nextPanels = new Map(s.panels);
      nextModules.delete(id);
      nextPanels.delete(id);
      return { modules: nextModules, panels: nextPanels };
    });
  },

  addPanel(moduleId, spec) {
    set((s) => {
      const next = new Map(s.panels);
      const existing = next.get(moduleId) ?? [];
      next.set(moduleId, [...existing, spec]);
      return { panels: next };
    });
  },

  removePanel(moduleId, panelId) {
    set((s) => {
      const next = new Map(s.panels);
      const existing = next.get(moduleId) ?? [];
      next.set(moduleId, existing.filter((p) => p.id !== panelId));
      return { panels: next };
    });
  },

  removePanelsForModule(moduleId) {
    set((s) => {
      const next = new Map(s.panels);
      next.delete(moduleId);
      return { panels: next };
    });
  },

  openDialog(id) {
    set({ openDialogId: id });
  },

  closeDialog() {
    set({ openDialogId: null });
  },

  projectPanel(viewId, props) {
    set({ presenterViewId: viewId, presenterProps: props });
  },

  clearPresenter() {
    set({ presenterViewId: null, presenterProps: undefined });
  },

  getPanelsForSlot(slot) {
    const { panels } = get();
    const result: PanelSpec[] = [];
    for (const specs of panels.values()) {
      for (const spec of specs) {
        if (spec.slot === slot) {
          result.push(spec);
        }
      }
    }
    return result;
  },
}));
