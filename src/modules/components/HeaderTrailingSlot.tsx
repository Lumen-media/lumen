import { useMemo } from 'react';
import type React from 'react';
import { useModuleStore } from '../store';
import type { PanelProps, PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface HeaderTrailingSlotProps {
  panelProps?: PanelProps;
}

type SlotPanel = {
  moduleId: string;
  spec: PanelSpec;
};

export function HeaderTrailingSlot({ panelProps = {} }: HeaderTrailingSlotProps) {
  const panelMap = useModuleStore((s) => s.panels);
  const panels = useMemo(() => {
    const result: SlotPanel[] = [];

    for (const [moduleId, specs] of panelMap.entries()) {
      for (const spec of specs) {
        if (spec.slot === 'app.header.trailing') {
          result.push({ moduleId, spec });
        }
      }
    }

    return result;
  }, [panelMap]);

  if (panels.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {panels.map(({ moduleId, spec }, index) => {
        if (spec.when && !spec.when()) return null;

        const Component = spec.component as React.ComponentType<PanelProps>;
        const panelKey = `${moduleId}:${spec.id}:${index}`;

        return (
          <ModuleErrorBoundary key={panelKey} moduleId={moduleId} panelId={spec.id}>
            <div className="min-w-0 max-w-36 shrink-0 overflow-hidden rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs empty:hidden">
              <Component {...panelProps} />
            </div>
          </ModuleErrorBoundary>
        );
      })}
    </div>
  );
}
