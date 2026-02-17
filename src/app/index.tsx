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
import { useMediaInit } from "@/hooks/use-media-init";
import { ErrorBoundary } from "@/components/error-boundary";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { t } = useTranslation();
	const { isInitialized, error } = useMediaInit();

	const changeLanguage = (lng: string) => {
		i18n.changeLanguage(lng);
	};

	const openSecondWindow = async () => {
		console.log("Botão clicado - tentando abrir segunda janela");
		try {
			const { invoke } = await import('@tauri-apps/api/core');

			await invoke('create_window', {
				label: 'second-window',
				title: 'Lumen - Segunda Janela',
				url: '/',
				width: 800,
				height: 600
			});
			
			toast.success("Segunda janela criada com sucesso!");
		} catch (error) {
			console.error("Erro ao criar segunda janela (método 1):", error);
			toast.error("Erro ao criar segunda janela. Verifique o console para mais detalhes.");
			
			try {
				console.log("Tentando método alternativo com WebviewWindow...");
				const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
				console.log("WebviewWindow importada com sucesso");
				
				const webview = new WebviewWindow("second-window", {
					url: "/",
					title: "Lumen - Segunda Janela",
					width: 800,
					height: 600,
					minWidth: 400,
					minHeight: 400,
					center: true,
					decorations: true,
				});

				webview.once("tauri://created", () => {
					console.log("Segunda janela criada com sucesso!");
					toast.success("Segunda janela criada com sucesso!");
				});

				webview.once("tauri://error", (e) => {
					console.error("Erro na criação da janela:", e);
					toast.error("Erro ao criar segunda janela.");
				});
			} catch (error2) {
				console.error("Erro ao criar segunda janela (método 2):", error2);
				toast.error("Falha ao criar segunda janela. Verifique as permissões do aplicativo.");
			}
		}
	};

	if (!isInitialized && !error) {
		return (
			<main className="h-dvh p-2.5 flex items-center justify-center">
				<Card className="p-6">
					<div className="flex flex-col items-center gap-3">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
						<p className="text-sm text-muted-foreground">
							{t("Initializing media folders...")}
						</p>
					</div>
				</Card>
			</main>
		);
	}

	if (error) {
		return (
			<main className="h-dvh p-2.5 flex items-center justify-center">
				<Card className="p-6 max-w-md">
					<div className="flex flex-col gap-3">
						<h3 className="font-bold text-destructive">
							{t("Initialization Error")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t("Failed to initialize media folders. Please check app permissions.")}
						</p>
						<p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
							{error.message}
						</p>
					</div>
				</Card>
			</main>
		);
	}

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
					<Button onClick={openSecondWindow} variant="outline" title="Abre uma nova janela com a mesma interface">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
							<line x1="3" y1="9" x2="21" y2="9" />
							<line x1="9" y1="21" x2="9" y2="9" />
						</svg>
						Abrir Segunda Janela
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
