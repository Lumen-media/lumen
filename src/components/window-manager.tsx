import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WindowExamples } from "@/lib/tauri-utils";

export function WindowManager() {
	const [isLoading, setIsLoading] = useState<string | null>(null);

	const handleWindowAction = async (action: () => Promise<void>, actionName: string) => {
		setIsLoading(actionName);
		try {
			await action();
		} catch (error) {
			console.error(`Error executing ${actionName}:`, error);
		} finally {
			setIsLoading(null);
		}
	};

	return (
		<div className="p-4 space-y-4">
			<h2 className="text-lg font-semibold">Window Manager</h2>
			<p className="text-sm text-muted-foreground">
				This app uses single instance - only one instance can run at a time, but you can open
				multiple windows.
			</p>

			<div className="grid grid-cols-2 gap-2">
				<Button
					onClick={() => handleWindowAction(WindowExamples.createSecondMainWindow, "second-window")}
					disabled={isLoading === "second-window"}
					variant="outline"
				>
					{isLoading === "second-window" ? "Opening..." : "Second Main Window"}
				</Button>

				<Button
					onClick={() => handleWindowAction(WindowExamples.createSettingsWindow, "settings")}
					disabled={isLoading === "settings"}
					variant="outline"
				>
					{isLoading === "settings" ? "Opening..." : "Settings Window"}
				</Button>

				<Button
					onClick={() => handleWindowAction(WindowExamples.createPlaylistWindow, "playlist")}
					disabled={isLoading === "playlist"}
					variant="outline"
				>
					{isLoading === "playlist" ? "Opening..." : "Playlist Window"}
				</Button>

				<Button
					onClick={() => handleWindowAction(WindowExamples.openVideoPlayer, "video-player")}
					disabled={isLoading === "video-player"}
					variant="default"
				>
					{isLoading === "video-player" ? "Opening..." : "Open Video Player"}
				</Button>
			</div>

			<div className="text-xs text-muted-foreground mt-4">
				<p>
					<strong>Single Instance:</strong> If you try to open the app again, it will focus on the
					existing window.
				</p>
				<p>
					<strong>Multiple Windows:</strong> Use the buttons above to create new windows from the
					same instance.
				</p>
			</div>
		</div>
	);
}
