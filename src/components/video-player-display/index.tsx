import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import ReactPlayer from "react-player";
import { useCurrentMedia, useMediaStore, useVideoState } from "@/store/mediaStore";
import type { VideoMetadata } from "@/types/media";

interface VideoPlayerDisplayProps {
	mediaId?: string;
	className?: string;
}

export const VideoPlayerDisplay = ({ mediaId, className = "" }: VideoPlayerDisplayProps) => {
	const playerRef = useRef<ReactPlayer>(null);
	const videoState = useVideoState();
	const currentMedia = useCurrentMedia();
	const updateVideoState = useMediaStore((state) => state.updateVideoState);
	const getMediaItemById = useMediaStore((state) => state.getMediaItemById);

	const displayMedia = mediaId ? getMediaItemById(mediaId) : currentMedia;

	useEffect(() => {
		if (!playerRef.current || !videoState) return;

		const player = playerRef.current;
		const internalPlayer = player.getInternalPlayer();

		if (internalPlayer && Math.abs(internalPlayer.currentTime - videoState.currentTime) > 0.5) {
			player.seekTo(videoState.currentTime, "seconds");
		}
	}, [videoState]);

	if (!displayMedia || displayMedia.type !== "video") {
		return (
			<div className={`flex items-center justify-center w-full h-full bg-black ${className}`}>
				<p className="text-white text-xl">No video selected</p>
			</div>
		);
	}

	const videoMetadata = displayMedia.metadata as VideoMetadata;
	const videoUrl = convertFileSrc(videoMetadata.filePath);

	const handleProgress = (state: { playedSeconds: number; played: number }) => {
		if (videoState && Math.abs(state.playedSeconds - videoState.currentTime) > 1) {
			updateVideoState({ currentTime: state.playedSeconds });
		}
	};

	const handleDuration = (duration: number) => {
		updateVideoState({ duration });
	};

	const handleEnded = () => {
		updateVideoState({ playing: false, currentTime: 0 });
	};

	const handleError = (error: unknown) => {
		console.error("Video playback error:", error);

		let errorMessage = "An error occurred while playing the video.";

		if (error instanceof Error) {
			if (error.message.includes("codec") || error.message.includes("format")) {
				errorMessage = `Video format not supported: ${videoMetadata.format}. Please try a different video file.`;
			} else if (error.message.includes("network") || error.message.includes("load")) {
				errorMessage =
					"Failed to load video file. Please check if the file exists and is accessible.";
			}
		}

		updateVideoState({ playing: false });

		console.error("Video error details:", {
			filePath: videoMetadata.filePath,
			format: videoMetadata.format,
			error: error instanceof Error ? error.message : String(error),
		});
	};

	return (
		<div className={`relative w-full h-full bg-black ${className}`}>
			<ReactPlayer
				ref={playerRef}
				url={videoUrl}
				playing={videoState?.playing ?? false}
				volume={videoState?.volume ?? 1}
				muted={videoState?.muted ?? false}
				playbackRate={videoState?.playbackRate ?? 1}
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
	);
};
