import { useEffect } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { checkForUpdate, getUpdateProgress, onUpdateProgress } from '@/services/app-update-service';
import { useAppUpdateStore } from '@/stores/app-update-store';

/**
 * Watches the app updater. Every time the main window mounts we ask the
 * backend for an update and surface the prompt if there is one. The backend
 * remembers versions the user postponed, so a dismissed update stays quiet.
 */
export function useAppUpdateWatcher(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let dispose: (() => void) | null = null;
    let cancelled = false;

    onUpdateProgress((progress) => {
      useAppUpdateStore.getState().applyProgress(progress);
    })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else dispose = unlisten;
      })
      .catch(() => {});

    // Hydrate in case progress was emitted before this window mounted.
    getUpdateProgress()
      .then((progress) => {
        if (!cancelled) useAppUpdateStore.getState().applyProgress(progress);
      })
      .catch(() => {});

    checkForUpdate()
      .then((info) => {
        if (info && !cancelled) useAppUpdateStore.getState().announce(info);
      })
      .catch((error) => {
        // A failed check is not worth interrupting the user for; the manual
        // action in Settings surfaces its own error.
        console.warn('update check failed', error);
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [enabled]);
}

/**
 * User-initiated check. Unlike the automatic one this ignores a previously
 * dismissed version and always reports the outcome.
 */
export async function checkForUpdatesManually(): Promise<void> {
  const store = useAppUpdateStore.getState();
  store.applyProgress({
    state: 'checking',
    version: null,
    downloaded: 0,
    total: null,
    error: null,
  });

  try {
    const info = await checkForUpdate(true);
    if (!info) {
      toast.success(t('Your app is up to date'));
      return;
    }
    store.announce(info);
  } catch (error) {
    store.applyProgress({
      state: 'error',
      version: null,
      downloaded: 0,
      total: null,
      error: null,
    });
    toast.error(t('Could not check for updates'), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
