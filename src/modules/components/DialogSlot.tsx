import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useModuleStore } from '../store';
import type { PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

export function DialogSlot() {
  const closeDialog = useModuleStore((s) => s.closeDialog);
  const spec = useModuleStore<PanelSpec | null>((s) => {
    if (!s.openDialogId) return null;
    for (const specs of s.panels.values()) {
      const found = specs.find((p) => p.id === s.openDialogId && p.slot === 'dialog');
      if (found) return found;
    }
    return null;
  });

  const isOpen = spec !== null;
  const Component = spec?.component;
  const moduleId = spec?.id.split('.').slice(0, -1).join('.');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
      <DialogContent
        showCloseButton={false}
        className="p-0 overflow-hidden"
        style={{ maxWidth: 'fit-content', width: 'auto' }}
      >
        {isOpen && Component && moduleId && (
          <ModuleErrorBoundary moduleId={moduleId} panelId={spec!.id}>
            <Component close={closeDialog} />
          </ModuleErrorBoundary>
        )}
      </DialogContent>
    </Dialog>
  );
}
