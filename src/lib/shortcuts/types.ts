import type { Hotkey } from '@tanstack/react-hotkeys';

declare module '@tanstack/hotkeys' {
  interface HotkeyMeta {
    group?: string;
  }
}

export type ShortcutScope = 'global' | 'editor' | 'media-window' | 'overlay-window' | 'markdown-presentation';

export interface ShortcutGate {
  presenter: boolean;
}

export interface ShortcutDefinition {
  id: string;
  keys: Hotkey[];
  name: string;
  description?: string;
  group: string;
  scope: ShortcutScope;
  enabled?: boolean | ((gates: ShortcutGate) => boolean);
  action?: () => void;
}