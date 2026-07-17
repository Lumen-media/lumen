import { useMemo } from 'react';
import type React from 'react';
import { useModuleStore } from '../store';
import type { PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

export interface PresenterControlsSlotProps {
  kind: 'lyrics' | 'image' | 'presentation' | null;
  active: boolean;
  slideIndex: number;
  totalSlides: number;
}

type SlotPanel = {
  moduleId: string;
  spec: PanelSpec;
};

export function PresenterControlsSlot({ kind, active, slideIndex, totalSlides }: PresenterControlsSlotProps) {
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

        const Component = spec.component as unknown as React.ComponentType<PresenterControlsSlotProps>;
        const panelKey = `${moduleId}:${spec.id}:${index}`;

        return (
          <ModuleErrorBoundary key={panelKey} moduleId={moduleId} panelId={spec.id}>
            <Component kind={kind} active={active} slideIndex={slideIndex} totalSlides={totalSlides} />
          </ModuleErrorBoundary>
        );
      })}
    </>
  );
}
