"use client";
import { useRef, useState } from "react";
import ReactPlayer from "react-player";

export type VideoplayerProps = {
	className?: string;
};

export const Videoplayer = ({ className }) => {
	// const video = "/video.mp4";
	const video = "https://www.youtube.com/watch?v=xF-f8ZcU2uM";
	const playerRef = useRef(null);
	const [playing, setPlaying] = useState(false);
	const [volume, setVolume] = useState(0.8);
	const [muted, setMuted] = useState(false);
	const [played, setPlayed] = useState(0);
	const [loaded, setLoaded] = useState(0);

	const handlePlayPause = () => {
		setPlaying(!playing);
	};

	const handleVolumeChange = (e) => {
		setVolume(Number.parseFloat(e.target.value));
	};

	const handleMute = () => {
		setMuted(!muted);
	};

	const handleProgress = (state) => {
		setPlayed(state.played);
		setLoaded(state.loaded);
	};

	const handleSeekChange = (e) => {
		setPlayed(Number.parseFloat(e.target.value));
		if (!playerRef.current) {
			return;
		}
		playerRef.current.seekTo(Number.parseFloat(e.target.value));
	};

	return (
		<div>
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
			/>
			<div className="controls">
				<input
					className="w-full"
					type="range"
					min={0}
					max={1}
					step="any"
					value={played}
					onChange={handleSeekChange}
				/>
				<button onClick={handlePlayPause}>{playing ? "Pause" : "Play"}</button>
				<button onClick={handleMute}>{muted ? "Unmute" : "Mute"}</button>
				<input
					type="range"
					min={0}
					max={1}
					step="any"
					value={volume}
					onChange={handleVolumeChange}
				/>
			</div>
		</div>
	);
};
