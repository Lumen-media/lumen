import { createFileRoute } from '@tanstack/react-router';
import { emit, listen } from '@tauri-apps/api/event';
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

export const Route = createFileRoute('/module-surface-window')({
  component: ModuleSurfaceWindow,
});

function ModuleSurfaceWindow() {
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string>('none');

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
    const unlisteners: (() => void)[] = [];

    let label = '';
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      console.error('[surface] failed to get window label');
      label = 'unknown';
    }

    console.log('[surface] booting, label:', label);

    const booted = bootPresenterModules('surface')
      .then(() => console.log('[surface] modules booted'));

    const projectListener = listen<{
      moduleId: string;
      panelId: string;
      props?: unknown;
      options?: SurfaceWindowOptions;
    }>('module:surface-project', (event) => {
      setLastEvent(`RECEIVED: ${JSON.stringify(event.payload)}`);
      console.log('[surface] received module:surface-project', event.payload);
      useModuleStore
        .getState()
        .openSurfaceWindow(
          event.payload.moduleId,
          event.payload.panelId,
          event.payload.props,
          event.payload.options,
        );
      setActiveModuleId(event.payload.moduleId);
      void applyWindowOptions(event.payload.options);
    })
      .then((fn) => {
        unlisteners.push(fn);
        setLastEvent('listener_registered');
        console.log('[surface] projectListener registered');
      })
      .catch((err) => {
        setLastEvent(`listener_error: ${err}`);
        console.error('[surface] projectListener failed:', err);
      });

    const clearListener = listen<{ moduleId: string }>('module:surface-clear', (event) => {
      useModuleStore.getState().clearSurfaceWindow(event.payload.moduleId);
      setActiveModuleId(null);
      void closeWindow();
    })
      .then((fn) => {
        unlisteners.push(fn);
      })
      .catch(() => {});

    Promise.all([booted, projectListener, clearListener])
      .then(() => {
        setLastEvent('all_ready');
        console.log('[surface] all ready, emitting module:surface-ready');
        return emit('module:surface-ready', { label }).catch(() => {});
      })
      .then(() => {
        // self-test: emit an event and see if our own listener catches it
        emit('module:surface-project', {
          moduleId: 'test-self',
          panelId: 'test',
          props: {},
          options: {},
        }).catch(() => {});
      })
      .catch(console.error);

    return () => {
      unlisteners.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, [closeWindow]);

  if (!activeModuleId) {
    return (
      <div style={{ color: 'lime', background: '#111', padding: 40, fontFamily: 'monospace', fontSize: 18 }}>
        <p>[surface] waiting for project event...</p>
        <p>label: {(() => { try { return getCurrentWebviewWindow().label; } catch { return 'error'; } })()}</p>
        <p>activeModuleId: {activeModuleId ?? 'null'}</p>
        <p>store surfaceWindows: {useModuleStore((s) => s.surfaceWindows.size)}</p>
        <p>store panels: {useModuleStore((s) => s.panels.size)}</p>
        <p>lastEvent: {lastEvent}</p>
      </div>
    );
  }

  return <SurfaceWindowSlot moduleId={activeModuleId} />;
}
