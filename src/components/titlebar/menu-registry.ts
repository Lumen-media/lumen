export type MenuItemSeparator = { type: 'separator' }

export type MenuItemAction = {
  type: 'action'
  label: string
  shortcut?: string
  onClick?: () => void
}

export type MenuItemDef = MenuItemSeparator | MenuItemAction

export type MenuDef = {
  id: string
  label: string
  items: MenuItemDef[]
}
