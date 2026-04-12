import { create } from 'zustand';
import { loadConfig, saveConfigKey } from '@/services/config';

export type ColorMode = 'dark' | 'light';
export type AccentId = 'cyan' | 'green' | 'purple' | 'amber' | 'rose';

export interface AccentPreset {
  id: AccentId;
  label: string;
  hex: string;
  oklch: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'cyan',   label: 'Cyan',   hex: '#22d3ee', oklch: 'oklch(0.789 0.154 211.53)' },
  { id: 'green',  label: 'Green',  hex: '#34d399', oklch: 'oklch(0.765 0.177 163.22)' },
  { id: 'purple', label: 'Purple', hex: '#a78bfa', oklch: 'oklch(0.702 0.183 293.54)' },
  { id: 'amber',  label: 'Amber',  hex: '#fbbf24', oklch: 'oklch(0.828 0.189 84.429)'  },
  { id: 'rose',   label: 'Rose',   hex: '#fb7185', oklch: 'oklch(0.712 0.194 13.428)'  },
];

interface ThemeState {
  colorMode: ColorMode;
  accentId: AccentId;
  setColorMode: (mode: ColorMode) => void;
  setAccentId: (id: AccentId) => void;
  init: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  colorMode: 'dark',
  accentId: 'cyan',
  setColorMode: (colorMode) => {
    set({ colorMode });
    saveConfigKey('theme', { colorMode, accentId: useThemeStore.getState().accentId });
  },
  setAccentId: (accentId) => {
    set({ accentId });
    saveConfigKey('theme', { colorMode: useThemeStore.getState().colorMode, accentId });
  },
  init: async () => {
    const config = await loadConfig();
    set({
      colorMode: config.theme.colorMode,
      accentId: config.theme.accentId as AccentId,
    });
  },
}));
