import { ipc } from '@/lib/ipc';
import type { ParamValue } from './types';

/** A generator preset as stored by Rust (`background_presets.rs`). */
export interface GeneratorPreset {
  id: string;
  name: string;
  effect: string;
  params: Record<string, ParamValue>;
  seed: number;
  createdAt: number;
  version: number;
  builtIn: boolean;
}

export function listGeneratorPresets(): Promise<GeneratorPreset[]> {
  return ipc('bg_preset_list');
}

export function saveGeneratorPreset(preset: GeneratorPreset): Promise<GeneratorPreset> {
  return ipc('bg_preset_save', { preset });
}

export function deleteGeneratorPreset(id: string): Promise<void> {
  return ipc('bg_preset_delete', { id });
}
