import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
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
  const json = await invoke<string | null>('get_surface_state', { label }).catch(() => null);
  return json ? (JSON.parse(json) as SurfaceProjectState) : null;
}

export const Route = createFileRoute('/module-surface-window')({
  component: ModuleSurfaceWindow,
});

function ModuleSurfaceWindow() {
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const readyEmitted = useRef(false);
  const booted = useRef(false);
  const activeModuleIdRef = useRef<string | null>(null);
  activeModuleIdRef.current = activeModuleId;

  const emitReady = useCallback(() => {
    if (readyEmitted.current) return;
    readyEmitted.current = true;
    let label = '';
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      return;
    }
    emit('module:surface-ready', { label }).catch(() => { });
  }, []);

  const closeWindow = useCallback(async () => {
    try {
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error('Failed to close surface window:', error);
    }
  }, []);

  useEffect(() => {
    let detachCloseListener: (() => void) | undefined;
    let cancelled = false;

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(() => {
          const moduleId = activeModuleIdRef.current;
          if (!moduleId) return;
          const state = useModuleStore.getState().getSurfaceWindow(moduleId);
          emit('module:surface-window-closed', {
            moduleId,
            panelId: state?.panelId,
          }).catch(() => { });
        })
      )
      .then((unlisten) => {
        if (!cancelled) detachCloseListener = unlisten;
        else unlisten();
      })
      .catch(() => { });

    return () => {
      cancelled = true;
      detachCloseListener?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let label = '';
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      label = 'unknown';
    }

    (async () => {
      try {
        const state = await waitForSurfaceState(label);
        if (cancelled || !state) {
          emitReady();
          return;
        }

        useModuleStore
          .getState()
          .openSurfaceWindow(state.moduleId, state.panelId, state.props, state.options);

        await bootSingleModule(state.moduleId, 'surface');
        if (cancelled) {
          emitReady();
          return;
        }

        booted.current = true;
        setActiveModuleId(state.moduleId);
      } catch (error) {
        console.error(error);
        emitReady();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [emitReady]);

  useEffect(() => {
    if (booted.current && activeModuleId) {
      booted.current = false;
      setTimeout(() => emitReady(), 0);
    }
  }, [activeModuleId, emitReady]);

  useEffect(() => {
    let detachClearListener: (() => void) | undefined;
    let cancelled = false;

    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ moduleId: string }>('module:surface-clear', (event) => {
          const current = activeModuleIdRef.current;
          if (current && event.payload.moduleId !== current) return;
          useModuleStore.getState().clearSurfaceWindow(event.payload.moduleId);
          setActiveModuleId(null);
          void closeWindow();
        })
      )
      .then((fn) => {
        if (!cancelled) detachClearListener = fn;
        else fn();
      })
      .catch(() => { });

    return () => {
      cancelled = true;
      detachClearListener?.();
    };
  }, [closeWindow]);

  if (!activeModuleId) return null;

  return (
    <>
      <SurfaceWindowSlot moduleId={activeModuleId} />
      <Toaster />
    </>
  );
}
