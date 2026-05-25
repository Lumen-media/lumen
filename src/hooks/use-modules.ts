import { useEffect } from 'react';
import { bootModules, setOpenCommandPalette } from '@/modules/injector';
import { useCommandStore } from '@/stores/command-store';

export function useModules() {
  const openCommandPalette = useCommandStore((s) => s.open);

  useEffect(() => {
    setOpenCommandPalette(openCommandPalette);
    bootModules().catch((err) => {
      console.error('[modules] boot failed:', err);
    });
  }, [openCommandPalette]);
}
