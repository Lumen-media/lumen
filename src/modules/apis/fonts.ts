import { invoke } from '@tauri-apps/api/core';
import type { FontsAPI } from '../types';

const FALLBACK_FONTS = [
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Century Gothic',
  'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact',
  'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

/** Lists fonts installed on the host system. */
export function createFontsAPI(): FontsAPI {
  return {
    async list() {
      return invoke<string[]>('get_system_fonts').catch(() => FALLBACK_FONTS);
    },
  };
}
