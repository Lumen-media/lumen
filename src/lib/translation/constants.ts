// ============================================================================
// File System Constants
// ============================================================================

export const TRANSLATION_PATHS = {
	LOCALES_DIR: "src/locales",
	TRANSLATION_FILE: "translation.json",
	BACKUP_SUFFIX: ".backup",
	TEMP_SUFFIX: ".tmp",
} as const;

export const SUPPORTED_EXTENSIONS = [".json"] as const;

// ============================================================================
// Language Constants
// ============================================================================

export const DEFAULT_SOURCE_LANGUAGE = "en";

export const LANGUAGE_CODE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export const COMMON_LANGUAGES = {
	en: "English",
	pt: "Português",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	it: "Italiano",
	ja: "日本語",
	ko: "한국어",
	zh: "中文",
	"zh-CN": "中文 (简体)",
	"zh-TW": "中文 (繁體)",
	ru: "Русский",
	ar: "العربية",
	hi: "हिन्दी",
	nl: "Nederlands",
	sv: "Svenska",
	da: "Dansk",
	no: "Norsk",
	fi: "Suomi",
	pl: "Polski",
	cs: "Čeština",
	sk: "Slovenčina",
	hu: "Magyar",
	ro: "Română",
	bg: "Български",
	hr: "Hrvatski",
	sl: "Slovenščina",
	et: "Eesti",
	lv: "Latviešu",
	lt: "Lietuvių",
	uk: "Українська",
	tr: "Türkçe",
	he: "עברית",
	th: "ไทย",
	vi: "Tiếng Việt",
	id: "Bahasa Indonesia",
	ms: "Bahasa Melayu",
	tl: "Filipino",
} as const;

// ============================================================================
// AI Service Constants
// ============================================================================

export const GEMINI_CONFIG = {
	BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
	MODEL: "gemini-2.5-flash",
	TIMEOUT: 30000,
	MAX_RETRIES: 3,
	RATE_LIMIT_RPM: 60,
	RATE_LIMIT_RPD: 1500,
} as const;

export const TRANSLATION_CONFIG = {
	MAX_BATCH_SIZE: 10,
	MAX_TEXT_LENGTH: 5000,
	REQUEST_TIMEOUT: 15000,
	BATCH_DELAY: 1000,
} as const;

// ============================================================================
// Cache Constants
// ============================================================================

export const CACHE_CONFIG = {
	MAX_ENTRIES: 10000,
	MAX_MEMORY_MB: 50,
	TTL_MS: 24 * 60 * 60 * 1000,
	STORAGE_KEY: "ai-translation-cache",
	MAX_STORAGE_MB: 10,
} as const;

export const CACHE_KEYS = {
	TRANSLATION: "translation",
	PENDING: "pending",
	METADATA: "metadata",
} as const;

// ============================================================================
// Translation Key Constants
// ============================================================================

export const TRANSLATION_KEY_PATTERN = /^[a-zA-Z0-9._\s-]+$/;

export const RESERVED_KEY_PREFIXES = ["system.", "internal.", "debug.", "test."] as const;

export const MAX_KEY_DEPTH = 10;

// ============================================================================
// Error Handling Constants
// ============================================================================

export const RETRY_CONFIG = {
	MAX_ATTEMPTS: 3,
	BASE_DELAY_MS: 1000,
	MAX_DELAY_MS: 30000,
	JITTER_FACTOR: 0.1,
} as const;

export const TIMEOUT_CONFIG = {
	FILE_OPERATION_MS: 5000,
	NETWORK_REQUEST_MS: 30000,
	CACHE_OPERATION_MS: 1000,
} as const;

// ============================================================================
// CLI Constants
// ============================================================================

export const CLI_CONFIG = {
	PROGRESS_UPDATE_INTERVAL: 100,
	MAX_CONCURRENT_REQUESTS: 5,
	CHUNK_SIZE: 50,
} as const;

export const CLI_COMMANDS = {
	ADD_LANGUAGE: "add-language",
	TRANSLATE_ALL: "translate-all",
	VALIDATE: "validate",
	SYNC: "sync",
} as const;

// ============================================================================
// Validation Constants
// ============================================================================

export const VALIDATION_LIMITS = {
	MIN_KEY_LENGTH: 1,
	MAX_KEY_LENGTH: 200,
	MIN_TEXT_LENGTH: 1,
	MAX_TEXT_LENGTH: 5000,
	MAX_LANGUAGE_CODE_LENGTH: 10,
	MAX_LANGUAGE_NAME_LENGTH: 100,
} as const;

// ============================================================================
// Performance Constants
// ============================================================================

export const PERFORMANCE_THRESHOLDS = {
	SLOW_TRANSLATION_MS: 5000,
	SLOW_FILE_OPERATION_MS: 2000,
	SLOW_CACHE_OPERATION_MS: 100,
} as const;

// ============================================================================
// Development Constants
// ============================================================================

export const DEV_CONFIG = {
	DEBUG_ENABLED: process.env.NODE_ENV === "development",
	VERBOSE_LOGGING: false,
	MOCK_AI_RESPONSES: false,
	SIMULATE_DELAYS: false,
} as const;

export const ENV_VARS = {
	GEMINI_API_KEY: "VITE_GEMINI_API_KEY",
	DEBUG_TRANSLATION: "VITE_DEBUG_TRANSLATION",
	MOCK_TRANSLATIONS: "VITE_MOCK_TRANSLATIONS",
} as const;
