import * as React from 'react';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';
import { AsidePanel } from '@/components/aside-panel';
import { ErrorBoundary } from '@/components/error-boundary';
import { MediaPanel } from '@/components/media-panel';
import { MiniPlayer } from '@/components/miniplayer';
import { TitleBar } from '@/components/title-bar';
import { Card } from '@/components/ui/card';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

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

  return (
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
        <ResizablePanel id="media" minSize={18} defaultSize={25}>
          <ErrorBoundary>
            <MediaPanel />
          </ErrorBoundary>
        </ResizablePanel>

        <ResizableHandle className="bg-transparent mx-1.5 w-0" />

        <ResizablePanel id="content" minSize={50}>
          <Card className="w-full h-full gap-3">
            <Outlet />
            <MiniPlayer />
          </Card>
        </ResizablePanel>

        <ResizableHandle className="bg-transparent mx-1.5 w-0" />

        <ResizablePanel id="aside" minSize={18} defaultSize={25}>
          <AsidePanel />
        </ResizablePanel>
      </ResizablePanelGroup>
      </div>
    </main>
  );
}
