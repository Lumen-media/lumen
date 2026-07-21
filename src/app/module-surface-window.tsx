import { createFileRoute } from '@tanstack/react-router';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useCallback, useEffect, useState } from 'react';
import { SurfaceWindowSlot } from '@/modules/components/SurfaceWindowSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';
import type { SurfaceWindowOptions } from '@/modules/types';

async function applyWindowOptions(options?: SurfaceWindowOptions) {
  if (!options) return;
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { PhysicalSize } = await import('@tauri-apps/api/dpi');
    const w = getCurrentWebviewWindow();

    if (options.title) await w.setTitle(options.title);
    if (options.decorations !== undefined) await w.setDecorations(options.decorations);
    if (options.resizable !== undefined) await w.setResizable(options.resizable);
    if (options.width !== undefined && options.height !== undefined) {
      await w.setSize(new PhysicalSize(options.width, options.height));
    }
    if (options.minWidth !== undefined || options.minHeight !== undefined) {
      await w.setMinSize(
        new PhysicalSize(
          options.minWidth ?? options.width ?? 720,
          options.minHeight ?? options.height ?? 480,
        ),
      );
    }
    if (options.maximized) await w.maximize();
    if (options.fullscreen !== undefined) await w.setFullscreen(options.fullscreen);
  } catch (error) {
    console.error('Failed to apply surface window options:', error);
  }
}

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
  const [status, setStatus] = useState('booting');

  const surfaceWindowsSize = useModuleStore((s) => s.surfaceWindows.size);
  const panelsSize = useModuleStore((s) => s.panels.size);

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
    let label = 'unknown';
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      label = 'unknown';
    }

    setStatus('loading modules');

    bootPresenterModules('surface')
      .then(() => {
        setStatus('waiting for state');
        return waitForSurfaceState(label);
      })
      .then((state) => {
        if (state) {
          useModuleStore.getState().openSurfaceWindow(
            state.moduleId,
            state.panelId,
            state.props,
            state.options,
          );
          setActiveModuleId(state.moduleId);
        }
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

  useEffect(() => {
    if (!activeModuleId) return;
    const state = useModuleStore.getState().getSurfaceWindow(activeModuleId);
    const timer = setTimeout(() => {
      void applyWindowOptions(state?.options);
    }, 200);
    return () => clearTimeout(timer);
  }, [activeModuleId]);

  if (!activeModuleId) {
    const label = (() => { try { return getCurrentWebviewWindow().label; } catch { return 'error'; } })();
    return (
      <div style={{ color: 'lime', background: '#111', padding: 40, fontFamily: 'monospace', fontSize: 18 }}>
        <p>[surface] status: {status}</p>
        <p>label: {label}</p>
        <p>activeModuleId: {activeModuleId ?? 'null'}</p>
        <p>store surfaceWindows: {surfaceWindowsSize}</p>
        <p>store panels: {panelsSize}</p>
      </div>
    );
  }

  return <SurfaceWindowSlot moduleId={activeModuleId} />;
}
