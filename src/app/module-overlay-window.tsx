import { createFileRoute } from '@tanstack/react-router';
import { emit, listen } from '@tauri-apps/api/event';
import { useCallback, useEffect } from 'react';
import { PresenterSlot } from '@/modules/components/PresenterSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';

interface WindowConfig {
  maximized?: boolean;
  resizable?: boolean;
  decorations?: boolean;
  title?: string;
  fullscreen?: boolean;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

async function applyWindowConfig(config?: WindowConfig) {
  if (!config) return;
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { PhysicalSize } = await import('@tauri-apps/api/dpi');
    const w = getCurrentWebviewWindow();

    if (config.title) await w.setTitle(config.title);
    if (config.decorations !== undefined) await w.setDecorations(config.decorations);
    if (config.resizable !== undefined) await w.setResizable(config.resizable);
    if (config.width !== undefined && config.height !== undefined) {
      await w.setSize(new PhysicalSize(config.width, config.height));
    }
    if (config.minWidth !== undefined || config.minHeight !== undefined) {
      await w.setMinSize(
        new PhysicalSize(
          config.minWidth ?? config.width ?? 720,
          config.minHeight ?? config.height ?? 405,
        ),
      );
    }
    if (config.maximized) await w.maximize();
    if (config.fullscreen) await w.setFullscreen(true);
  } catch (error) {
    console.error('Failed to apply overlay window config:', error);
  }
}

export const Route = createFileRoute('/module-overlay-window')({
  component: ModuleOverlayWindow,
});

function ModuleOverlayWindow() {
  const closeWindow = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error('Failed to close overlay window:', error);
    }
  }, []);

  const setDecorations = useCallback(async (decorated: boolean) => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().setDecorations(decorated);
    } catch (error) {
      console.error('Failed to set overlay window decorations:', error);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const appWindow = getCurrentWebviewWindow();
      const nextFullscreen = !(await appWindow.isFullscreen());

      if (nextFullscreen) {
        await setDecorations(false);
        await appWindow.setFullscreen(true);
      } else {
        await appWindow.setFullscreen(false);
        await setDecorations(true);
      }
    } catch (error) {
      console.error('Failed to toggle overlay fullscreen:', error);
    }
  }, [setDecorations]);

  useEffect(() => {
    let detachCloseListener: (() => void) | undefined;

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(() => {
        emit('module:overlay-window-closed').catch(() => { });
      }))
      .then((unlisten) => {
        detachCloseListener = unlisten;
      })
      .catch((error) => {
        console.error('Failed to bind overlay close listener:', error);
      });

    return () => {
      detachCloseListener?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (event.key !== 'Escape') return;
      event.preventDefault();
      void closeWindow();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeWindow, toggleFullscreen]);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    bootPresenterModules()
      .then(() => emit('module:overlay-ready').catch(() => { }))
      .catch(console.error);

    listen<{ viewId: string; props: unknown }>('module:overlay-project', (event) => {
      useModuleStore.getState().projectPanel(event.payload.viewId, event.payload.props);
      const config = (event.payload.props as { windowConfig?: WindowConfig })?.windowConfig;
      void applyWindowConfig(config);
    }).then((fn) => unlisteners.push(fn)).catch(() => {});

    listen('module:overlay-clear', () => {
      useModuleStore.getState().clearPresenter();
    }).then((fn) => unlisteners.push(fn)).catch(() => {});

    return () => {
      unlisteners.forEach((fn) => { try { fn(); } catch {} });
    };
  }, []);

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-black">
      <PresenterSlot />
    </div>
  );
}
