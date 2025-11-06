import { Logs, PlayCircle } from "lucide-react";
import { PlayerControls } from "../player-controls";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export const MiddlePanel = () => {
	return (
		<Card className="w-full h-full flex-col">
			<header className="flex gap-2 items-center justify-between">
				<div className="flex items-center gap-2">
					<h2 className="text-lg">Presentation</h2>
				</div>

				<div className="flex gap-2">
					<Button variant="secondary">
						<Logs /> Slides
					</Button>
					<Button>
						<PlayCircle /> Start
					</Button>
				</div>
			</header>

			<div className="flex flex-col flex-1 bg-background rounded-xl">
				<div className="flex flex-col items-center justify-center h-full gap-4">
					<h2 className="text-2xl">your slide preview</h2>
				</div>
			</div>

			<PlayerControls />
		</Card>
	);
};
