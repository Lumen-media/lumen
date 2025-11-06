/**
 * AI Auto-Translation System
 *
 * This module provides a comprehensive translation system that integrates with i18next
 * to automatically detect missing translations and generate them using Gemini AI.
 *
 * Key Features:
 * - Automatic detection of missing translation keys
 * - AI-powered translation using Gemini API
 * - File system integration using Tauri APIs
 * - Intelligent caching and rate limiting
 * - CLI tools for language management
 * - Offline support with synchronization
 *
 * @example
 * ```typescript
 * import { TranslationManager } from '@/lib/translation';
 *
 * const manager = new TranslationManagerImpl();
 * await manager.requestTranslation('welcome.message', 'Welcome to our app!');
 * ```
 */

export * from "./constants";
export {
	CACHE_CONFIG,
	CACHE_KEYS,
	CLI_COMMANDS,
	CLI_CONFIG,
	COMMON_LANGUAGES,
	DEFAULT_SOURCE_LANGUAGE,
	DEV_CONFIG,
	ENV_VARS,
	GEMINI_CONFIG,
	LANGUAGE_CODE_PATTERN,
	MAX_KEY_DEPTH,
	PERFORMANCE_THRESHOLDS,
	RESERVED_KEY_PREFIXES,
	RETRY_CONFIG,
	SUPPORTED_EXTENSIONS,
	TIMEOUT_CONFIG,
	TRANSLATION_CONFIG,
	TRANSLATION_KEY_PATTERN,
	TRANSLATION_PATHS,
	VALIDATION_LIMITS,
} from "./constants";
export * from "./errors";

export {
	AIErrorCode,
	AITranslationError,
	CacheError,
	CacheErrorCode,
	ConfigurationError,
	ConfigurationErrorCode,
	createAIError,
	createCacheError,
	createConfigurationError,
	createFileSystemError,
	createValidationError,
	ERROR_MESSAGES,
	ErrorCategory,
	FileSystemError,
	FileSystemErrorCode,
	getRetryDelay,
	isRetryableError,
	isTranslationError,
	// Error classes
	TranslationError,
	ValidationError,
	ValidationErrorCode,
} from "./errors";
export type {
	AITranslationService,
	CacheService,
	CLIService,
	FileSystemService,
	LanguageProgress,
	RateLimitStatus,
	StreamingTranslationResult,
	TranslationEntry,
	TranslationFile,
	TranslationManager,
	TranslationProgress,
	TranslationRequest,
} from "./types";

export * from "./types";
export * from "./utils";

export {
	calculateBackoffDelay,
	cleanSourceText,
	delay,
	extractKeyContext,
	extractLanguageFromPath,
	generateCacheKey,
	generatePendingKey,
	getBackupFilePath,
	getLanguageName,
	getTempFilePath,
	getTranslationFilePath,
	hasInterpolationVariables,
	isReservedTranslationKey,
	isSupportedLanguage,
	isValidLanguageCode,
	isValidSourceText,
	isValidTranslationKey,
	normalizeLanguageCode,
	normalizeTranslationKey,
	parseCacheKey,
	sanitizeTranslationText,
	validateTranslationEntry,
} from "./utils";
