import type ReactPlayer from "react-player";
import { create } from "zustand";

interface VideoState {
	isPlaying: boolean;
	currentVideo: {
		id: string;
		title: string;
		url: string;
		thumbnail: string;
		artist: string;
	} | null;
	play: (video: VideoState["currentVideo"]) => void;
	pause: () => void;
	togglePlayPause: () => void;
	setVideo: (video: VideoState["currentVideo"]) => void;
	playerRef: ReactPlayer | null;
	progress: { playedSeconds: number; played: number };
	duration: number;
	setPlayerRef: (ref: ReactPlayer) => void;
	setProgress: (progress: { playedSeconds: number; played: number }) => void;
	setDuration: (duration: number) => void;
}

export const usePlayerStore = create<VideoState>((set) => ({
	isPlaying: false,
	currentVideo: null,
	playerRef: null,
	progress: { playedSeconds: 0, played: 0 },
	duration: 0,
	play: (video) => set({ isPlaying: true, currentVideo: video }),
	pause: () => set({ isPlaying: false }),
	togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
	setVideo: (video) => {
		set({ currentVideo: video, isPlaying: true });
	},
	setPlayerRef: (ref) => set({ playerRef: ref }),
	setProgress: (progress) => set({ progress }),
	setDuration: (duration) => set({ duration }),
}));
