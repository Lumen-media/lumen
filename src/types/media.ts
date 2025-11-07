export type MediaType = "text" | "video" | "pptx";

export interface TextSlideMetadata {
	content: string;
	fontSize: number;
	fontColor: string;
	backgroundColor: string;
	alignment: "left" | "center" | "right";
}

export interface VideoMetadata {
	filePath: string;
	duration: number;
	thumbnail?: string;
	format: string;
}

export type ConversionStatus = "pending" | "converting" | "completed" | "failed";

export interface PptxMetadata {
	filePath: string;
	pdfBytes?: Uint8Array;
	slideCount: number;
	conversionStatus: ConversionStatus;
	conversionError?: string;
}

export type MediaMetadata = TextSlideMetadata | VideoMetadata | PptxMetadata;

export interface MediaItem {
	id: string;
	type: MediaType;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	metadata: MediaMetadata;
}

export function isTextSlideMetadata(metadata: MediaMetadata): metadata is TextSlideMetadata {
	return "content" in metadata && "fontSize" in metadata;
}

export function isVideoMetadata(metadata: MediaMetadata): metadata is VideoMetadata {
	return "filePath" in metadata && "duration" in metadata && "format" in metadata;
}

export function isPptxMetadata(metadata: MediaMetadata): metadata is PptxMetadata {
	return "filePath" in metadata && "slideCount" in metadata && "conversionStatus" in metadata;
}
