import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DisplayInfo {
	id: number;
	name: string;
	width: number;
	height: number;
	x: number;
	y: number;
	isPrimary: boolean;
	scaleFactor: number;
}

export interface VideoState {
	playing: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	muted: boolean;
}

export interface PresentationState {
	mediaId: string;
	mediaType: "text" | "video" | "pptx";
	currentSlide?: number;
	videoState?: VideoState;
	textContent?: string;
}

class DualScreenController {
	private stateListeners: Array<(state: PresentationState) => void> = [];
	private unlistenFn: UnlistenFn | null = null;

	async createMediaWindow(displayId?: number): Promise<string> {
		try {
			const windowLabel = await invoke<string>("create_media_window", {
				displayId,
			});
			return windowLabel;
		} catch (error) {
			console.error("Failed to create media window:", error);
			throw new Error(
				`Failed to create media window: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async closeMediaWindow(): Promise<void> {
		try {
			await invoke("close_media_window");
			if (this.unlistenFn) {
				this.unlistenFn();
				this.unlistenFn = null;
			}
		} catch (error) {
			console.error("Failed to close media window:", error);
			throw new Error(
				`Failed to close media window: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async getAvailableDisplays(): Promise<DisplayInfo[]> {
		try {
			const displays = await invoke<DisplayInfo[]>("get_available_displays");
			return displays;
		} catch (error) {
			console.error("Failed to get available displays:", error);
			throw new Error(
				`Failed to get available displays: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async moveWindowToDisplay(windowLabel: string, displayId: number): Promise<void> {
		try {
			await invoke("move_window_to_display", { windowLabel, displayId });
		} catch (error) {
			console.error("Failed to move window to display:", error);
			throw new Error(
				`Failed to move window to display: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async syncPresentationState(state: PresentationState): Promise<void> {
		try {
			await invoke("sync_presentation_state", { state });
		} catch (error) {
			console.error("Failed to sync presentation state:", error);
			throw new Error(
				`Failed to sync presentation state: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	async isMediaWindowOpen(): Promise<boolean> {
		try {
			const isOpen = await invoke<boolean>("is_media_window_open");
			return isOpen;
		} catch (error) {
			console.error("Failed to check media window status:", error);
			return false;
		}
	}

	subscribeToStateChanges(callback: (state: PresentationState) => void): () => void {
		this.stateListeners.push(callback);

		if (!this.unlistenFn) {
			this.setupEventListener();
		}

		return () => {
			const index = this.stateListeners.indexOf(callback);
			if (index > -1) {
				this.stateListeners.splice(index, 1);
			}
		};
	}

	private async setupEventListener(): Promise<void> {
		try {
			this.unlistenFn = await listen<PresentationState>("presentation-state-update", (event) => {
				this.stateListeners.forEach((listener) => {
					try {
						listener(event.payload);
					} catch (error) {
						console.error("Error in state change listener:", error);
					}
				});
			});
		} catch (error) {
			console.error("Failed to set up event listener:", error);
		}
	}

	async cleanup(): Promise<void> {
		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
		}
		this.stateListeners = [];
	}
}

export const dualScreenController = new DualScreenController();
