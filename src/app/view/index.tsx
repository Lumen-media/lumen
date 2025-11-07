import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/header";
import { MediaPanel } from "@/components/media-panel";
import { RightPanel } from "@/components/right-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ViewMiddlePanel } from "@/components/view-middle-panel";

export const Route = createFileRoute("/view/")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<main className="h-dvh p-2.5 flex flex-col gap-3">
			<Header />
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={15} minSize={15}>
					<MediaPanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel defaultSize={60} minSize={50}>
					<ViewMiddlePanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel defaultSize={25} minSize={15}>
					<RightPanel />
				</ResizablePanel>
			</ResizablePanelGroup>
		</main>
	);
}
