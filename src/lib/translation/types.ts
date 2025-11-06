// ============================================================================
// Core Data Models
// ============================================================================

export interface TranslationEntry {
	key: string;
	sourceText: string;
	translatedText: string;
	language: string;
	createdAt: Date;
	source: "manual" | "ai" | "imported";
}

export interface TranslationRequest {
	key: string;
	sourceText: string;
	targetLanguage: string;
	context?: string;
	priority: "high" | "normal" | "low";
	retryCount: number;
	lastAttempt?: Date;
}

export interface TranslationFile {
	[key: string]: string | TranslationFile;
}

export interface TranslationProgress {
	key: string;
	progress: number;
}

export interface LanguageProgress {
	total: number;
	translated: number;
	pending: number;
}

export interface RateLimitStatus {
	remaining: number;
	resetTime: Date;
}

export interface StreamingTranslationResult {
	language: string;
	translation: string;
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface TranslationManager {
	/**
	 * Get translation for a specific key and language
	 * @param key - Translation key
	 * @param language - Target language code
	 * @param variables - Optional variables for interpolation
	 * @returns Promise resolving to translated text
	 */
	getTranslation(
		key: string,
		language: string,
		variables?: Record<string, unknown>
	): Promise<string>;

	/**
	 * Request translation for a specific key and target language
	 * @param key - Translation key
	 * @param sourceText - Source text to translate
	 * @param targetLanguage - Target language code (optional, defaults to all configured languages)
	 */
	requestTranslation(key: string, sourceText: string, targetLanguage?: string): Promise<void>;

	/**
	 * Request translation for all configured languages
	 * @param key - Translation key
	 * @param sourceText - Source text to translate
	 */
	requestTranslationForAllLanguages(key: string, sourceText: string): Promise<void>;

	/**
	 * Check if a translation is currently being processed
	 * @param key - Translation key
	 * @param language - Target language code
	 * @returns True if translation is pending
	 */
	isTranslationPending(key: string, language: string): boolean;

	/**
	 * Load all translations for a specific language
	 * @param language - Language code
	 * @returns Promise resolving to translation object
	 */
	loadTranslations(language: string): Promise<Record<string, string>>;

	/**
	 * Get list of all available/configured languages
	 * @returns Array of language codes
	 */
	getAvailableLanguages(): string[];

	/**
	 * Add a new language with automatic translation of existing keys
	 * @param languageCode - ISO language code
	 * @param languageName - Human-readable language name
	 */
	addNewLanguage(languageCode: string, languageName: string): Promise<void>;

	/**
	 * Handle missing key detected by i18next
	 * @param lng - Language code
	 * @param ns - Namespace
	 * @param key - Translation key
	 * @param fallbackValue - Fallback value
	 */
	handleMissingKey(lng: string, ns: string, key: string, fallbackValue: string): void;

	/**
	 * Parse key context for better translation quality
	 * @param key - Translation key
	 * @returns Parsed context information
	 */
	parseKeyContext(key: string): string;
}

export interface AITranslationService {
	/**
	 * Translate a single text to target language
	 * @param text - Text to translate
	 * @param targetLanguage - Target language code
	 * @param context - Optional context for better translation
	 * @returns Promise resolving to translated text
	 */
	translateText(text: string, targetLanguage: string, context?: string): Promise<string>;

	/**
	 * Translate multiple texts in batch for efficiency
	 * @param texts - Array of texts to translate
	 * @param targetLanguage - Target language code
	 * @param context - Optional context for better translation
	 * @returns Promise resolving to array of translated texts
	 */
	translateBatch(texts: string[], targetLanguage: string, context?: string): Promise<string[]>;

	/**
	 * Translate text to all specified languages using streaming
	 * @param text - Text to translate
	 * @param languages - Array of target language codes
	 * @param context - Optional context for better translation
	 * @returns AsyncGenerator yielding translation results
	 */
	translateToAllLanguages(
		text: string,
		languages: string[],
		context?: string
	): AsyncGenerator<StreamingTranslationResult, void, unknown>;

	/**
	 * Check if the service is online and can make API calls
	 * @returns True if online
	 */
	isOnline(): boolean;

