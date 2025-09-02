import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/header";
import { RightPanel } from "@/components/right-panel";
import { Card } from "@/components/ui/card";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";

export const Route = createFileRoute("/")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<main className="h-dvh p-2.5 flex flex-col gap-3">
			<Header />
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel className="min-w-1/6">
					<Card className="w-full h-full">one</Card>
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-1/2">
					<Card className="w-full h-full">two</Card>
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-1/6">
					<RightPanel />
				</ResizablePanel>
			</ResizablePanelGroup>
		</main>
	);
}
