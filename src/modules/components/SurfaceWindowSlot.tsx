import { emit } from '@tauri-apps/api/event';
import { useCallback } from 'react';
import { useModuleStore } from '../store';
import type { PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface SurfaceWindowSlotProps {
  moduleId: string;
}

export function SurfaceWindowSlot({ moduleId }: SurfaceWindowSlotProps) {
  const state = useModuleStore((s) => s.surfaceWindows.get(moduleId) ?? null);

  const spec = useModuleStore<PanelSpec | null>((s) => {
    const active = s.surfaceWindows.get(moduleId);
    if (!active) return null;
    const specs = s.panels.get(moduleId) ?? [];
    return specs.find((p) => p.id === active.panelId && p.slot === 'surface.window') ?? null;
  });

  const allPanels = useModuleStore((s) => s.panels.get(moduleId));

  const clearSurfaceWindow = useModuleStore((s) => s.clearSurfaceWindow);

  if (!state || !spec) {
    console.log('[SurfaceWindowSlot] not rendering', {
      moduleId,
      hasState: !!state,
      hasSpec: !!spec,
      statePanelId: state?.panelId,
      panelCount: allPanels?.length ?? 0,
      panelIds: allPanels?.map(p => p.id),
      panelSlots: allPanels?.map(p => p.slot),
    });
    return null;
  }

  const close = useCallback(async () => {
    clearSurfaceWindow(moduleId);
    await emit('module:surface-window-closed', {
      moduleId,
      panelId: state?.panelId,
    }).catch(() => {});

    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWebviewWindow().close();
    } catch (error) {
      console.error('Failed to close surface window:', error);
    }
  }, [clearSurfaceWindow, moduleId, state?.panelId]);

  if (!state || !spec) return null;

  const Component = spec.component;
  const props = (state.props ?? {}) as Record<string, unknown>;

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-background text-foreground">
      <ModuleErrorBoundary moduleId={moduleId} panelId={spec.id}>
        <div data-module-scope={moduleId} className="h-full w-full overflow-hidden">
          <Component {...props} close={close} onClose={close} />
        </div>
      </ModuleErrorBoundary>
    </div>
  );
}
