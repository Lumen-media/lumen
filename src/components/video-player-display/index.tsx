import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
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
	const lastSyncTimeRef = useRef<number>(0);
	const isSyncingRef = useRef<boolean>(false);

	const displayMedia = mediaId ? getMediaItemById(mediaId) : currentMedia;
	const videoMetadata =
		displayMedia?.type === "video" ? (displayMedia.metadata as VideoMetadata) : null;

	const handleProgress = useCallback(
		(state: { playedSeconds: number; played: number }) => {
			if (
				!isSyncingRef.current &&
				videoState &&
				Math.abs(state.playedSeconds - videoState.currentTime) > 2
			) {
				updateVideoState({ currentTime: state.playedSeconds });
			}
		},
		[videoState, updateVideoState]
	);

	const handleError = useCallback(
		(error: unknown) => {
			if (!videoMetadata) return;

			console.error("Video playback error on display:", error);

			updateVideoState({ playing: false });

			console.error("Video error details (display):", {
				filePath: videoMetadata.filePath,
				format: videoMetadata.format,
				error: error instanceof Error ? error.message : String(error),
				timestamp: new Date().toISOString(),
			});
		},
		[videoMetadata, updateVideoState]
	);

	useEffect(() => {
		if (!playerRef.current || !videoState || isSyncingRef.current) return;

		const player = playerRef.current;
		const internalPlayer = player.getInternalPlayer();

		if (!internalPlayer) return;

		const currentTime = internalPlayer.currentTime || 0;
		const targetTime = videoState.currentTime;
		const timeDiff = Math.abs(currentTime - targetTime);

		if (timeDiff > 0.3) {
			const now = Date.now();
			if (now - lastSyncTimeRef.current > 50) {
				isSyncingRef.current = true;
				player.seekTo(targetTime, "seconds");
				lastSyncTimeRef.current = now;
				setTimeout(() => {
					isSyncingRef.current = false;
				}, 100);
			}
		}
	}, [videoState]);

	if (!displayMedia || displayMedia.type !== "video" || !videoMetadata) {
		return (
			<div className={`flex items-center justify-center w-full h-full bg-black ${className}`}>
				<p className="text-white text-xl">No video selected</p>
			</div>
		);
	}

	const videoUrl = convertFileSrc(videoMetadata.filePath);

	const handleDuration = (duration: number) => {
		updateVideoState({ duration });
	};

	const handleEnded = () => {
		updateVideoState({ playing: false, currentTime: 0 });
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
