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
	const viewportWidth = window.innerWidth;

	return (
		<main className="h-dvh p-2.5 flex flex-col gap-3">
			<Header />
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={16} minSize={16} className="">
					<MediaPanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel defaultSize={70} minSize={50}>
					<MiddlePanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel defaultSize={20} minSize={16}>
					<RightPanel />
				</ResizablePanel>
			</ResizablePanelGroup>
		</main>
	);
}
