import { useModuleStore } from '../store';
import type { PanelProps, SlotName } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface PanelSlotProps {
  slot: SlotName;
  panelProps?: PanelProps;
}

export function PanelSlot({ slot, panelProps = {} }: PanelSlotProps) {
  const panels = useModuleStore((s) => s.getPanelsForSlot(slot));

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
