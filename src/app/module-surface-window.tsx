import { createFileRoute } from '@tanstack/react-router';
import { emit, listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo } from 'react';
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
  const moduleId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('moduleId') ?? '';
  }, []);

  const closeWindow = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error('Failed to close surface window:', error);
    }
  }, []);

  useEffect(() => {
    if (!moduleId) return;
    let detachCloseListener: (() => void) | undefined;

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(() => {
          const state = useModuleStore.getState().getSurfaceWindow(moduleId);
          emit('module:surface-window-closed', { moduleId, panelId: state?.panelId }).catch(
            () => {},
          );
        }),
      )
      .then((unlisten) => {
        detachCloseListener = unlisten;
      })
      .catch((error) => {
        console.error('Failed to bind surface close listener:', error);
      });

    return () => {
      detachCloseListener?.();
    };
  }, [moduleId]);

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
    if (!moduleId) return;
    const unlisteners: (() => void)[] = [];

    const booted = bootPresenterModules('surface');

    const projectListener = listen<{
      moduleId: string;
      panelId: string;
      props?: unknown;
      options?: SurfaceWindowOptions;
    }>('module:surface-project', (event) => {
      if (event.payload.moduleId !== moduleId) return;
      useModuleStore
        .getState()
        .openSurfaceWindow(
          event.payload.moduleId,
          event.payload.panelId,
          event.payload.props,
          event.payload.options,
        );
      void applyWindowOptions(event.payload.options);
    })
      .then((fn) => {
        unlisteners.push(fn);
      })
      .catch(() => {});

    const clearListener = listen<{ moduleId: string }>('module:surface-clear', (event) => {
      if (event.payload.moduleId !== moduleId) return;
      useModuleStore.getState().clearSurfaceWindow(moduleId);
      void closeWindow();
    })
      .then((fn) => {
        unlisteners.push(fn);
      })
      .catch(() => {});

    Promise.all([booted, projectListener, clearListener])
      .then(() => emit('module:surface-ready', { moduleId }).catch(() => {}))
      .catch(console.error);

    return () => {
      unlisteners.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, [closeWindow, moduleId]);

  if (!moduleId) return null;

  return <SurfaceWindowSlot moduleId={moduleId} />;
}
