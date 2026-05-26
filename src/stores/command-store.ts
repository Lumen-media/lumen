import { create } from 'zustand';
import type { CommanderAppProps, CommandSpec } from '@/modules/types';
import type React from 'react';

export interface ActiveApp {
  commandId: string;
  title: string;
  component: React.ComponentType<CommanderAppProps>;
}

interface CommandStore {
  isOpen: boolean;
  prefilter: string;
  activeApp: ActiveApp | null;
  commands: CommandSpec[];
  open: (prefilter?: string) => void;
  close: () => void;
  toggle: () => void;
  pushApp: (app: ActiveApp) => void;
  popApp: () => void;
  _register: (spec: CommandSpec) => void;
  _unregister: (id: string) => void;
}

export const useCommandStore = create<CommandStore>((set) => ({
  isOpen: false,
  prefilter: '',
  activeApp: null,
  commands: [],

  open: (prefilter = '') => set({ isOpen: true, prefilter, activeApp: null }),
  close: () => set({ isOpen: false, prefilter: '', activeApp: null }),
  toggle: () =>
    set((s) =>
      s.isOpen
        ? { isOpen: false, prefilter: '', activeApp: null }
        : { isOpen: true },
    ),

  pushApp: (app) => set({ activeApp: app }),
  popApp: () => set({ activeApp: null }),

  _register: (spec) =>
    set((s) => ({
      commands: s.commands.some((c) => c.id === spec.id)
        ? s.commands.map((c) => (c.id === spec.id ? spec : c))
        : [...s.commands, spec],
    })),
  _unregister: (id) =>
    set((s) => ({ commands: s.commands.filter((c) => c.id !== id) })),
}));
