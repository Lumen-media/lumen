import { useModuleStore } from '../store';
import type { Disposable, PanelSpec, PanelsAPI } from '../types';

export function createPanelsAPI(moduleId: string): PanelsAPI {
  return {
    add(spec: PanelSpec): Disposable {
      useModuleStore.getState().addPanel(moduleId, spec);
      return {
        dispose() {
          useModuleStore.getState().removePanel(moduleId, spec.id);
        },
      };
    },
  };
}
