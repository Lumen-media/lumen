import { create } from 'zustand';
import type { CommanderAppProps, CommanderSearchOptions, CommandSpec, PrefixSpec } from '@/modules/types';
import type React from 'react';

export interface ActiveApp {
  commandId: string;
  title: string;
  component: React.ComponentType<CommanderAppProps>;
  search?: boolean | CommanderSearchOptions;
}

interface CommandStore {
  isOpen: boolean;
  prefilter: string;
  activeApp: ActiveApp | null;
  commands: CommandSpec[];
  prefixes: PrefixSpec[];
  open: (prefilter?: string) => void;
  close: () => void;
  toggle: () => void;
  pushApp: (app: ActiveApp) => void;
  popApp: () => void;
  _register: (spec: CommandSpec) => void;
  _unregister: (id: string) => void;
  _registerPrefix: (spec: PrefixSpec) => void;
  _unregisterPrefix: (prefix: string) => void;
}

export const useCommandStore = create<CommandStore>((set) => ({
  isOpen: false,
  prefilter: '',
  activeApp: null,
  commands: [],
  prefixes: [],

  open: (prefilter = '') => set({ isOpen: true, prefilter }),
  close: () => set({ isOpen: false, prefilter: '' }),
  toggle: () =>
    set((s) =>
      s.isOpen
        ? { isOpen: false, prefilter: '' }
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

  _registerPrefix: (spec) =>
    set((s) => ({
      prefixes: s.prefixes.some((p) => p.prefix === spec.prefix)
        ? s.prefixes.map((p) => (p.prefix === spec.prefix ? spec : p))
        : [...s.prefixes, spec],
    })),
  _unregisterPrefix: (prefix) =>
    set((s) => ({ prefixes: s.prefixes.filter((p) => p.prefix !== prefix) })),
}));
