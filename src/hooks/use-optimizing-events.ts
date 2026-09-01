import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { useOptimizingStore } from '@/stores/optimizing-store';

export function useOptimizingEvents() {
  useEffect(() => {
    let disposed = false;
    let unlisten: Array<() => void> = [];
    const { start, finish } = useOptimizingStore.getState();

    const setup = async () => {
      unlisten = await Promise.all([
        listen<string>('lumen:optimizing', (e) => {
          if (!disposed) start(e.payload);
        }),
        listen<string>('lumen:optimized', (e) => {
          if (!disposed) finish(e.payload);
        }),
      ]);
    };
    setup();

    return () => {
      disposed = true;
      for (const fn of unlisten) {
        fn();
      }
    };
  }, []);
}