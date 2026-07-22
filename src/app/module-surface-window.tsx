import { createFileRoute } from '@tanstack/react-router';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useCallback, useEffect, useState } from 'react';
import { SurfaceWindowSlot } from '@/modules/components/SurfaceWindowSlot';
import { bootSingleModule } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';
import type { SurfaceWindowOptions } from '@/modules/types';

interface SurfaceProjectState {
  moduleId: string;
  panelId: string;
  props?: unknown;
  options?: SurfaceWindowOptions;
}

async function waitForSurfaceState(label: string): Promise<SurfaceProjectState | null> {
  for (let i = 0; i < 150; i++) {
    const json = await invoke<string | null>('get_surface_state', { label }).catch(() => null);
    if (json) {
      return JSON.parse(json) as SurfaceProjectState;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

export const Route = createFileRoute('/module-surface-window')({
  component: ModuleSurfaceWindow,
});

function ModuleSurfaceWindow() {
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);

  const closeWindow = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error('Failed to close surface window:', error);
    }
  }, []);

  useEffect(() => {
    let detachCloseListener: (() => void) | undefined;

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(() => {
          if (activeModuleId) {
            const state = useModuleStore.getState().getSurfaceWindow(activeModuleId);
            emit('module:surface-window-closed', {
              moduleId: activeModuleId,
              panelId: state?.panelId,
            }).catch(() => {});
          }
        }),
      )
      .then((unlisten) => {
        detachCloseListener = unlisten;
      })
      .catch(() => {});

    return () => {
      detachCloseListener?.();
    };
  }, [activeModuleId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void closeWindow();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeWindow]);

  useEffect(() => {
    let label = '';
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      label = 'unknown';
    }

    waitForSurfaceState(label)
      .then((state) => {
        if (!state) return;
        return bootSingleModule(state.moduleId, 'surface').then(() => state);
      })
      .then((state) => {
        if (!state) return;
        useModuleStore.getState().openSurfaceWindow(
          state.moduleId,
          state.panelId,
          state.props,
          state.options,
        );
        setActiveModuleId(state.moduleId);
      })
      .catch(console.error)
      .finally(() => {
        emit('module:surface-ready', { label }).catch(() => {});
      });
  }, [closeWindow]);

  useEffect(() => {
    let detachClearListener: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        return listen<{ moduleId: string }>('module:surface-clear', (event) => {
          useModuleStore.getState().clearSurfaceWindow(event.payload.moduleId);
          setActiveModuleId(null);
          void closeWindow();
        });
      })
      .then((fn) => {
        detachClearListener = fn;
      })
      .catch(() => {});

    return () => {
      detachClearListener?.();
    };
  }, [closeWindow]);

  if (!activeModuleId) return null;

  return <SurfaceWindowSlot moduleId={activeModuleId} />;
}
