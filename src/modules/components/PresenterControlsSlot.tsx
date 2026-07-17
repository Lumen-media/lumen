import { useMemo } from 'react';
import type React from 'react';
import { useModuleStore } from '../store';
import type { PanelProps, PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface PresenterControlsSlotProps {
  panelProps?: PanelProps;
}

type SlotPanel = {
  moduleId: string;
  spec: PanelSpec;
};

export function PresenterControlsSlot({ panelProps = {} }: PresenterControlsSlotProps) {
  const panelMap = useModuleStore((s) => s.panels);
  const panels = useMemo(() => {
    const result: SlotPanel[] = [];

    for (const [moduleId, specs] of panelMap.entries()) {
      for (const spec of specs) {
        if (spec.slot === 'presenter.controls.item') {
          result.push({ moduleId, spec });
        }
      }
    }

    return result;
  }, [panelMap]);

  if (panels.length === 0) return null;

  return (
    <>
      {panels.map(({ moduleId, spec }, index) => {
        if (spec.when && !spec.when()) return null;

        const Component = spec.component as React.ComponentType<PanelProps>;
        const panelKey = `${moduleId}:${spec.id}:${index}`;

        return (
          <ModuleErrorBoundary key={panelKey} moduleId={moduleId} panelId={spec.id}>
            <Component {...panelProps} />
          </ModuleErrorBoundary>
        );
      })}
    </>
  );
}
