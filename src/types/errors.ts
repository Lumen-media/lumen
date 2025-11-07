export type ErrorCategory = "FILE_SYSTEM" | "CONVERSION" | "DISPLAY" | "PLAYBACK" | "UNKNOWN";

export enum ErrorCode {
	FS_FILE_NOT_FOUND = "FS_001",
	FS_PERMISSION_DENIED = "FS_002",
	FS_INVALID_FORMAT = "FS_003",
	FS_DISK_SPACE_INSUFFICIENT = "FS_004",
	FS_READ_ERROR = "FS_005",
	FS_WRITE_ERROR = "FS_006",

	CONV_FAILED = "CONV_001",
	CONV_CORRUPTED_FILE = "CONV_002",
	CONV_SDK_INIT_FAILED = "CONV_003",
	CONV_OUT_OF_MEMORY = "CONV_004",
	CONV_UNSUPPORTED_FEATURE = "CONV_005",
	CONV_TIMEOUT = "CONV_006",

	DISP_NOT_AVAILABLE = "DISP_001",
	DISP_WINDOW_CREATION_FAILED = "DISP_002",
	DISP_RENDERING_ERROR = "DISP_003",
	DISP_SYNC_FAILED = "DISP_004",

	PLAY_CODEC_NOT_SUPPORTED = "PLAY_001",
	PLAY_AUDIO_DEVICE_UNAVAILABLE = "PLAY_002",
	PLAY_SYNC_FAILED = "PLAY_003",
	PLAY_STREAM_ERROR = "PLAY_004",

	UNKNOWN_ERROR = "UNKNOWN_001",
}

export interface AppError {
	code: ErrorCode;
	category: ErrorCategory;
	message: string;
	details?: string;
	recoverable: boolean;
	suggestedAction?: string;
	timestamp: Date;
}

export function createFileSystemError(
	code: ErrorCode,
	message: string,
	details?: string,
	suggestedAction?: string
): AppError {
	return {
		code,
		category: "FILE_SYSTEM",
		message,
		details,
		recoverable: code !== ErrorCode.FS_PERMISSION_DENIED,
		suggestedAction,
		timestamp: new Date(),
	};
}

export function createConversionError(
	code: ErrorCode,
	message: string,
	details?: string,
	suggestedAction?: string
): AppError {
	return {
		code,
		category: "CONVERSION",
		message,
		details,
		recoverable: code === ErrorCode.CONV_TIMEOUT || code === ErrorCode.CONV_FAILED,
		suggestedAction,
		timestamp: new Date(),
	};
}

export function createDisplayError(
	code: ErrorCode,
	message: string,
	details?: string,
	suggestedAction?: string
): AppError {
	return {
		code,
		category: "DISPLAY",
		message,
		details,
		recoverable: code !== ErrorCode.DISP_NOT_AVAILABLE,
		suggestedAction,
		timestamp: new Date(),
	};
}

export function createPlaybackError(
	code: ErrorCode,
	message: string,
	details?: string,
	suggestedAction?: string
): AppError {
	return {
		code,
		category: "PLAYBACK",
		message,
		details,
		recoverable: code !== ErrorCode.PLAY_CODEC_NOT_SUPPORTED,
		suggestedAction,
		timestamp: new Date(),
	};
}

export function getErrorMessage(error: AppError): string {
	const baseMessage = error.message;
	const suggestion = error.suggestedAction ? ` ${error.suggestedAction}` : "";
	return `${baseMessage}${suggestion}`;
}

export function isRecoverableError(error: AppError): boolean {
	return error.recoverable;
}
