import { create } from 'zustand';

interface OptimizingStore {
  active: Set<string>;
  start: (src: string) => void;
  finish: (src: string) => void;
}

export const useOptimizingStore = create<OptimizingStore>((set) => ({
  active: new Set<string>(),
  start: (src) =>
    set((state) => {
      const active = new Set(state.active);
      active.add(src);
      return { active };
    }),
  finish: (src) =>
    set((state) => {
      const active = new Set(state.active);
      active.delete(src);
      return { active };
    }),
}));