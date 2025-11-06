import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/header";
import { MediaPanel } from "@/components/media-panel";
import { MiddlePanel } from "@/components/middle-panel";
import { RightPanel } from "@/components/right-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export const Route = createFileRoute("/")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<main className="h-dvh p-2.5 flex flex-col gap-3">
			<Header />
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel className="min-w-1/6">
					<MediaPanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="w-2/3 min-w-1/2">
					<MiddlePanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-1/6">
					<RightPanel />
				</ResizablePanel>
			</ResizablePanelGroup>
		</main>
	);
}
