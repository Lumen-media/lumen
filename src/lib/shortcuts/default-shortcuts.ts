import { emit } from '@tauri-apps/api/event';
import { router } from '@/lib/router';
import { openPresentation } from '@/lib/present-window';
import { fileManagementService } from '@/services';
import { useAsideStore } from '@/stores/aside-store';
import { useChatStore } from '@/stores/chat-store';
import { useCommandStore } from '@/stores/command-store';
import { useLyricModalStore } from '@/stores/lyric-modal-store';
import { usePresentationStore } from '@/stores/presentation-store';
import { useShortcutsSheetStore } from '@/stores/shortcuts-sheet-store';
import type { ShortcutDefinition } from './types';

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

function stopPresentation(): void {
  emit('presenter:exit').catch(() => {});
  usePresentationStore.getState().clearPresentation();
}

function emitPresenterEvent(event: 'presenter:wallpaper-toggle' | 'presenter:lyrics-toggle' | 'presenter:blackout-toggle'): void {
  emit(event).catch(() => {});
}

function openChat(): void {
  useChatStore.getState().init().catch((err) => console.error('[chat] init failed:', err));
  useAsideStore.getState().setActiveTab('chat');
  useChatStore.getState().markRead();
  window.dispatchEvent(new CustomEvent('lumen:chat-focus'));
}

