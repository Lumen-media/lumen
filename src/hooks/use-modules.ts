import { useEffect } from 'react';
import { bootModules, setOpenCommandPalette } from '@/modules/injector';
import { autoUpdateInstalledModules } from '@/services/store-service';
import { useCommandStore } from '@/stores/command-store';

export function useModules(enabled = true) {
  const openCommandPalette = useCommandStore((s) => s.open);

  useEffect(() => {
    if (!enabled) return;

    setOpenCommandPalette(openCommandPalette);
    bootModules()
      // Modules load from disk first so the app is usable offline; any newer
      // store releases are then applied in the background.
      .then(() => autoUpdateInstalledModules())
      .catch((err) => {
        console.error('[modules] boot failed:', err);
      });
  }, [enabled, openCommandPalette]);
}
