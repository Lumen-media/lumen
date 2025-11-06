import {
	COMMON_LANGUAGES,
	LANGUAGE_CODE_PATTERN,
	RESERVED_KEY_PREFIXES,
	TRANSLATION_KEY_PATTERN,
	VALIDATION_LIMITS,
} from "./constants";
import { createValidationError, ValidationErrorCode } from "./errors";

// ============================================================================
// Language Utilities
// ============================================================================

/**
 * Validate language code format
 * @param code - Language code to validate
 * @returns True if valid
 */
export function isValidLanguageCode(code: string): boolean {
	if (!code || typeof code !== "string") {
		return false;
	}

	return (
		code.length <= VALIDATION_LIMITS.MAX_LANGUAGE_CODE_LENGTH && LANGUAGE_CODE_PATTERN.test(code)
	);
}

/**
 * Get language name from code
 * @param code - Language code
 * @returns Language name or the code if not found
 */
export function getLanguageName(code: string): string {
	return COMMON_LANGUAGES[code as keyof typeof COMMON_LANGUAGES] || code;
}

/**
 * Normalize language code to lowercase with proper format
 * @param code - Language code to normalize
 * @returns Normalized language code
 */
export function normalizeLanguageCode(code: string): string {
	if (!code) return "";

	const normalized = code.toLowerCase().replace("_", "-");

	if (!isValidLanguageCode(normalized)) {
		throw createValidationError(
			ValidationErrorCode.INVALID_LANGUAGE_CODE,
			`Invalid language code format: ${code}`
		);
	}

	return normalized;
}

/**
 * Check if language code is supported
 * @param code - Language code to check
 * @returns True if supported
 */
export function isSupportedLanguage(code: string): boolean {
	const normalized = normalizeLanguageCode(code);
	return normalized in COMMON_LANGUAGES;
}

// ============================================================================
// Translation Key Utilities
// ============================================================================

/**
 * Validate translation key format
 * @param key - Translation key to validate
 * @returns True if valid
 */
export function isValidTranslationKey(key: string): boolean {
	if (!key || typeof key !== "string") {
		return false;
	}

	return (
		key.length >= VALIDATION_LIMITS.MIN_KEY_LENGTH &&
		key.length <= VALIDATION_LIMITS.MAX_KEY_LENGTH &&
		TRANSLATION_KEY_PATTERN.test(key)
	);
}

/**
 * Check if translation key is reserved (should not be auto-translated)
 * @param key - Translation key to check
 * @returns True if reserved
 */
export function isReservedTranslationKey(key: string): boolean {
	return RESERVED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Normalize translation key
 * @param key - Translation key to normalize
 * @returns Normalized key
 */
export function normalizeTranslationKey(key: string): string {
	if (!key) return "";

	const normalized = key.trim().replace(/\.+/g, ".");

	if (!isValidTranslationKey(normalized)) {
		throw createValidationError(
			ValidationErrorCode.INVALID_TRANSLATION_KEY,
			`Invalid translation key format: ${key}`
		);
	}

	return normalized;
}

/**
 * Extract context from translation key
 * @param key - Translation key
 * @returns Context information for better translation
 */
export function extractKeyContext(key: string): string {
	const parts = key.split(".");
	const contexts: string[] = [];

	if (parts.length > 1) {
		contexts.push(`Section: ${parts[0]}`);
	}

	const lastPart = parts[parts.length - 1];
	if (lastPart.includes("button")) {
		contexts.push("UI Element: Button");
	} else if (lastPart.includes("title") || lastPart.includes("heading")) {
		contexts.push("UI Element: Title/Heading");
	} else if (lastPart.includes("message") || lastPart.includes("text")) {
		contexts.push("UI Element: Message/Text");
	} else if (lastPart.includes("error")) {
		contexts.push("UI Element: Error Message");
	} else if (lastPart.includes("success")) {
		contexts.push("UI Element: Success Message");
	} else if (lastPart.includes("placeholder")) {
		contexts.push("UI Element: Input Placeholder");
	} else if (lastPart.includes("label")) {
		contexts.push("UI Element: Form Label");
	}

	return contexts.length > 0 ? contexts.join(", ") : "General UI text";
}

// ============================================================================
// Text Utilities
// ============================================================================

/**
 * Validate source text for translation
 * @param text - Source text to validate
 * @returns True if valid
 */
export function isValidSourceText(text: string): boolean {
	if (!text || typeof text !== "string") {
		return false;
	}

	const trimmed = text.trim();
	return (
		trimmed.length >= VALIDATION_LIMITS.MIN_TEXT_LENGTH &&
		trimmed.length <= VALIDATION_LIMITS.MAX_TEXT_LENGTH
	);
}

/**
 * Clean and normalize source text for translation
 * @param text - Source text to clean
 * @returns Cleaned text
 */
export function cleanSourceText(text: string): string {
	if (!text) return "";

	const cleaned = text.trim().replace(/\s+/g, " ").replace(/\r\n/g, "\n");

	if (!isValidSourceText(cleaned)) {
		throw createValidationError(
			ValidationErrorCode.EMPTY_SOURCE_TEXT,
			"Source text is empty or invalid after cleaning"
		);
	}

	return cleaned;
}

/**
 * Check if text contains interpolation variables
 * @param text - Text to check
 * @returns True if contains variables
 */
export function hasInterpolationVariables(text: string): boolean {
	const patterns = [/\{\{[^}]+\}\}/g, /\{[^}]+\}/g, /\$t\([^)]+\)/g, /%[sd%]/g];

	return patterns.some((pattern) => pattern.test(text));
}

