import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { installModule } from '@/modules/injector';
import { openPresentation } from '@/lib/present-window';
import { router } from '@/lib/router';
import { fileManagementService } from '@/services';
import { useLyricModalStore } from '@/stores/lyric-modal-store';
import { usePresentationStore } from '@/stores/presentation-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { MenuDef } from './menu-registry';
import { useMenuRegistry } from './menu-registry';

const PRESENTATION_PREVIEW_STORAGE_KEY = 'lumen:presentation-preview-file';

function goToLyricEditor(): void {
  useLyricModalStore.getState().open();
  router.navigate({ to: '/edit' });
}

async function openPresentationFile(): Promise<void> {
  const selected = await fileManagementService.openFilePicker('presentation');
  if (!selected || selected.length === 0) return;

  try {
    await fileManagementService.uploadFiles('presentation', selected);
  } catch (err) {
    console.error('Failed to import presentation:', err);
  }

  goToLyricEditor();
}

async function startPresentation(): Promise<void> {
  const { filePath } = usePresentationStore.getState();
  const target = filePath ?? localStorage.getItem(PRESENTATION_PREVIEW_STORAGE_KEY);
  if (!target) return;
  await openPresentation(target);
}

const DEFAULT_MENUS: MenuDef[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      {
        type: 'action',
        label: 'New Presentation',
        shortcut: 'Ctrl+N',
        onClick: goToLyricEditor,
      },
      {
        type: 'action',
        label: 'Open',
        shortcut: 'Ctrl+O',
        onClick: () => void openPresentationFile(),
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
    id: 'presentation',
    label: 'Presentation',
    items: [
      {
        type: 'action',
        label: 'Start',
        shortcut: 'F5',
        onClick: () => void startPresentation(),
      },
      {
        type: 'action',
        label: 'Stop',
        shortcut: 'Esc',
        onClick: () => usePresentationStore.getState().clearPresentation(),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Next Slide',
        shortcut: '→',
        onClick: () => usePresentationStore.getState().nextSlide(),
      },
      {
        type: 'action',
        label: 'Previous Slide',
        shortcut: '←',
        onClick: () => usePresentationStore.getState().prevSlide(),
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
  DEFAULT_MENUS.forEach((menu, index) => { registerMenu(menu, index * 10); });
}