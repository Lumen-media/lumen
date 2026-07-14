import { createFileRoute } from '@tanstack/react-router';
import { emit, listen } from '@tauri-apps/api/event';
import { useCallback, useEffect } from 'react';
import { PresenterSlot } from '@/modules/components/PresenterSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';

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
    bootPresenterModules()
      .then(() => emit('module:overlay-ready').catch(() => { }))
      .catch(console.error);

    const unlistenProject = listen<{ viewId: string; props: unknown }>('module:overlay-project', (event) => {
      useModuleStore.getState().projectPanel(event.payload.viewId, event.payload.props);
    });
    const unlistenClear = listen('module:overlay-clear', () => {
      useModuleStore.getState().clearPresenter();
    });

    return () => {
      unlistenProject.then((f) => f());
      unlistenClear.then((f) => f());
    };
  }, []);

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-black">
      <PresenterSlot />
    </div>
  );
}
