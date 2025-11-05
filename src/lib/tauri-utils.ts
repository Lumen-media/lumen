import { invoke } from "@tauri-apps/api/core";

export async function openVideoWindow(): Promise<void> {
	try {
		await invoke("open_video_window");
	} catch (error) {
		console.error("Error opening video window:", error);
		throw error;
	}
}

/**
 * Creates a new window from the same app instance
 * @param windowLabel - Unique label for the window
 * @param title - Window title
 */
export async function createNewWindow(windowLabel: string, title: string): Promise<void> {
	try {
		await invoke("create_new_window", { windowLabel, title });
	} catch (error) {
		console.error("Error creating new window:", error);
		throw error;
	}
}

export const WindowExamples = {
	createSecondMainWindow: () => createNewWindow("main-2", "Lumen - Window 2"),
	createSettingsWindow: () => createNewWindow("settings", "Lumen - Settings"),
	createPlaylistWindow: () => createNewWindow("playlist", "Lumen - Playlist"),
	openVideoPlayer: () => openVideoWindow(),
};
