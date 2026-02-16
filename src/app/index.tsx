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

export const Route = createFileRoute("/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { t } = useTranslation();

	const changeLanguage = (lng: string) => {
		i18n.changeLanguage(lng);
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
				</div>
			</Card>
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel className="min-w-[18.75rem]">
					<MediaPanel />
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