	/**
	 * Set the Gemini API key
	 * @param key - API key
	 */
	setApiKey(key: string): void;

	/**
	 * Get current rate limit status
	 * @returns Rate limit information
	 */
	getRateLimitStatus(): RateLimitStatus;
}

export interface FileSystemService {
	/**
	 * Read translation file for a specific language
	 * @param language - Language code
	 * @returns Promise resolving to translation object
	 */
	readTranslationFile(language: string): Promise<Record<string, string>>;

	/**
	 * Write translation file for a specific language
	 * @param language - Language code
	 * @param translations - Translation object to write
	 */
	writeTranslationFile(language: string, translations: Record<string, string>): Promise<void>;

	/**
	 * Create backup of translation file
	 * @param language - Language code
	 */
	backupTranslationFile(language: string): Promise<void>;

	/**
	 * Restore translation file from backup
	 * @param language - Language code
	 */
	restoreTranslationFile(language: string): Promise<void>;

	/**
	 * Ensure translation directory structure exists
	 */
	ensureTranslationDirectory(): Promise<void>;

	/**
	 * Create directory structure for a new language
	 * @param languageCode - Language code
	 */
	createLanguageDirectory(languageCode: string): Promise<void>;

	/**
	 * Get list of available languages from file system
	 * @returns Promise resolving to array of language codes
	 */
	getAvailableLanguages(): Promise<string[]>;

	/**
	 * Copy translation structure from source to target language
	 * @param sourceLanguage - Source language code
	 * @param targetLanguage - Target language code
	 */
	copyTranslationStructure(sourceLanguage: string, targetLanguage: string): Promise<void>;
}

export interface CacheService {
	/**
	 * Get cached translation
	 * @param key - Translation key
	 * @param language - Language code
	 * @returns Cached translation or null if not found
	 */
	getTranslation(key: string, language: string): string | null;

	/**
	 * Set translation in cache
	 * @param key - Translation key
	 * @param language - Language code
	 * @param value - Translation value
	 */
	setTranslation(key: string, language: string, value: string): void;

	/**
	 * Check if translation is pending
	 * @param key - Translation key
	 * @param language - Language code
	 * @returns True if pending
	 */
	isPending(key: string, language: string): boolean;

	/**
	 * Mark translation as pending
	 * @param key - Translation key
	 * @param language - Language code
	 */
	setPending(key: string, language: string): void;

	/**
	 * Remove pending status
	 * @param key - Translation key
	 * @param language - Language code
	 */
	removePending(key: string, language: string): void;

	/**
	 * Clear all cached data
	 */
	clearCache(): void;

	/**
	 * Get all cached translations for a language
	 * @param language - Language code
	 * @returns Object with all cached translations
	 */
	getAllTranslations(language: string): Record<string, string>;

	/**
	 * Check if cache has translations for a language
	 * @param language - Language code
	 * @returns True if cache has translations for the language
	 */
	hasLanguage(language: string): boolean;
}

export interface CLIService {
	/**
	 * Add a new language with automatic translation
	 * @param languageCode - ISO language code
	 * @param languageName - Human-readable language name
	 */
	addLanguage(languageCode: string, languageName: string): Promise<void>;

	/**
	 * Translate all existing keys to a target language with streaming progress
	 * @param sourceLanguage - Source language code
	 * @param targetLanguage - Target language code
	 * @returns AsyncGenerator yielding progress updates
	 */
	translateAllKeys(
		sourceLanguage: string,
		targetLanguage: string
	): AsyncGenerator<TranslationProgress, void, unknown>;

	/**
	 * Get translation progress for a language
	 * @param languageCode - Language code
	 * @returns Promise resolving to progress information
	 */
	getTranslationProgress(languageCode: string): Promise<LanguageProgress>;

	/**
	 * Validate language code format
	 * @param code - Language code to validate
	 * @returns True if valid
	 */
	validateLanguageCode(code: string): boolean;

	/**
	 * Show real-time progress during translation operations
	 * @param operation - Operation name
	 * @param progress - Progress percentage (0-100)
	 * @param details - Optional details message
	 */
	showProgress(operation: string, progress: number, details?: string): void;
}
