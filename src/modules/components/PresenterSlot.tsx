import { useModuleStore } from '../store';
import type { PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

export function PresenterSlot() {
  const clearPresenter = useModuleStore((s) => s.clearPresenter);
  const spec = useModuleStore<PanelSpec | null>((s) => {
    if (!s.presenterViewId) return null;
    for (const specs of s.panels.values()) {
      const found = specs.find((p) => p.id === s.presenterViewId && p.slot === 'presenter.content');
      if (found) return found;
    }
    return null;
  });
  const props = useModuleStore((s) => s.presenterProps);

  if (!spec) return null;

  const Component = spec.component;
  const moduleId = spec.id.split('.').slice(0, -1).join('.');

  return (
    <div className="fixed inset-0 z-50">
      <ModuleErrorBoundary moduleId={moduleId} panelId={spec.id}>
        <Component {...(props as Record<string, unknown>)} onClose={clearPresenter} />
      </ModuleErrorBoundary>
    </div>
  );
}
