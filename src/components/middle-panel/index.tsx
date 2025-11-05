import { Logs, PlayCircle } from "lucide-react";
import { PlayerControls } from "../player-controls";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export const MiddlePanel = () => {
	return (
		<Card className="w-full h-full flex-col">
			<header className="flex gap-2 items-center justify-between">
				<h2 className="w-full text-lg">Presentation</h2>
				<Button variant="secondary">
					<Logs /> Slides
				</Button>
				<Button>
					<PlayCircle /> Start
				</Button>
			</header>

			<div className="flex flex-col flex-1 bg-background rounded-xl">
				<h2 className="text-2xl self-center my-auto">Your Slide Preview</h2>
			</div>

			<PlayerControls />
		</Card>
	);
};
