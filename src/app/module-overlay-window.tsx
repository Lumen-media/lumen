import { createFileRoute } from '@tanstack/react-router';
import { emit, listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { PresenterSlot } from '@/modules/components/PresenterSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';

export const Route = createFileRoute('/module-overlay-window')({
  component: ModuleOverlayWindow,
});

function ModuleOverlayWindow() {
  useEffect(() => {
    const onUnload = () => emit('module:overlay-window-closed').catch(() => {});
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    bootPresenterModules()
      .then(() => emit('module:overlay-ready').catch(() => {}))
      .catch(console.error);

    const unlistenProject = listen<{ viewId: string; props: unknown }>('module:overlay-project', (event) => {
      useModuleStore.getState().projectPanel(event.payload.viewId, event.payload.props);
    });

    const unlistenClear = listen('module:overlay-clear', () => {
      useModuleStore.getState().clearPresenter();
    });

    return () => {
      unlistenProject.then((dispose) => dispose());
      unlistenClear.then((dispose) => dispose());
    };
  }, []);

  return (
    <div className="relative h-dvh w-dvw bg-transparent overflow-hidden">
      <PresenterSlot />
    </div>
  );
}