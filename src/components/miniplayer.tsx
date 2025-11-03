import { LucidePause, LucidePlay } from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Slider } from "./ui/slider";

const formatTime = (seconds: number) => {
	if (isNaN(seconds)) {
		return "00:00";
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	return `${minutes < 10 ? "0" : ""}${minutes}:${
		remainingSeconds < 10 ? "0" : ""
	}${remainingSeconds}`;
};

export const Miniplayer = () => {
	const { currentVideo, isPlaying, togglePlayPause, progress, duration } =
		usePlayerStore();

	const [localSliderValue, setLocalSliderValue] = useState(0);
	const [isSeeking, setIsSeeking] = useState(false);

	useEffect(() => {
		if (!isSeeking) {
			setLocalSliderValue(progress.played * 100);
		}
	}, [progress.played, isSeeking]);

	if (!currentVideo) {
		return null;
	}

	return (
		<Card className="flex-row justify-between items-center gap-4">
			<img
				className="size-16 object-cover rounded-xl border"
				src={currentVideo.thumbnail}
				alt={currentVideo.title}
			/>
			<div className="flex flex-col flex-1">
				<h3 className="text-base min-h-[1lh] font-bold leading-normal">
					{currentVideo.title}
				</h3>
				<p className="text-sm mb-1 min-h-[1lh] text-gray-600 dark:text-gray-300">
					{currentVideo.artist}
				</p>

				<div className="flex flex-col gap-1">
					<Slider
						value={[localSliderValue]}
						max={100}
						step={0.1}
						onValueChange={(value) => {
							setIsSeeking(true);
							setLocalSliderValue(value[0]);
						}}
						onValueCommit={(value) => {
							const playerRef = usePlayerStore.getState().playerRef;
							if (playerRef) {
								playerRef.seekTo(value[0] / 100);
							}
							setIsSeeking(false);
						}}
					/>
					<div className="flex justify-between text-xs">
						<span>{formatTime(progress.playedSeconds)}</span>
						<span>{formatTime(duration)}</span>
					</div>
				</div>
			</div>
			<Button
				className="aspect-square h-10/12 rounded-full items-center justify-center px-0 py-0 leading-0"
				onClick={togglePlayPause}
			>
				{isPlaying ? (
					<LucidePause className="size-5" />
				) : (
					<LucidePlay className="size-5" />
				)}
			</Button>
		</Card>
	);
};
