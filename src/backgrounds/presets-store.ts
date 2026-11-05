import { create } from 'zustand';
import {
  deleteGeneratorPreset,
  type GeneratorPreset,
  listGeneratorPresets,
  saveGeneratorPreset,
} from './presets';

interface GeneratorPresetsStore {
  presets: GeneratorPreset[];
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
  save: (preset: GeneratorPreset) => Promise<GeneratorPreset>;
  remove: (id: string) => Promise<void>;
}

let hasLoaded = false;

/** Shared preset list; Rust remains the source of truth after every write. */
export const useGeneratorPresetsStore = create<GeneratorPresetsStore>((set, get) => ({
  presets: [],
  loading: false,
  load: async (force = false) => {
    if (get().loading || (hasLoaded && !force)) return;
    set({ loading: true });
    try {
      set({ presets: await listGeneratorPresets() });
      hasLoaded = true;
    } finally {
      set({ loading: false });
    }
  },
  save: async (preset) => {
    const saved = await saveGeneratorPreset(preset);
    set({ presets: await listGeneratorPresets() });
    return saved;
  },
  remove: async (id) => {
    await deleteGeneratorPreset(id);
    set({ presets: await listGeneratorPresets() });
  },
}));
