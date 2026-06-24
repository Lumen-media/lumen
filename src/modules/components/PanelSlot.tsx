import { useMemo } from 'react';
import { useModuleStore } from '../store';
import type { PanelProps, PanelSpec, SlotName } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface PanelSlotProps {
  slot: SlotName;
  panelProps?: PanelProps;
}

export function PanelSlot({ slot, panelProps = {} }: PanelSlotProps) {
  const panelMap = useModuleStore((s) => s.panels);
  const panels = useMemo(() => {
    const result: PanelSpec[] = [];

    for (const specs of panelMap.values()) {
      for (const spec of specs) {
        if (spec.slot === slot) {
          result.push(spec);
        }
      }
    }

    return result;
  }, [panelMap, slot]);

  if (panels.length === 0) return null;

  return (
    <>
      {panels.map((spec) => {
        if (spec.when && !spec.when()) return null;

        const moduleId = spec.id.split('.').slice(0, -1).join('.');
        const Component = spec.component;

        return (
          <ModuleErrorBoundary key={spec.id} moduleId={moduleId} panelId={spec.id}>
            <Component {...panelProps} />
          </ModuleErrorBoundary>
        );
      })}
    </>
  );
}
