import { create } from 'zustand';

interface AppSettingsState {
  developerMode: boolean;
  setDeveloperMode: (value: boolean) => void;
}

export const useAppSettingsStore = create<AppSettingsState>((set) => ({
  developerMode: localStorage.getItem('lumen-developer-mode') === 'true',
  setDeveloperMode: (value) => {
    localStorage.setItem('lumen-developer-mode', String(value));
    set({ developerMode: value });
  },
}));
