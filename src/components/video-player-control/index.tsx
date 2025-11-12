import { convertFileSrc } from "@tauri-apps/api/core";
import { Pause, Play, SkipBack, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useCurrentMedia, useMediaStore, useVideoState } from "@/store/mediaStore";
import type { VideoMetadata } from "@/types/media";

interface VideoPlayerControlProps {
	mediaId?: string;
	className?: string;
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds)) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const VideoPlayerControl = ({ mediaId, className = "" }: VideoPlayerControlProps) => {
	const playerRef = useRef<ReactPlayer>(null);
	const videoState = useVideoState();
	const currentMedia = useCurrentMedia();
	const updateVideoState = useMediaStore((state) => state.updateVideoState);
	const getMediaItemById = useMediaStore((state) => state.getMediaItemById);

	const [isSeeking, setIsSeeking] = useState(false);
	const [seekValue, setSeekValue] = useState(0);
	const lastUpdateTimeRef = useRef<number>(0);
	const progressThrottleRef = useRef<number>(0);

	const displayMedia = mediaId ? getMediaItemById(mediaId) : currentMedia;
	const videoMetadata =
		displayMedia?.type === "video" ? (displayMedia.metadata as VideoMetadata) : null;

	const handleProgress = useCallback(
		(state: { playedSeconds: number; played: number }) => {
			if (isSeeking) return;

			const now = Date.now();
			if (now - progressThrottleRef.current < 100) return;

			progressThrottleRef.current = now;

			const currentStateTime = videoState?.currentTime ?? 0;
			if (Math.abs(state.playedSeconds - currentStateTime) > 0.2) {
				updateVideoState({ currentTime: state.playedSeconds });
				lastUpdateTimeRef.current = now;
			}
		},
		[isSeeking, videoState?.currentTime, updateVideoState]
	);

	const handleError = useCallback(
		(error: unknown) => {
			if (!videoMetadata) return;

			console.error("Video playback error:", error);
			let errorMessage = "An error occurred while playing the video.";
			let errorTitle = "Video Playback Error";

			if (error instanceof Error) {
				if (error.message.includes("codec") || error.message.includes("format")) {
					errorTitle = "Unsupported Video Format";
					errorMessage = `The video format "${videoMetadata.format}" is not supported. Please try a different video file (MP4, WebM recommended).`;
				} else if (error.message.includes("network") || error.message.includes("load")) {
					errorTitle = "Failed to Load Video";
					errorMessage =
						"Failed to load video file. Please check if the file exists and is accessible.";
				} else if (error.message.includes("decode")) {
					errorTitle = "Video Decoding Error";
					errorMessage =
						"The video file may be corrupted or use an unsupported codec. Try re-encoding the video.";
				}
			}

			updateVideoState({ playing: false });

			toast.error(errorTitle, {
				description: errorMessage,
			});

			console.error("Video error details:", {
				filePath: videoMetadata.filePath,
				format: videoMetadata.format,
				error: error instanceof Error ? error.message : String(error),
			});
		},
		[videoMetadata, updateVideoState]
	);

	useEffect(() => {
		if (!isSeeking && videoState) {
			setSeekValue(videoState.currentTime);
		}
	}, [videoState, isSeeking]);

	if (!displayMedia || displayMedia.type !== "video" || !videoMetadata) {
		return (
			<div className={`flex items-center justify-center w-full h-full bg-muted ${className}`}>
				<p className="text-muted-foreground">No video selected</p>
			</div>
		);
	}

	const videoUrl = convertFileSrc(videoMetadata.filePath);

	const handlePlayPause = () => {
		updateVideoState({ playing: !videoState?.playing });
	};

	const handleStop = () => {
		updateVideoState({ playing: false, currentTime: 0 });
		if (playerRef.current) {
			playerRef.current.seekTo(0);
		}
	};

	const handleSeekChange = (value: number[]) => {
		const newTime = value[0];
		setSeekValue(newTime);
		setIsSeeking(true);
	};

	const handleSeekCommit = (value: number[]) => {
		const newTime = value[0];
		updateVideoState({ currentTime: newTime });
		if (playerRef.current) {
			playerRef.current.seekTo(newTime, "seconds");
		}
		setIsSeeking(false);
	};

	const handleVolumeChange = (value: number[]) => {
		updateVideoState({ volume: value[0] / 100 });
	};

	const handleMuteToggle = () => {
		updateVideoState({ muted: !videoState?.muted });
	};

	const handleSkipBackward = () => {
		const newTime = Math.max(0, (videoState?.currentTime ?? 0) - 10);
		updateVideoState({ currentTime: newTime });
		if (playerRef.current) {
			playerRef.current.seekTo(newTime, "seconds");
		}
	};

	const handleSkipForward = () => {
		const duration = videoState?.duration ?? 0;
		const newTime = Math.min(duration, (videoState?.currentTime ?? 0) + 10);
		updateVideoState({ currentTime: newTime });
		if (playerRef.current) {
			playerRef.current.seekTo(newTime, "seconds");
		}
	};

	const handlePlaybackRateChange = (value: string) => {
		updateVideoState({ playbackRate: Number.parseFloat(value) });
	};

	const handleDuration = (duration: number) => {
		updateVideoState({ duration });
	};

	const handleEnded = () => {
		updateVideoState({ playing: false, currentTime: 0 });
	};
	const currentTime = isSeeking ? seekValue : (videoState?.currentTime ?? 0);
	const duration = videoState?.duration ?? 0;
	const volume = videoState?.volume ?? 1;
	const muted = videoState?.muted ?? false;
	const playing = videoState?.playing ?? false;
	const playbackRate = videoState?.playbackRate ?? 1;

	return (
		<div className={`flex flex-col gap-4 p-4 bg-background border rounded-lg ${className}`}>
			<div className="relative w-full aspect-video bg-black rounded-md overflow-hidden">
				<ReactPlayer
					ref={playerRef}
					url={videoUrl}
					playing={playing}
					volume={volume}
					muted={muted}
					playbackRate={playbackRate}
					width="100%"
					height="100%"
					controls={false}
					progressInterval={100}
					onProgress={handleProgress}
					onDuration={handleDuration}
					onEnded={handleEnded}
					onError={handleError}
					config={{
						file: {
							attributes: {
								style: {
									width: "100%",
									height: "100%",
									objectFit: "contain",
								},
							},
						},
					}}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<Slider
					value={[currentTime]}
					min={0}
					max={duration || 100}
					step={0.1}
					onValueChange={handleSeekChange}
					onValueCommit={handleSeekCommit}
					className="w-full"
				/>
				<div className="flex justify-between text-xs text-muted-foreground">
					<span>{formatTime(currentTime)}</span>
					<span>{formatTime(duration)}</span>
				</div>
			</div>

			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						onClick={handleSkipBackward}
						title="Skip backward 10s"
					>
						<SkipBack className="size-4" />
					</Button>

					<Button
						variant="default"
						size="icon"
						onClick={handlePlayPause}
						title={playing ? "Pause" : "Play"}
					>
						{playing ? <Pause className="size-4" /> : <Play className="size-4" />}
					</Button>

					<Button variant="outline" size="icon" onClick={handleStop} title="Stop">
						<Square className="size-4" />
					</Button>

					<Button
						variant="outline"
						size="icon"
						onClick={handleSkipForward}
						title="Skip forward 10s"
					>
						<SkipForward className="size-4" />
					</Button>
				</div>

				<div className="flex items-center gap-2 min-w-[150px]">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleMuteToggle}
						title={muted ? "Unmute" : "Mute"}
					>
						{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
					</Button>
					<Slider
						value={[muted ? 0 : volume * 100]}
						min={0}
						max={100}
						step={1}
						onValueChange={handleVolumeChange}
						className="w-24"
					/>
				</div>

				<Select value={playbackRate.toString()} onValueChange={handlePlaybackRateChange}>
					<SelectTrigger className="w-[100px]">
						<SelectValue placeholder="Speed" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="0.25">0.25x</SelectItem>
						<SelectItem value="0.5">0.5x</SelectItem>
						<SelectItem value="0.75">0.75x</SelectItem>
						<SelectItem value="1">1x</SelectItem>
						<SelectItem value="1.25">1.25x</SelectItem>
						<SelectItem value="1.5">1.5x</SelectItem>
						<SelectItem value="1.75">1.75x</SelectItem>
						<SelectItem value="2">2x</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="text-sm text-muted-foreground">
				<p className="font-medium">{displayMedia.title}</p>
				<p className="text-xs">Format: {videoMetadata.format.toUpperCase()}</p>
			</div>
		</div>
	);
};
