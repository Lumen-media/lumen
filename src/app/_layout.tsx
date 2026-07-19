import { DndContext, DragOverlay } from '@dnd-kit/core';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Presentation } from 'lucide-react';
import * as React from 'react';
import { AppHeader } from '@/components/app-header';
import { AsidePanel } from '@/components/aside-panel';
import { ErrorBoundary } from '@/components/error-boundary';
import { MediaPanel } from '@/components/media-panel';
import { MiniPlayer } from '@/components/miniplayer';
import { PresenterControls } from '@/components/presenter-controls';
import { TitleBar } from '@/components/title-bar';
import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import type { FileInfo } from '@/services';
import { useQueueEntriesStore } from '@/stores/queue-entries-store';
import { useQueueStore } from '@/stores/queue-store';

export const Route = createFileRoute('/_layout')({
  component: LayoutComponent,
});

function formatDuration(seconds?: number) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function LayoutComponent() {
  const [savedLayout, setSavedLayout] = React.useState<Record<string, number> | undefined>(() => {
    try {
      const saved = localStorage.getItem('main-layout-panels');
      return saved ? JSON.parse(saved) : undefined;
    } catch {
      return undefined;
    }
  });

  const [dragFile, setDragFile] = React.useState<FileInfo | null>(null);
  const finalCursorY = React.useRef(0);
  const dragCleanup = React.useRef<(() => void) | null>(null);

  function getDropIndex(overY: number): number | null {
    const container = document.querySelector<HTMLElement>('[data-queue-container]');
    if (!container) return null;
    const cr = container.getBoundingClientRect();
    if (overY < cr.top || overY > cr.bottom) return null;
    const items = container.querySelectorAll<HTMLElement>('[data-queue-item]');
    if (items.length === 0) return 0;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (overY <= rect.top + rect.height / 2) return i;
    }
    return items.length;
  }

  return (
    <DndContext
      onDragStart={(event) => {
        const file = event.active.data.current?.file ?? null;
        setDragFile(file);
        useQueueEntriesStore.getState().setDragFileInfo(file);
        finalCursorY.current = 0;
        const onMove = (e: PointerEvent) => {
          const idx = getDropIndex(e.clientY);
          const cur = useQueueEntriesStore.getState().dropTargetIndex;
          if (cur !== idx) useQueueEntriesStore.getState().setDropTargetIndex(idx);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', (e) => { finalCursorY.current = e.clientY; }, { capture: true, once: true });
        dragCleanup.current = () => window.removeEventListener('pointermove', onMove);
      }}
      onDragEnd={(event) => {
        dragCleanup.current?.();
        dragCleanup.current = null;
        setDragFile(null);
        useQueueEntriesStore.getState().setDragFileInfo(null);
        useQueueEntriesStore.getState().setDropTargetIndex(null);
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        if (active.data.current?.type !== 'media-file') return;
        const file = active.data.current?.file as FileInfo | undefined;
        if (!file) return;
        const rawIdx = getDropIndex(finalCursorY.current);
        if (rawIdx !== null && rawIdx >= 0) {
          useQueueEntriesStore.getState().insertFileAtItemIndex(file, rawIdx);
        } else {
          useQueueStore.getState().addToQueue(file);
        }
      }}
      onDragCancel={() => {
        dragCleanup.current?.();
        dragCleanup.current = null;
        setDragFile(null);
        useQueueEntriesStore.getState().setDragFileInfo(null);
        useQueueEntriesStore.getState().setDropTargetIndex(null);
      }}
    >
      <main className="h-dvh flex flex-col">
        <TitleBar />
        <div className="flex flex-col flex-1 gap-3 p-2.5 overflow-hidden">
          <AppHeader />

          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={savedLayout}
            onLayoutChanged={(layout) => {
              localStorage.setItem('main-layout-panels', JSON.stringify(layout));
              setSavedLayout(layout);
            }}
            className="flex-1 overflow-hidden"
          >
            <ResizablePanel id="media" minSize="18%" defaultSize="25%">
              <ErrorBoundary>
                <MediaPanel />
              </ErrorBoundary>
            </ResizablePanel>

            <ResizableHandle className="bg-transparent mx-1.5 w-0" />

            <ResizablePanel id="content" minSize="50%">
              <Card className="w-full h-full gap-3">
                <Outlet />
                <MiniPlayer />
              </Card>
            </ResizablePanel>

            <ResizableHandle className="bg-transparent mx-1.5 w-0" />

            <ResizablePanel id="aside" minSize="18%" defaultSize="25%">
              <AsidePanel />
            </ResizablePanel>
          </ResizablePanelGroup>
          <PresenterControls />
        </div>
      </main>

      <DragOverlay>
        {dragFile && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border shadow-lg min-w-[200px]">
            <Presentation className="size-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight line-clamp-1">
                {dragFile.title || dragFile.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="truncate">
                  {dragFile.artist || dragFile.name.split('.').pop()?.toUpperCase()}
                </span>
              </div>
            </div>
            {dragFile.duration ? (
              <div className="text-xs text-muted-foreground font-medium shrink-0">
                {formatDuration(dragFile.duration)}
              </div>
            ) : null}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
