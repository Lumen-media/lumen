import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEventListener } from 'usehooks-ts';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);

    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const minimize = () => getCurrentWindow().minimize();
  const toggleMaximize = () => getCurrentWindow().toggleMaximize();
  const close = () => getCurrentWindow().close();

  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isMaximized) {
      getCurrentWindow().startDragging();
      return;
    }
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const onDragAreaDoubleClick = () => {
    dragStartPos.current = null;
    getCurrentWindow().toggleMaximize();
  };

  useEventListener('mousemove', (e) => {
    if (!dragStartPos.current) return;
    const dx = Math.abs(e.clientX - dragStartPos.current.x);
    const dy = Math.abs(e.clientY - dragStartPos.current.y);
    if (dx > 3 || dy > 3) {
      dragStartPos.current = null;
      getCurrentWindow().startDragging();
    }
  });

  useEventListener('mouseup', () => {
    dragStartPos.current = null;
  });

  return (
    <div className="relative z-[51] flex h-8 items-center bg-card border-b border-border shrink-0 select-none">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag region */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={onDragAreaDoubleClick}
        className="flex items-center px-3 shrink-0 h-full cursor-default"
      >
        <img src="/logo.png" alt="Lumen" className="size-4 object-contain" />
      </div>

      <Menubar className="h-full border-0 p-0 rounded-none bg-transparent gap-0 shrink-0">
        <MenubarMenu>
          <MenubarTrigger className="h-full rounded-none text-xs px-3">File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>
              New Presentation <MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Open... <MenubarShortcut>Ctrl+O</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Save <MenubarShortcut>Ctrl+S</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Save As... <MenubarShortcut>Ctrl+Shift+S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Export as PDF</MenubarItem>
            <MenubarItem>Export as Images</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={close}>Exit</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full rounded-none text-xs px-3">Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>
              Undo <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Redo <MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Cut <MenubarShortcut>Ctrl+X</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Copy <MenubarShortcut>Ctrl+C</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Paste <MenubarShortcut>Ctrl+V</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Select All <MenubarShortcut>Ctrl+A</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full rounded-none text-xs px-3">View</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Toggle Media Panel</MenubarItem>
            <MenubarItem>Toggle Properties Panel</MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Full Screen <MenubarShortcut>F11</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Zoom In <MenubarShortcut>Ctrl++</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Zoom Out <MenubarShortcut>Ctrl+-</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Reset Zoom <MenubarShortcut>Ctrl+0</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full rounded-none text-xs px-3">Presentation</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>
              Start <MenubarShortcut>F5</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Stop <MenubarShortcut>Esc</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Next Slide <MenubarShortcut>→</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Previous Slide <MenubarShortcut>←</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Loop</MenubarItem>
            <MenubarItem>Shuffle</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full rounded-none text-xs px-3">Live</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Start Streaming</MenubarItem>
            <MenubarItem>Stop Streaming</MenubarItem>
            <MenubarSeparator />
            <MenubarItem>Configure Stream...</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full rounded-none text-xs px-3">Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Documentation</MenubarItem>
            <MenubarItem>
              Keyboard Shortcuts <MenubarShortcut>Ctrl+Shift+K</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>About Lumen</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag region */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={onDragAreaDoubleClick}
        className="flex-1 h-full cursor-default"
      />

      <span className="absolute left-1/2 -translate-x-1/2 text-xs text-muted-foreground pointer-events-none">
        lumen
      </span>

      <div className="flex h-full shrink-0">
        <button
          type="button"
          onClick={minimize}
          className="h-full w-11 flex items-center justify-center hover:bg-primary/5 transition-colors"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={toggleMaximize}
          className="h-full w-11 flex items-center justify-center hover:bg-primary/5 transition-colors"
        >
          {isMaximized ? (
            <Copy className="size-2.5 -scale-x-100" />
          ) : (
            <Square className="size-2.5" />
          )}
        </button>
        <button
          type="button"
          onClick={close}
          className="h-full w-11 flex items-center justify-center hover:bg-destructive transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
