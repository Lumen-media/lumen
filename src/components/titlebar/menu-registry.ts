import { useMemo } from 'react';
import { create } from 'zustand';

export type MenuItemSeparator = { type: 'separator'; id?: string }

export type MenuItemAction = {
  type: 'action'
  id?: string
  label: string
  shortcut?: string
  onClick?: () => void
}

export type MenuItemSubmenu = {
  type: 'submenu'
  id?: string
  label: string
  items: MenuItemDef[]
}

export type MenuItemDef = MenuItemSeparator | MenuItemAction | MenuItemSubmenu

export type MenuDef = {
  id: string
  label: string
  items: MenuItemDef[]
}

type RegisteredMenu = { def: MenuDef; priority: number }
type RegisteredItem = { menuId: string; item: MenuItemDef & { id: string }; priority: number }

interface MenuRegistryStore {
  _menus: RegisteredMenu[]
  _extraItems: RegisteredItem[]
  registerMenu: (def: MenuDef, priority?: number) => void
  unregisterMenu: (menuId: string) => void
  registerMenuItem: (menuId: string, item: MenuItemDef & { id: string }, priority?: number) => void
  unregisterMenuItem: (menuId: string, itemId: string) => void
}

export const useMenuRegistry = create<MenuRegistryStore>((set) => ({
  _menus: [],
  _extraItems: [],
  registerMenu: (def, priority = 0) =>
    set((s) => ({
      _menus: [...s._menus.filter((m) => m.def.id !== def.id), { def, priority }].sort(
        (a, b) => a.priority - b.priority
      ),
    })),
  unregisterMenu: (menuId) =>
    set((s) => ({ _menus: s._menus.filter((m) => m.def.id !== menuId) })),
  registerMenuItem: (menuId, item, priority = 0) =>
    set((s) => ({
      _extraItems: [
        ...s._extraItems.filter((i) => !(i.menuId === menuId && i.item.id === item.id)),
        { menuId, item, priority },
      ],
    })),
  unregisterMenuItem: (menuId, itemId) =>
    set((s) => ({
      _extraItems: s._extraItems.filter(
        (i) => !(i.menuId === menuId && i.item.id === itemId)
      ),
    })),
}))

export function useMenus(): MenuDef[] {
  const registeredMenus = useMenuRegistry((s) => s._menus)
  const extraItems = useMenuRegistry((s) => s._extraItems)
  return useMemo(
    () =>
      registeredMenus.map(({ def }) => {
        const extras = extraItems
          .filter((i) => i.menuId === def.id)
          .sort((a, b) => a.priority - b.priority)
          .map((i) => i.item)
        if (extras.length === 0) return def
        return { ...def, items: [...def.items, ...extras] }
      }),
    [registeredMenus, extraItems]
  )
}
