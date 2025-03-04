"use client";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import ReactPlayer from "react-player";
import { Button } from "./button";
import { Slider } from "./slider";

export type VideoplayerProps = {
	className?: string;
};

type stateTypes = {
	loaded: number;
	loadedSeconds: number;
	played: number;
	playedSeconds: number;
};

export const Videoplayer = ({ className }: VideoplayerProps) => {
	// const video = "/video.mp4";
	const video = "https://www.youtube.com/watch?v=zajUgQLviwk";
	const playerRef = useRef<ReactPlayer>(null);
	const [playing, setPlaying] = useState(false);
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const [played, setPlayed] = useState(0);
	const [loaded, setLoaded] = useState(0);

	const handlePlayPause = () => {
		setPlaying(!playing);
	};

	const handleVolumeChange = (e: number) => {
		setVolume(e);
	};

	const handleMute = () => {
		setMuted(!muted);
	};

	const handleProgress = (state: stateTypes) => {
		setPlayed(state.played);
		setLoaded(state.loaded);
	};

	const handleSeekChange = (value: number) => {
		if (!playerRef.current) {
			return;
		}
		playerRef.current.seekTo(value);
		setPlayed(value);
	};

	return (
		<div className={cn("relative mx-auto", className)}>
			<div className="w-[1000px] aspect-video h-auto">
				<ReactPlayer
					ref={playerRef}
					url={video}
					playing={playing}
					volume={volume}
					muted={muted}
					onProgress={handleProgress}
					onClick={handlePlayPause}
					onEnded={() => {
						console.log("ended");
					}}
					onPlay={() => setPlaying(true)}
					onPause={() => setPlaying(false)}
					controls={false}
					width="100%"
					height="100%"
				/>
			</div>
			<div className="controls flex flex-col gap-4">
				<Slider
					value={[played]}
					onValueChange={(value) => handleSeekChange(value[0])}
					max={1}
					step={0.01}
				/>
				<div className="flex gap-4">
					<Button onClick={handlePlayPause}>
						{playing ? "Pause" : "Play"}
					</Button>
					<Button onClick={handleMute}>{muted ? "Unmute" : "Mute"}</Button>
					<Slider
						className="w-1/4"
						value={[volume]}
						onValueChange={(value) => handleVolumeChange(value[0])}
						min={0}
						max={1}
						step={0.01}
					/>
				</div>
			</div>
		</div>
	);
};
