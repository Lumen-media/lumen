import { create } from 'zustand';

export type AsideTab = 'queue' | 'notes' | 'themes' | 'chat';

interface AsideStore {
  activeTab: AsideTab;
  setActiveTab: (tab: AsideTab) => void;
}

export const useAsideStore = create<AsideStore>((set) => ({
  activeTab: 'queue',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));