// ============================================================================
// File Path Utilities
// ============================================================================

/**
 * Generate translation file path for a language
 * @param language - Language code
 * @param baseDir - Base directory (optional)
 * @returns File path
 */
export function getTranslationFilePath(language: string, baseDir = "src/locales"): string {
	const normalizedLang = normalizeLanguageCode(language);
	return `${baseDir}/${normalizedLang}/translation.json`;
}

/**
 * Generate backup file path
 * @param originalPath - Original file path
 * @returns Backup file path
 */
export function getBackupFilePath(originalPath: string): string {
	return `${originalPath}.backup`;
}

/**
 * Generate temporary file path
 * @param originalPath - Original file path
 * @returns Temporary file path
 */
export function getTempFilePath(originalPath: string): string {
	const timestamp = Date.now();
	return `${originalPath}.tmp.${timestamp}`;
}

/**
 * Extract language code from file path
 * @param filePath - File path
 * @returns Language code or null if not found
 */
export function extractLanguageFromPath(filePath: string): string | null {
	const match = filePath.match(/\/([a-z]{2}(?:-[A-Z]{2})?)\/translation\.json$/);
	return match ? match[1] : null;
}

// ============================================================================
// Cache Key Utilities
// ============================================================================

/**
 * Generate cache key for translation
 * @param key - Translation key
 * @param language - Language code
 * @returns Cache key
 */
export function generateCacheKey(key: string, language: string): string {
	return `translation:${language}:${key}`;
}

/**
 * Generate cache key for pending translation
 * @param key - Translation key
 * @param language - Language code
 * @returns Cache key
 */
export function generatePendingKey(key: string, language: string): string {
	return `pending:${language}:${key}`;
}

/**
 * Parse cache key to extract components
 * @param cacheKey - Cache key to parse
 * @returns Parsed components or null if invalid
 */
export function parseCacheKey(
	cacheKey: string
): { type: string; language: string; key: string } | null {
	const parts = cacheKey.split(":");
	if (parts.length < 3) return null;

	const [type, language, ...keyParts] = parts;
	return {
		type,
		language,
		key: keyParts.join(":"),
	};
}

// ============================================================================
// Retry Utilities
// ============================================================================

/**
 * Calculate exponential backoff delay
 * @param attempt - Attempt number (1-based)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @param jitterFactor - Jitter factor (0-1)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
	attempt: number,
	baseDelay = 1000,
	maxDelay = 30000,
	jitterFactor = 0.1
): number {
	const exponentialDelay = baseDelay * 2 ** (attempt - 1);
	const cappedDelay = Math.min(exponentialDelay, maxDelay);
	const jitter = Math.random() * jitterFactor * cappedDelay;

	return Math.floor(cappedDelay + jitter);
}

/**
 * Create a delay promise
 * @param ms - Delay in milliseconds
 * @returns Promise that resolves after delay
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate translation entry
 * @param entry - Translation entry to validate
 * @throws ValidationError if invalid
 */
export function validateTranslationEntry(entry: unknown): void {
	if (!entry || typeof entry !== "object") {
		throw createValidationError(
			ValidationErrorCode.MISSING_REQUIRED_FIELD,
			"Translation entry must be an object"
		);
	}

	const typedEntry = entry as Record<string, unknown>;

	if (!isValidTranslationKey(typedEntry.key as string)) {
		throw createValidationError(
			ValidationErrorCode.INVALID_TRANSLATION_KEY,
			`Invalid translation key: ${typedEntry.key}`
		);
	}

	if (!isValidSourceText(typedEntry.sourceText as string)) {
		throw createValidationError(
			ValidationErrorCode.EMPTY_SOURCE_TEXT,
			"Source text is required and must be valid"
		);
	}

	if (!isValidLanguageCode(typedEntry.language as string)) {
		throw createValidationError(
			ValidationErrorCode.INVALID_LANGUAGE_CODE,
			`Invalid language code: ${typedEntry.language}`
		);
	}
}

/**
 * Sanitize translation text to prevent XSS
 * @param text - Text to sanitize
 * @returns Sanitized text
 */
export function sanitizeTranslationText(text: string): string {
	if (!text) return "";

	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}
