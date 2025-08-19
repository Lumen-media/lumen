import { createFileRoute } from "@tanstack/react-router";
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
			<Card>
				<div className="flex items-center gap-3 font-bold">
					<img className="size-8" src="/logo.png" alt="Lumen logo" />{" "}
					<h3>Lumen</h3>
				</div>
			</Card>
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel className="min-w-[18.75rem]">
					<Card className="w-full h-full">one</Card>
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-[43.75rem]">
					<Card className="w-full h-full">two</Card>
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-[18.75rem]">
					<Card className="w-full h-full">three</Card>
				</ResizablePanel>
			</ResizablePanelGroup>
		</main>
	);
}
