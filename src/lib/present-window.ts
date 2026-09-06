import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { usePresentationStore } from '@/stores/presentation-store';

export async function ensureMediaWindow(): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel('media-window');
  if (existing) return existing;

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out')), 3000);
    listen('media-window-ready', () => {
      clearTimeout(timeout);
      resolve();
    }).catch(() => {});
  });

  await invoke('create_window', { label: 'media-window', title: 'Media Player' });
  await readyPromise;

  return WebviewWindow.getByLabel('media-window');
}

export async function openPresentation(filePath: string, initialSlide = 0): Promise<boolean> {
  try {
    const win = await ensureMediaWindow();
    if (!win) return false;

    await usePresentationStore.getState().loadPresentation(filePath, { initialSlide });
    await win.show();
    await win.setFullscreen(true);
    return true;
  } catch (err) {
    console.error('Failed to open presentation window:', err);
    return false;
  }
}