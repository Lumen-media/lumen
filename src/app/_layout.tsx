import { DndContext, DragOverlay } from '@dnd-kit/core';
import { createFileRoute, Outlet } from '@tanstack/react-router';
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
import { useQueueStore } from '@/stores/queue-store';

export const Route = createFileRoute('/_layout')({
  component: LayoutComponent,
});

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

  return (
    <DndContext
      onDragStart={(event) => {
        setDragFile(event.active.data.current?.file ?? null);
      }}
      onDragEnd={(event) => {
        setDragFile(null);
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        if (active.data.current?.type === 'media-file') {
          const file = active.data.current?.file as FileInfo | undefined;
          if (file) {
            useQueueStore.getState().addToQueue(file);
          }
        }
      }}
      onDragCancel={() => setDragFile(null)}
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
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border shadow-lg text-sm font-medium">
            {dragFile.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
