import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';
import { AsidePanel } from '@/components/aside-panel';
import { ErrorBoundary } from '@/components/error-boundary';
import { MediaPanel } from '@/components/media-panel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

export const Route = createFileRoute('/_layout')({
  component: LayoutComponent,
});

function LayoutComponent() {
  return (
    <main className="h-dvh flex flex-col gap-3 p-2.5">
      <AppHeader />

      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="main-layout-panels"
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel minSize={18} defaultSize={25}>
          <ErrorBoundary>
            <MediaPanel />
          </ErrorBoundary>
        </ResizablePanel>

        <ResizableHandle className="bg-transparent mx-1.5 w-0" />

        <ResizablePanel minSize={50}>
          <Outlet />
        </ResizablePanel>

        <ResizableHandle className="bg-transparent mx-1.5 w-0" />

        <ResizablePanel minSize={18} defaultSize={25}>
          <AsidePanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
