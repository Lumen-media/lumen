import { Pause, Play } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { usePlayerStore } from "@/store/playerStore";
import { formatDuration } from "@/lib/utils";

export const PlayerControls = () => {
	const { isPlaying, duration, progress, togglePlayPause, currentVideo } = usePlayerStore();

	return (
		<div className="flex items-center justify-between gap-3 w-full p-3.5 rounded-xl border border-white/10 bg-background/40">
			<div className="size-20 bg-background flex items-center justify-center rounded-sm">
				<img
					src={ currentVideo?.thumbnail || "\photo-placesolder.gif"}
					alt=""
					className="w-10 h-auto aspect-square"
				/>
			</div>
			
			<div className="flex flex-col gap-1 flex-1">
				<div className="flex flex-col">
					<p className="font-bold h-[1lh]">{currentVideo?.title}</p>
					<p className="text-sm h-[1lh] text-muted-foreground">
						{currentVideo?.artist}
					</p>
				</div>

				<Slider />

				<div className="flex justify-between gap-1">
					<p className="text-sm text-muted-foreground">
						{formatDuration(progress.playedSeconds)}
					</p>
					<p className="text-sm text-muted-foreground">
						{formatDuration(duration)}
					</p>
				</div>
			</div>

			<Button onClick={togglePlayPause} className="rounded-full size-12">
				{isPlaying ? <Pause /> : <Play />}
			</Button>
		</div>
	);
};