export const SHORTCUTS: ShortcutDefinition[] = [
  // File
  {
    id: 'file.new',
    keys: ['Mod+N'],
    name: 'New Presentation',
    group: 'File',
    scope: 'global',
    action: () => useLyricModalStore.getState().openQuick(),
  },
  {
    id: 'file.open',
    keys: ['Mod+O'],
    name: 'Open...',
    group: 'File',
    scope: 'global',
    action: () => void openPresentationFile(),
  },
  // Edit (disabled stubs — native clipboard/undo keeps working in inputs/editors)
  { id: 'edit.undo', keys: ['Mod+Z'], name: 'Undo', group: 'Edit', scope: 'global', enabled: false },
  { id: 'edit.redo', keys: ['Mod+Shift+Z'], name: 'Redo', group: 'Edit', scope: 'global', enabled: false },
  { id: 'edit.cut', keys: ['Mod+X'], name: 'Cut', group: 'Edit', scope: 'global', enabled: false },
  { id: 'edit.copy', keys: ['Mod+C'], name: 'Copy', group: 'Edit', scope: 'global', enabled: false },
  { id: 'edit.paste', keys: ['Mod+V'], name: 'Paste', group: 'Edit', scope: 'global', enabled: false },
  { id: 'edit.select-all', keys: ['Mod+A'], name: 'Select All', group: 'Edit', scope: 'global', enabled: false },
  // Presentation
  {
    id: 'presentation.start',
    keys: ['F5'],
    name: 'Start Presentation',
    group: 'Presentation',
    scope: 'global',
    action: () => void startPresentation(),
  },
  {
    id: 'presentation.stop',
    keys: ['Escape'],
    name: 'Stop Presentation',
    group: 'Presentation',
    scope: 'global',
    enabled: (gates) => gates.presenter,
    action: stopPresentation,
  },
  {
    id: 'presentation.next',
    keys: ['ArrowRight'],
    name: 'Next Slide',
    group: 'Presentation',
    scope: 'global',
    enabled: (gates) => gates.presenter,
    action: () => usePresentationStore.getState().nextSlide(),
  },
  {
    id: 'presentation.prev',
    keys: ['ArrowLeft'],
    name: 'Previous Slide',
    group: 'Presentation',
    scope: 'global',
    enabled: (gates) => gates.presenter,
    action: () => usePresentationStore.getState().prevSlide(),
  },
  // Presenter display toggles (emit events consumed by the media window)
  {
    id: 'presenter.wallpaper',
    keys: ['F8'],
    name: 'Toggle Wallpaper',
    group: 'Presentation',
    scope: 'global',
    enabled: (gates) => gates.presenter,
    action: () => emitPresenterEvent('presenter:wallpaper-toggle'),
  },
  {
    id: 'presenter.lyrics',
    keys: ['F9'],
    name: 'Toggle Lyrics',
    group: 'Presentation',
    scope: 'global',
    enabled: (gates) => gates.presenter,
    action: () => emitPresenterEvent('presenter:lyrics-toggle'),
  },
  {
    id: 'presenter.blackout',
    keys: ['F10'],
    name: 'Blackout Screen',
    group: 'Presentation',
    scope: 'global',
    enabled: (gates) => gates.presenter,
    action: () => emitPresenterEvent('presenter:blackout-toggle'),
  },
  // App
  {
    id: 'app.command-palette',
    keys: ['Mod+K'],
    name: 'Command Palette',
    group: 'App',
    scope: 'global',
    action: () => useCommandStore.getState().toggle(),
  },
  {
    id: 'app.open-chat',
    keys: ['Mod+Shift+C'],
    name: 'Open Chat',
    group: 'App',
    scope: 'global',
    action: openChat,
  },
  // Live (unbound — listed for the future shortcuts dialog)
  { id: 'live.start-streaming', keys: [], name: 'Start Streaming', group: 'Live', scope: 'global' },
  { id: 'live.stop-streaming', keys: [], name: 'Stop Streaming', group: 'Live', scope: 'global' },
  { id: 'live.configure-stream', keys: [], name: 'Configure Stream...', group: 'Live', scope: 'global' },
  // Help
  {
    id: 'help.shortcuts',
    keys: ['Mod+Shift+K'],
    name: 'Keyboard Shortcuts',
    group: 'Help',
    scope: 'global',
    action: () => useShortcutsSheetStore.getState().open(),
  },
  // Editor (scoped to the /edit route)
  {
    id: 'editor.next-slide',
    keys: ['ArrowDown', 'ArrowRight'],
    name: 'Select Next Slide',
    group: 'Editor',
    scope: 'editor',
  },
  {
    id: 'editor.prev-slide',
    keys: ['ArrowUp', 'ArrowLeft'],
    name: 'Select Previous Slide',
    group: 'Editor',
    scope: 'editor',
  },
  // Media window (presentation output)
  {
    id: 'media.fullscreen',
    keys: ['F11'],
    name: 'Toggle Fullscreen',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.wallpaper',
    keys: ['F8'],
    name: 'Toggle Wallpaper',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.hide-lyrics',
    keys: ['F9'],
    name: 'Toggle Lyrics',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.blackout',
    keys: ['F10'],
    name: 'Blackout Screen',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.escape',
    keys: ['Escape'],
    name: 'Exit / Close Window',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.next-slide',
    keys: ['ArrowRight', 'ArrowDown', 'PageDown'],
    name: 'Next Slide',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.prev-slide',
    keys: ['ArrowLeft', 'ArrowUp', 'PageUp'],
    name: 'Previous Slide',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.first-slide',
    keys: ['Home'],
    name: 'First Slide',
    group: 'Media',
    scope: 'media-window',
  },
  {
    id: 'media.last-slide',
    keys: ['End'],
    name: 'Last Slide',
    group: 'Media',
    scope: 'media-window',
  },
  // Overlay window (module overlay)
  {
    id: 'overlay.fullscreen',
    keys: ['F11'],
    name: 'Toggle Fullscreen',
    group: 'Overlay',
    scope: 'overlay-window',
  },
  {
    id: 'overlay.close',
    keys: ['Escape'],
    name: 'Close Overlay',
    group: 'Overlay',
    scope: 'overlay-window',
  },
  // Markdown presentation (rendered inside the media window)
  {
    id: 'markdown.next',
    keys: ['ArrowRight', 'ArrowDown', 'PageDown', 'Space'],
    name: 'Next Slide',
    group: 'Media',
    scope: 'markdown-presentation',
  },
  {
    id: 'markdown.prev',
    keys: ['ArrowLeft', 'ArrowUp', 'PageUp'],
    name: 'Previous Slide',
    group: 'Media',
    scope: 'markdown-presentation',
  },
  {
    id: 'markdown.first',
    keys: ['Home'],
    name: 'First Slide',
    group: 'Media',
    scope: 'markdown-presentation',
  },
  {
    id: 'markdown.last',
    keys: ['End'],
    name: 'Last Slide',
    group: 'Media',
    scope: 'markdown-presentation',
  },
];