import type { ReactNode } from 'react';
import { create } from 'zustand';

interface AlertConfig {
  icon?: ReactNode;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface AlertStore {
  isOpen: boolean;
  config: AlertConfig | null;
  show: (config: AlertConfig) => void;
  close: () => void;
}

export const useAlertStore = create<AlertStore>((set) => ({
  isOpen: false,
  config: null,
  show: (config) => set({ isOpen: true, config }),
  close: () => set({ isOpen: false, config: null }),
}));
