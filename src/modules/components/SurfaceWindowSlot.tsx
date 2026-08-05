import { emit } from '@tauri-apps/api/event';
import { useCallback, useRef } from 'react';
import { useModuleStore } from '../store';
import type { PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface SurfaceWindowSlotProps {
  moduleId: string;
}

export function SurfaceWindowSlot({ moduleId }: SurfaceWindowSlotProps) {
  const panelId = useModuleStore((s) => s.surfaceWindows.get(moduleId)?.panelId ?? null);
  const props = useModuleStore((s) => s.surfaceWindows.get(moduleId)?.props ?? null);

  const spec = useModuleStore<PanelSpec | null>((s) => {
    const active = s.surfaceWindows.get(moduleId);
    if (!active) return null;
    const specs = s.panels.get(moduleId) ?? [];
    return specs.find((p) => p.id === active.panelId && p.slot === 'surface.window') ?? null;
  });

  const clearSurfaceWindow = useModuleStore((s) => s.clearSurfaceWindow);

  const panelIdRef = useRef(panelId);
  panelIdRef.current = panelId;

  const close = useCallback(async () => {
    clearSurfaceWindow(moduleId);
    await emit('module:surface-window-closed', {
      moduleId,
      panelId: panelIdRef.current,
    }).catch(() => {});

    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error('Failed to close surface window:', error);
    }
  }, [clearSurfaceWindow, moduleId]);

  if (!panelId || !spec) return null;

  const Component = spec.component;

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-background text-foreground">
      <ModuleErrorBoundary moduleId={moduleId} panelId={spec.id}>
        <div data-module-scope={moduleId} className="h-full w-full overflow-hidden">
          <Component {...(props as Record<string, unknown>)} close={close} onClose={close} />
        </div>
      </ModuleErrorBoundary>
    </div>
  );
}
