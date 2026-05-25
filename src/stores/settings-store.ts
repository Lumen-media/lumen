import { create } from 'zustand';

export type SettingsSection = 'theme' | 'remote_general' | 'remote_permissions' | 'advanced' | 'about' | 'modules';

interface SettingsStore {
  isOpen: boolean;
  activeSection: SettingsSection;
  open: (section?: SettingsSection) => void;
  close: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  isOpen: false,
  activeSection: 'theme',
  open: (section = 'theme') => set({ isOpen: true, activeSection: section }),
  close: () => set({ isOpen: false }),
}));
