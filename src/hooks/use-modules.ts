import { useEffect } from 'react';
import { bootModules, setOpenCommandPalette } from '@/modules/injector';
import { useCommandStore } from '@/stores/command-store';

export function useModules(enabled = true) {
  const openCommandPalette = useCommandStore((s) => s.open);

  useEffect(() => {
    if (!enabled) return;

    setOpenCommandPalette(openCommandPalette);
    bootModules().catch((err) => {
      console.error('[modules] boot failed:', err);
    });
  }, [enabled, openCommandPalette]);
}
