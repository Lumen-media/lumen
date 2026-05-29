import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '@/stores/settings-store';
import { installModule } from '@/modules/injector';
import type { MenuDef } from './menu-registry';
import { useMenuRegistry } from './menu-registry';

const DEFAULT_MENUS: MenuDef[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { type: 'action', label: 'New Presentation', shortcut: 'Ctrl+N' },
      { type: 'action', label: 'Open', shortcut: 'Ctrl+O' },
      { type: 'separator' },
      // { type: 'action', label: 'Save', shortcut: 'Ctrl+S' },
      // { type: 'action', label: 'Save As', shortcut: 'Ctrl+Shift+S' },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Exit',
        onClick: () => void getCurrentWindow().close(),
      },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { type: 'action', label: 'Undo', shortcut: 'Ctrl+Z' },
      { type: 'action', label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
      { type: 'separator' },
      { type: 'action', label: 'Cut', shortcut: 'Ctrl+X' },
      { type: 'action', label: 'Copy', shortcut: 'Ctrl+C' },
      { type: 'action', label: 'Paste', shortcut: 'Ctrl+V' },
      { type: 'separator' },
      { type: 'action', label: 'Select All', shortcut: 'Ctrl+A' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { type: 'action', label: 'Toggle Media Panel' },
      { type: 'action', label: 'Toggle Properties Panel' },
      { type: 'separator' },
      { type: 'action', label: 'Full Screen', shortcut: 'F11' },
      { type: 'separator' },
      { type: 'action', label: 'Zoom In', shortcut: 'Ctrl++' },
      { type: 'action', label: 'Zoom Out', shortcut: 'Ctrl+-' },
      { type: 'action', label: 'Reset Zoom', shortcut: 'Ctrl+0' },
    ],
  },
  {
    id: 'presentation',
    label: 'Presentation',
    items: [
      { type: 'action', label: 'Start', shortcut: 'F5' },
      { type: 'action', label: 'Stop', shortcut: 'Esc' },
      { type: 'separator' },
      { type: 'action', label: 'Next Slide', shortcut: '→' },
      { type: 'action', label: 'Previous Slide', shortcut: '←' },
      { type: 'separator' },
      { type: 'action', label: 'Loop' },
      { type: 'action', label: 'Shuffle' },
    ],
  },
  {
    id: 'live',
    label: 'Live',
    items: [
      { type: 'action', label: 'Start Streaming' },
      { type: 'action', label: 'Stop Streaming' },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Configure Stream...',
        onClick: () => useSettingsStore.getState().open('advanced'),
      },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      {
        type: 'action',
        label: 'New Module',
        onClick: async () => {
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Lumen Module', extensions: ['lumenpack'] }],
          });
          if (selected) await installModule(selected as string);
        },
      },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { type: 'action', label: 'Documentation' },
      { type: 'action', label: 'Keyboard Shortcuts', shortcut: 'Ctrl+Shift+K' },
      { type: 'separator' },
      {
        type: 'action',
        label: 'About Lumen',
        onClick: () => useSettingsStore.getState().open('about'),
      },
    ],
  },
];

export function registerDefaultMenus() {
  const { registerMenu } = useMenuRegistry.getState();
  DEFAULT_MENUS.forEach((menu, index) => registerMenu(menu, index * 10));
}
