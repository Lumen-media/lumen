import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { installModule } from '@/modules/injector';
import { useSettingsStore } from '@/stores/settings-store';
import { menuShortcut, shortcutAction } from '@/lib/shortcuts';
import type { MenuDef } from './menu-registry';
import { useMenuRegistry } from './menu-registry';

const DEFAULT_MENUS: MenuDef[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      {
        type: 'action',
        label: 'New Presentation',
        shortcut: menuShortcut('file.new'),
        onClick: shortcutAction('file.new'),
      },
      {
        type: 'action',
        label: 'Open',
        shortcut: menuShortcut('file.open'),
        onClick: shortcutAction('file.open'),
      },
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
    hidden: true,
    items: [
      { type: 'action', label: 'Undo', shortcut: menuShortcut('edit.undo') },
      { type: 'action', label: 'Redo', shortcut: menuShortcut('edit.redo') },
      { type: 'separator' },
      { type: 'action', label: 'Cut', shortcut: menuShortcut('edit.cut') },
      { type: 'action', label: 'Copy', shortcut: menuShortcut('edit.copy') },
      { type: 'action', label: 'Paste', shortcut: menuShortcut('edit.paste') },
      { type: 'separator' },
      { type: 'action', label: 'Select All', shortcut: menuShortcut('edit.select-all') },
    ],
  },
  {
    id: 'presentation',
    label: 'Presentation',
    items: [
      {
        type: 'action',
        label: 'Start',
        shortcut: menuShortcut('presentation.start'),
        onClick: shortcutAction('presentation.start'),
      },
      {
        type: 'action',
        label: 'Stop',
        shortcut: menuShortcut('presentation.stop'),
        onClick: shortcutAction('presentation.stop'),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Next Slide',
        shortcut: menuShortcut('presentation.next'),
        onClick: shortcutAction('presentation.next'),
      },
      {
        type: 'action',
        label: 'Previous Slide',
        shortcut: menuShortcut('presentation.prev'),
        onClick: shortcutAction('presentation.prev'),
      },
    ],
  },
  {
    id: 'live',
    label: 'Live',
    hidden: true,
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
      {
        type: 'action',
        label: 'Keyboard Shortcuts',
        shortcut: menuShortcut('help.shortcuts'),
        onClick: shortcutAction('help.shortcuts'),
      },
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
  DEFAULT_MENUS.forEach((menu, index) => { registerMenu(menu, index * 10); });
}