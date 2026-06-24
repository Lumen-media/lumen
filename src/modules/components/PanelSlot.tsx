import { useMemo } from 'react';
import { useModuleStore } from '../store';
import type { PanelProps, PanelSpec, SlotName } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface PanelSlotProps {
  slot: SlotName;
  panelProps?: PanelProps;
}

type SlotPanel = {
  moduleId: string;
  spec: PanelSpec;
};

export function PanelSlot({ slot, panelProps = {} }: PanelSlotProps) {
  const panelMap = useModuleStore((s) => s.panels);
  const panels = useMemo(() => {
    const result: SlotPanel[] = [];

    for (const [moduleId, specs] of panelMap.entries()) {
      for (const spec of specs) {
        if (spec.slot === slot) {
          result.push({ moduleId, spec });
        }
      }
    }

    return result;
  }, [panelMap, slot]);

  if (panels.length === 0) return null;

  return (
    <>
      {panels.map(({ moduleId, spec }, index) => {
        if (spec.when && !spec.when()) return null;

        const Component = spec.component;
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
