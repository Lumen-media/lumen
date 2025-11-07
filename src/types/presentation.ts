import type { MediaType } from "./media";

export interface VideoState {
	playing: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	muted: boolean;
	playbackRate?: number;
}

export interface Display {
	id: number;
	name: string;
	width: number;
	height: number;
	isPrimary: boolean;
	scaleFactor?: number;
}

export interface PresentationState {
	mediaId: string;
	mediaType: MediaType;
	currentSlide?: number;
	videoState?: VideoState;
	textContent?: string;
	isPresenting: boolean;
	secondaryWindowId: string | null;
	selectedDisplayId?: number;
}

export type PresentationAction =
	| { type: "START_PRESENTATION"; mediaId: string; displayId?: number }
	| { type: "STOP_PRESENTATION" }
	| { type: "NEXT_SLIDE" }
	| { type: "PREVIOUS_SLIDE" }
	| { type: "GO_TO_SLIDE"; slideIndex: number }
	| { type: "UPDATE_VIDEO_STATE"; videoState: VideoState }
	| { type: "SET_WINDOW_ID"; windowId: string };

export interface MediaWindowConfig {
	label: string;
	url: string;
	fullscreen: boolean;
	decorations: boolean;
	displayId?: number;
	width?: number;
	height?: number;
}

export type NavigationDirection = "next" | "previous" | "first" | "last" | "goto";

export type PresentationMode = "control" | "display";
