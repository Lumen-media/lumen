import { invoke } from "@tauri-apps/api/core";

export interface FileSelectionResult {
	path: string | null;
	cancelled: boolean;
}

/**
 * Select a PowerPoint file (.pptx or .ppt) using the native file picker
 * @returns FileSelectionResult with the selected file path or cancelled status
 * @throws Error if file validation fails
 */
export async function selectPptxFile(): Promise<FileSelectionResult> {
	return await invoke<FileSelectionResult>("select_pptx_file");
}

/**
 * Select a video file using the native file picker
 * Supported formats: mp4, avi, mov, webm, mkv, flv, wmv
 * @returns FileSelectionResult with the selected file path or cancelled status
 * @throws Error if file validation fails
 */
export async function selectVideoFile(): Promise<FileSelectionResult> {
	return await invoke<FileSelectionResult>("select_video_file");
}

/**
 * Save media database to local JSON file
 * @param data - JSON string containing the media database
 * @throws Error if save operation fails
 */
export async function saveMediaDatabase(data: string): Promise<void> {
	return await invoke<void>("save_media_database", { data });
}

/**
 * Load media database from local JSON file
 * @returns JSON string containing the media database
 * @throws Error if load operation fails or file is corrupted
 */
export async function loadMediaDatabase(): Promise<string> {
	return await invoke<string>("load_media_database");
}
