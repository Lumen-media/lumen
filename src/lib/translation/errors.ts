// ============================================================================
// Error Classes
// ============================================================================

export abstract class TranslationError extends Error {
	abstract readonly code: string;
	abstract readonly category: ErrorCategory;

	constructor(
		message: string,
		public readonly cause?: Error
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

export class AITranslationError extends TranslationError {
	readonly category = ErrorCategory.AI_SERVICE;

	constructor(
		message: string,
		public readonly code: AIErrorCode,
		cause?: Error
	) {
		super(message, cause);
	}
}

export class FileSystemError extends TranslationError {
	readonly category = ErrorCategory.FILE_SYSTEM;

	constructor(
		message: string,
		public readonly code: FileSystemErrorCode,
		cause?: Error
	) {
		super(message, cause);
	}
}

export class CacheError extends TranslationError {
	readonly category = ErrorCategory.CACHE;

	constructor(
		message: string,
		public readonly code: CacheErrorCode,
		cause?: Error
	) {
		super(message, cause);
	}
}

export class ValidationError extends TranslationError {
	readonly category = ErrorCategory.VALIDATION;

	constructor(
		message: string,
		public readonly code: ValidationErrorCode,
		cause?: Error
	) {
		super(message, cause);
	}
}

export class ConfigurationError extends TranslationError {
	readonly category = ErrorCategory.CONFIGURATION;

	constructor(
		message: string,
		public readonly code: ConfigurationErrorCode,
		cause?: Error
	) {
		super(message, cause);
	}
}

// ============================================================================
// Error Categories and Codes
// ============================================================================

export enum ErrorCategory {
	AI_SERVICE = "AI_SERVICE",
	FILE_SYSTEM = "FILE_SYSTEM",
	CACHE = "CACHE",
	VALIDATION = "VALIDATION",
	CONFIGURATION = "CONFIGURATION",
}

export enum AIErrorCode {
	NETWORK_ERROR = "AI_NETWORK_ERROR",
	API_KEY_INVALID = "AI_API_KEY_INVALID",
	API_KEY_MISSING = "AI_API_KEY_MISSING",
	RATE_LIMIT_EXCEEDED = "AI_RATE_LIMIT_EXCEEDED",
	INVALID_RESPONSE = "AI_INVALID_RESPONSE",
	TRANSLATION_FAILED = "AI_TRANSLATION_FAILED",
	TIMEOUT = "AI_TIMEOUT",
	QUOTA_EXCEEDED = "AI_QUOTA_EXCEEDED",
	SERVICE_UNAVAILABLE = "AI_SERVICE_UNAVAILABLE",
}

export enum FileSystemErrorCode {
	FILE_NOT_FOUND = "FS_FILE_NOT_FOUND",
	PERMISSION_DENIED = "FS_PERMISSION_DENIED",
	DISK_FULL = "FS_DISK_FULL",
	INVALID_PATH = "FS_INVALID_PATH",
	CORRUPTION_DETECTED = "FS_CORRUPTION_DETECTED",
	BACKUP_FAILED = "FS_BACKUP_FAILED",
	RESTORE_FAILED = "FS_RESTORE_FAILED",
	WRITE_FAILED = "FS_WRITE_FAILED",
	READ_FAILED = "FS_READ_FAILED",
	DIRECTORY_CREATION_FAILED = "FS_DIRECTORY_CREATION_FAILED",
}

export enum CacheErrorCode {
	MEMORY_LIMIT_EXCEEDED = "CACHE_MEMORY_LIMIT_EXCEEDED",
	INVALID_KEY = "CACHE_INVALID_KEY",
	CORRUPTION_DETECTED = "CACHE_CORRUPTION_DETECTED",
	EVICTION_FAILED = "CACHE_EVICTION_FAILED",
}

export enum ValidationErrorCode {
	INVALID_LANGUAGE_CODE = "VALIDATION_INVALID_LANGUAGE_CODE",
	INVALID_TRANSLATION_KEY = "VALIDATION_INVALID_TRANSLATION_KEY",
	EMPTY_SOURCE_TEXT = "VALIDATION_EMPTY_SOURCE_TEXT",
	INVALID_TRANSLATION_FORMAT = "VALIDATION_INVALID_TRANSLATION_FORMAT",
	MISSING_REQUIRED_FIELD = "VALIDATION_MISSING_REQUIRED_FIELD",
}

export enum ConfigurationErrorCode {
	MISSING_API_KEY = "CONFIG_MISSING_API_KEY",
	INVALID_LANGUAGE_CONFIG = "CONFIG_INVALID_LANGUAGE_CONFIG",
	MISSING_SOURCE_LANGUAGE = "CONFIG_MISSING_SOURCE_LANGUAGE",
	INVALID_FILE_PATH = "CONFIG_INVALID_FILE_PATH",
}

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
	[AIErrorCode.NETWORK_ERROR]: "Network error occurred while connecting to AI service",
	[AIErrorCode.API_KEY_INVALID]: "Invalid API key provided for AI service",
	[AIErrorCode.API_KEY_MISSING]: "API key is required but not configured",
	[AIErrorCode.RATE_LIMIT_EXCEEDED]: "AI service rate limit exceeded, please try again later",
	[AIErrorCode.INVALID_RESPONSE]: "AI service returned an invalid response",
	[AIErrorCode.TRANSLATION_FAILED]: "Translation request failed",
	[AIErrorCode.TIMEOUT]: "AI service request timed out",
	[AIErrorCode.QUOTA_EXCEEDED]: "AI service quota exceeded",
	[AIErrorCode.SERVICE_UNAVAILABLE]: "AI service is currently unavailable",

	[FileSystemErrorCode.FILE_NOT_FOUND]: "Translation file not found",
	[FileSystemErrorCode.PERMISSION_DENIED]: "Permission denied accessing translation files",
	[FileSystemErrorCode.DISK_FULL]: "Insufficient disk space for translation files",
	[FileSystemErrorCode.INVALID_PATH]: "Invalid file path specified",
	[FileSystemErrorCode.CORRUPTION_DETECTED]: "Translation file corruption detected",
	[FileSystemErrorCode.BACKUP_FAILED]: "Failed to create backup of translation file",
	[FileSystemErrorCode.RESTORE_FAILED]: "Failed to restore translation file from backup",
	[FileSystemErrorCode.WRITE_FAILED]: "Failed to write translation file",
	[FileSystemErrorCode.READ_FAILED]: "Failed to read translation file",
	[FileSystemErrorCode.DIRECTORY_CREATION_FAILED]: "Failed to create translation directory",

	[CacheErrorCode.MEMORY_LIMIT_EXCEEDED]: "Cache memory limit exceeded",
	[CacheErrorCode.INVALID_KEY]: "Invalid cache key provided",
	[CacheErrorCode.CORRUPTION_DETECTED]: "Cache corruption detected",
	[CacheErrorCode.EVICTION_FAILED]: "Failed to evict items from cache",

	[ValidationErrorCode.INVALID_LANGUAGE_CODE]: "Invalid language code format",
	[ValidationErrorCode.INVALID_TRANSLATION_KEY]: "Invalid translation key format",
	[ValidationErrorCode.EMPTY_SOURCE_TEXT]: "Source text cannot be empty",
	[ValidationErrorCode.INVALID_TRANSLATION_FORMAT]: "Invalid translation format",
	[ValidationErrorCode.MISSING_REQUIRED_FIELD]: "Required field is missing",

	[ConfigurationErrorCode.MISSING_API_KEY]: "API key configuration is missing",
	[ConfigurationErrorCode.INVALID_LANGUAGE_CONFIG]: "Invalid language configuration",
	[ConfigurationErrorCode.MISSING_SOURCE_LANGUAGE]: "Source language not configured",
	[ConfigurationErrorCode.INVALID_FILE_PATH]: "Invalid translation file path configuration",
} as const;

// ============================================================================
// Error Utilities
// ============================================================================

export function createAIError(
	code: AIErrorCode,
	details?: string,
	cause?: Error
): AITranslationError {
	const message = details ? `${ERROR_MESSAGES[code]}: ${details}` : ERROR_MESSAGES[code];
	return new AITranslationError(message, code, cause);
}

export function createFileSystemError(
	code: FileSystemErrorCode,
	details?: string,
	cause?: Error
): FileSystemError {
	const message = details ? `${ERROR_MESSAGES[code]}: ${details}` : ERROR_MESSAGES[code];
	return new FileSystemError(message, code, cause);
}

export function createCacheError(
	code: CacheErrorCode,
	details?: string,
	cause?: Error
): CacheError {
	const message = details ? `${ERROR_MESSAGES[code]}: ${details}` : ERROR_MESSAGES[code];
	return new CacheError(message, code, cause);
}

export function createValidationError(
	code: ValidationErrorCode,
	details?: string,
	cause?: Error
): ValidationError {
	const message = details ? `${ERROR_MESSAGES[code]}: ${details}` : ERROR_MESSAGES[code];
	return new ValidationError(message, code, cause);
}

export function createConfigurationError(
	code: ConfigurationErrorCode,
	details?: string,
	cause?: Error
): ConfigurationError {
	const message = details ? `${ERROR_MESSAGES[code]}: ${details}` : ERROR_MESSAGES[code];
	return new ConfigurationError(message, code, cause);
}

export function isTranslationError(error: unknown): error is TranslationError {
	return error instanceof TranslationError;
}

export function isRetryableError(error: TranslationError): boolean {
	const retryableCodes = [
		AIErrorCode.NETWORK_ERROR,
		AIErrorCode.TIMEOUT,
		AIErrorCode.SERVICE_UNAVAILABLE,
		AIErrorCode.RATE_LIMIT_EXCEEDED,
	];

	return error instanceof AITranslationError && retryableCodes.includes(error.code);
}

export function getRetryDelay(error: TranslationError, attemptCount: number): number {
	if (!isRetryableError(error)) {
		return 0;
	}

	const baseDelay = 1000;
	const maxDelay = 30000;
	const delay = Math.min(baseDelay * 2 ** (attemptCount - 1), maxDelay);

	const jitter = Math.random() * 0.1 * delay;
	return delay + jitter;
}
