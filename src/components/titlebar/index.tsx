import { PhysicalPosition } from '@tauri-apps/api/window';
import { Search } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useRef } from 'react';
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
  MenubarTrigger,
} from '../ui/menubar';
import { useOsType } from './use-os-type';
import { useWindowState } from './use-window-state';
import { TitlebarWindowControls } from './window-controls';

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
      className="relative z-[60] h-7 shrink-0 select-none bg-background/95 backdrop-blur-sm"
      data-tauri-drag-region
      onMouseDown={handleTitlebarMouseDown}
    >
      <div className="relative grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center">
        <div className="flex min-w-0 items-center gap-2 pl-2">
          {showMacControls ? (
            <TitlebarWindowControls osType={osType} windowState={windowState} />
          ) : null}

          <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <img src="/logo.png" alt="Lumen" className="size-4 object-contain" />
          </div>

          <Menubar
            data-no-window-drag="true"
            className="h-full gap-0 rounded-none border-0 bg-transparent p-0"
          >
            <MenubarMenu>
              <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                {t('File')}
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  {t('New Presentation')} <MenubarShortcut>Ctrl+N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Open')} <MenubarShortcut>Ctrl+O</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  {t('Save')} <MenubarShortcut>Ctrl+S</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Save As')} <MenubarShortcut>Ctrl+Shift+S</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>{t('Export as PDF')}</MenubarItem>
                <MenubarItem>{t('Export as Images')}</MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => void windowState.appWindow.close()}>
                  {t('Exit')}
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                {t('Edit')}
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  {t('Undo')} <MenubarShortcut>Ctrl+Z</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Redo')} <MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  {t('Cut')} <MenubarShortcut>Ctrl+X</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Copy')} <MenubarShortcut>Ctrl+C</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Paste')} <MenubarShortcut>Ctrl+V</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  {t('Select All')} <MenubarShortcut>Ctrl+A</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                {t('View')}
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem>{t('Toggle Media Panel')}</MenubarItem>
                <MenubarItem>{t('Toggle Properties Panel')}</MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  {t('Full Screen')} <MenubarShortcut>F11</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  {t('Zoom In')} <MenubarShortcut>Ctrl++</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Zoom Out')} <MenubarShortcut>Ctrl+-</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Reset Zoom')} <MenubarShortcut>Ctrl+0</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                {t('Presentation')}
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem>
                  {t('Start')} <MenubarShortcut>F5</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Stop')} <MenubarShortcut>Esc</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>
                  {t('Next Slide')} <MenubarShortcut>→</MenubarShortcut>
                </MenubarItem>
                <MenubarItem>
                  {t('Previous Slide')} <MenubarShortcut>←</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>{t('Loop')}</MenubarItem>
                <MenubarItem>{t('Shuffle')}</MenubarItem>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                {t('Live')}
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem>{t('Start Streaming')}</MenubarItem>
                <MenubarItem>{t('Stop Streaming')}</MenubarItem>
                <MenubarSeparator />
                <MenubarItem>{t('Configure Stream...')}</MenubarItem>
              </MenubarContent>
            </MenubarMenu>

            <MenubarMenu>
              <MenubarTrigger className="h-full rounded-sm px-3 text-xs">
                {t('Help')}
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem>{t('Documentation')}</MenubarItem>
                <MenubarItem>
                  {t('Keyboard Shortcuts')} <MenubarShortcut>Ctrl+Shift+K</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem>{t('About Lumen')}</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </div>

        <div className="absolute left-1/2 top-1 flex min-w-0 -translate-x-1/2 justify-center px-3">
          <button
            data-no-window-drag="true"
            type="button"
            onClick={openCommand}
            className="flex py-1 w-full max-w-md items-center gap-2 rounded-lg border border-border/70 bg-muted/45 px-3 text-xs transition-colors hover:bg-primary/10"
          >
            <Search className="size-3.5 text-muted-foreground" />
            <span className="truncate text-left text-muted-foreground">
              {t('Type a command or search...')}
            </span>
            <Kbd className="text-xs h-auto">⌘ K</Kbd>
          </button>
        </div>

        <div data-no-window-drag="true" className="flex h-full min-w-0 items-center justify-end">
          {!showMacControls ? (
            <TitlebarWindowControls osType={osType} windowState={windowState} />
          ) : null}
        </div>
      </div>
    </header>
  );
}
