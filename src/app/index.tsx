import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import i18n from "@/i18n";
import { MediaPanel } from "@/components/media-panel";
import { PreviewPanel } from "@/components/preview-panel";
import { AsidePanel } from "@/components/aside-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { t } = useTranslation();

	const changeLanguage = (lng: string) => {
		i18n.changeLanguage(lng);
	};

	const openSecondWindow = async () => {
		try {
			const { invoke } = await import('@tauri-apps/api/core');

			await invoke('create_window', {
				label: 'media-window',
				title: 'Lumen - Second Window'
			});
			
			toast.success("Second window created successfully.");
		} catch (error) {
			toast.error("Failed to create second window. Check the console for details.");
			
			try {
				const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
				
				const webview = new WebviewWindow("media-window", {
					url: "/media-window",
					title: "Lumen - Second Window",
					fullscreen: true,
					decorations: false
				});

				webview.once("tauri://created", () => {
					toast.success("Second window created successfully.");
				});

				webview.once("tauri://error", (e) => {
					toast.error("Error creating second window.");
				});
			} catch (error2) {
				toast.error("Unable to create second window. Check application permissions.");
			}
		}
	};
	
	return (
		<main className="h-dvh p-2.5 flex flex-col gap-3">
			<Card>
				<div className="flex items-center gap-3 font-bold">
					<img className="size-8" src="/logo.png" alt="Lumen logo" />{" "}
					<h3>{t("welcome")}</h3>
				</div>
				<div className="flex gap-2 mt-2">
					<Button onClick={() => changeLanguage("en")}>English</Button>
					<Button onClick={() => changeLanguage("pt")}>Português</Button>
					<Button onClick={openSecondWindow} variant="outline" title="Open a new window with the same interface">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
							<line x1="3" y1="9" x2="21" y2="9" />
							<line x1="9" y1="21" x2="9" y2="9" />
						</svg>
						Open Second Window
					</Button>
				</div>
			</Card>
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel className="min-w-[18.75rem]">
					<ErrorBoundary>
						<MediaPanel />
					</ErrorBoundary>
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-[43.75rem]">
					<PreviewPanel />
				</ResizablePanel>

				<ResizableHandle className="bg-transparent mx-1.5 w-0" />

				<ResizablePanel className="min-w-[18.75rem]">
					<AsidePanel />
				</ResizablePanel>
			</ResizablePanelGroup>
		</main>
	);
}
