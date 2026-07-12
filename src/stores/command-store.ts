import type React from 'react';
import { create } from 'zustand';
import type {
  CommanderAppProps,
  CommanderSearchOptions,
  CommandSpec,
  PrefixSpec,
} from '@/modules/types';

export interface ActiveApp {
  commandId: string;
  title: string;
  component: React.ComponentType<CommanderAppProps>;
  search?: boolean | CommanderSearchOptions;
}

interface CommandStore {
  isOpen: boolean;
  prefilter: string;
  fullContent: boolean;
  activeApp: ActiveApp | null;
  commands: CommandSpec[];
  prefixes: PrefixSpec[];
  open: (prefilter?: string) => void;
  close: () => void;
  toggle: () => void;
  pushApp: (app: ActiveApp) => void;
  popApp: () => void;
  setFullContent: (v: boolean) => void;
  _register: (spec: CommandSpec) => void;
  _unregister: (id: string) => void;
  _registerPrefix: (spec: PrefixSpec) => void;
  _unregisterPrefix: (prefix: string) => void;
}

function loadFullContent(): boolean {
  try {
    return localStorage.getItem('lumen-full-content') === 'true';
  } catch {
    return false;
  }
}

function saveFullContent(v: boolean): void {
  try {
    localStorage.setItem('lumen-full-content', String(v));
  } catch {
    // localStorage unavailable
  }
}

export const useCommandStore = create<CommandStore>((set) => ({
  isOpen: false,
  prefilter: '',
  fullContent: loadFullContent(),
  activeApp: null,
  commands: [],
  prefixes: [],

  open: (prefilter = '') => set({ isOpen: true, prefilter }),
  close: () => set({ isOpen: false, prefilter: '' }),
  toggle: () => set((s) => (s.isOpen ? { isOpen: false, prefilter: '' } : { isOpen: true })),

  pushApp: (app) => set({ activeApp: app }),
  popApp: () => set({ activeApp: null }),
  setFullContent: (v) => {
    saveFullContent(v);
    set({ fullContent: v });
  },

  _register: (spec) =>
    set((s) => ({
      commands: s.commands.some((c) => c.id === spec.id)
        ? s.commands.map((c) => (c.id === spec.id ? spec : c))
        : [...s.commands, spec],
    })),
  _unregister: (id) => set((s) => ({ commands: s.commands.filter((c) => c.id !== id) })),

  _registerPrefix: (spec) =>
    set((s) => ({
      prefixes: s.prefixes.some((p) => p.prefix === spec.prefix)
        ? s.prefixes.map((p) => (p.prefix === spec.prefix ? spec : p))
        : [...s.prefixes, spec],
    })),
  _unregisterPrefix: (prefix) =>
    set((s) => ({ prefixes: s.prefixes.filter((p) => p.prefix !== prefix) })),
}));
