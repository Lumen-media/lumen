import { useMenuRegistry } from '@/components/titlebar/menu-registry';
import type { Disposable, MenuItemAction, MenusAPI, MenuSpec } from '../types';

export function createMenusAPI(): MenusAPI {
  return {
    register(spec: MenuSpec): Disposable {
      useMenuRegistry.getState().registerMenu(
        { id: spec.id, label: spec.label, items: spec.items ?? [] },
        spec.priority,
      );
      return {
        dispose() {
          useMenuRegistry.getState().unregisterMenu(spec.id);
        },
      };
    },

    addItem(menuId: string, item: MenuItemAction, priority?: number): Disposable {
      useMenuRegistry.getState().registerMenuItem(menuId, item, priority);
      return {
        dispose() {
          useMenuRegistry.getState().unregisterMenuItem(menuId, item.id);
        },
      };
    },
  };
}
