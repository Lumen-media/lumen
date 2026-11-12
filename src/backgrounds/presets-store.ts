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
  /** Message from the last failed read; cleared by a successful one. */
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  save: (preset: GeneratorPreset) => Promise<GeneratorPreset>;
  remove: (id: string) => Promise<void>;
}

let hasLoaded = false;

/** Shared preset list; Rust remains the source of truth after every write. */
export const useGeneratorPresetsStore = create<GeneratorPresetsStore>((set, get) => ({
  presets: [],
  loading: false,
  error: null,
  load: async (force = false) => {
    if (get().loading || (hasLoaded && !force)) return;
    set({ loading: true, error: null });
    try {
      set({ presets: await listGeneratorPresets() });
      hasLoaded = true;
    } catch (error) {
      // A failed read must not surface as an unhandled rejection: callers fire
      // this from effects without awaiting. The message keeps the UI honest.
      set({ error: typeof error === 'string' ? error : 'Could not load presets.' });
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
