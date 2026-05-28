import { PhysicalPosition } from '@tauri-apps/api/window';
import { MoreHorizontal, Search } from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEventListener } from 'usehooks-ts';
import { useCommandStore } from '@/stores/command-store';
import { Kbd } from '../ui/kbd';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '../ui/menubar';
import { registerDefaultMenus } from './default-menus';
import { type MenuItemDef, useMenus } from './menu-registry';
import { useMenuOverflow } from './use-menu-overflow';
import { useOsType } from './use-os-type';
import { useWindowState } from './use-window-state';
import { TitlebarWindowControls } from './window-controls';

function MenuItems({ items, t }: { items: MenuItemDef[]; t: (key: string) => string }) {
  return items.map((item, i) => {
    if (item.type === 'separator') {
      return <MenubarSeparator key={item.id ?? `sep-${i}`} />;
    }
    if (item.type === 'submenu') {
      return (
        <MenubarSub key={item.label}>
          <MenubarSubTrigger>{t(item.label)}</MenubarSubTrigger>
          <MenubarSubContent>
            <MenuItems items={item.items} t={t} />
          </MenubarSubContent>
        </MenubarSub>
      );
    }
    return (
      <MenubarItem key={item.label} onClick={item.onClick}>
        {t(item.label)}
        {item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}
      </MenubarItem>
    );
  });
}

export function TitleBar() {
  const { t } = useTranslation();
  const osType = useOsType();
  const windowState = useWindowState();
  const { open: openCommand } = useCommandStore();
  const showMacControls = osType === 'macos';
  const dragIntentRef = useRef<{
    pointerOffsetX: number;
    pointerOffsetY: number;
    startClientX: number;
    startClientY: number;
    titlebarWidth: number;
  } | null>(null);
  const restoreDragInFlightRef = useRef(false);

  useEffect(() => {
    registerDefaultMenus();
  }, []);

  const menus = useMenus();

  const { containerRef, measureRef, visibleMenus, overflowMenus } = useMenuOverflow(menus);

  const clearDragIntent = () => {
    dragIntentRef.current = null;
    restoreDragInFlightRef.current = false;
  };

  const handleWindowMouseMove = async (event: MouseEvent) => {
    const dragIntent = dragIntentRef.current;
    if (!dragIntent || restoreDragInFlightRef.current) {
      return;
    }

    const movedEnough =
      Math.abs(event.clientX - dragIntent.startClientX) > 3 ||
      Math.abs(event.clientY - dragIntent.startClientY) > 3;

    if (!movedEnough) {
      return;
    }

    restoreDragInFlightRef.current = true;

    try {
      const { appWindow } = windowState;
      const horizontalRatio = dragIntent.pointerOffsetX / Math.max(dragIntent.titlebarWidth, 1);

      await appWindow.toggleMaximize();

      const restoredSize = await appWindow.outerSize();

      const nextX = Math.round(event.screenX - restoredSize.width * horizontalRatio);
      const nextY = Math.round(event.screenY - dragIntent.pointerOffsetY);

      await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
      await appWindow.startDragging();
    } finally {
      clearDragIntent();
    }
  };

  useEventListener('mousemove', (event) => {
    void handleWindowMouseMove(event);
  });
  useEventListener('mouseup', clearDragIntent);
  useEventListener('blur', clearDragIntent);

  const handleTitlebarMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-no-window-drag="true"]')) {
      return;
    }

    if (event.detail === 2 && osType !== 'macos') {
      void windowState.appWindow.toggleMaximize();
      return;
    }

    if (windowState.isMaximized && osType !== 'macos') {
      const currentTarget = event.currentTarget;
      const rect = currentTarget.getBoundingClientRect();

      dragIntentRef.current = {
        pointerOffsetX: event.clientX - rect.left,
        pointerOffsetY: event.clientY - rect.top,
        startClientX: event.clientX,
        startClientY: event.clientY,
        titlebarWidth: rect.width,
      };
      return;
    }

    void windowState.appWindow.startDragging();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: custom titlebar needs pointer handling for native window drag
    <header
      className="relative h-7 shrink-0 select-none bg-background/95"
      data-tauri-drag-region
      onMouseDown={handleTitlebarMouseDown}
    >
      <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center">
        <div
          ref={containerRef}
          className="relative flex min-w-0 items-center gap-2 overflow-hidden pl-2"
        >
          <div
            ref={measureRef}
            className="invisible pointer-events-none absolute top-0 left-0 flex whitespace-nowrap"
            aria-hidden
          >
            {menus.map((menu) => (
              <span key={menu.id} className="px-3 text-xs">
                {t(menu.label)}
              </span>
            ))}
          </div>

          {showMacControls ? (
            <div className="relative z-[60]">
              <TitlebarWindowControls osType={osType} windowState={windowState} />
            </div>
          ) : null}

          <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <img src="/logo.png" alt="Lumen" className="size-4 object-contain" />
          </div>

          <Menubar
            data-no-window-drag="true"
            className="h-full gap-0 rounded-none border-0 bg-transparent p-0"
          >
            {visibleMenus.map((menu) => (
              <MenubarMenu key={menu.id}>
                <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                  {t(menu.label)}
                </MenubarTrigger>
                <MenubarContent>
                  <MenuItems items={menu.items} t={t} />
                </MenubarContent>
              </MenubarMenu>
            ))}

            {overflowMenus.length > 0 && (
              <MenubarMenu>
                <MenubarTrigger className="h-full rounded-sm px-2 text-xs">
                  <MoreHorizontal className="size-3.5" />
                </MenubarTrigger>
                <MenubarContent>
                  {overflowMenus.map((menu) => (
                    <MenubarSub key={menu.id}>
                      <MenubarSubTrigger>{t(menu.label)}</MenubarSubTrigger>
                      <MenubarSubContent>
                        <MenuItems items={menu.items} t={t} />
                      </MenubarSubContent>
                    </MenubarSub>
                  ))}
                </MenubarContent>
              </MenubarMenu>
            )}
          </Menubar>
        </div>

        <div className="flex min-w-0 items-center justify-center px-2">
          <button
            data-no-window-drag="true"
            type="button"
            onClick={() => openCommand()}
            className="flex w-full max-w-md items-center gap-2 rounded-lg border border-border/70 bg-muted/45 px-3 py-1 text-xs transition-colors hover:bg-primary/10"
          >
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-left text-muted-foreground">
              {t('Type a command or search...')}
            </span>
            <Kbd className="h-auto text-xs">⌘ K</Kbd>
          </button>
        </div>

        <div
          data-no-window-drag="true"
          className="relative flex h-full z-[60] min-w-0 items-center justify-end"
        >
          {!showMacControls ? (
            <TitlebarWindowControls osType={osType} windowState={windowState} />
          ) : null}
        </div>
      </div>
    </header>
  );
}
