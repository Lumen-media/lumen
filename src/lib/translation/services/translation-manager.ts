import i18next from "i18next";
import {
	CLI_CONFIG,
	DEFAULT_SOURCE_LANGUAGE,
	TRANSLATION_KEY_PATTERN,
	VALIDATION_LIMITS,
} from "../constants";
import {
	ConfigurationErrorCode,
	createConfigurationError,
	createValidationError,
	getRetryDelay,
	isRetryableError,
	isTranslationError,
	ValidationErrorCode,
} from "../errors";
import type {
	AITranslationService,
	CacheService,
	FileSystemService,
	TranslationManager,
	TranslationRequest,
} from "../types";

export class TranslationManagerImpl implements TranslationManager {
	private translationQueue = new Map<string, TranslationRequest>();
	private processingQueue = new Set<string>();
	private availableLanguages: string[] = [];
	private isInitialized = false;

	constructor(
		private aiService: AITranslationService,
		private fileService: FileSystemService,
		private cacheService: CacheService
	) {
		this.initialize();
	}

	async getTranslation(
		key: string,
		language: string,
		variables?: Record<string, unknown>
	): Promise<string> {
		this.validateTranslationKey(key);
		this.validateLanguageCode(language);

		const cached = this.cacheService.getTranslation(key, language);
		if (cached) {
			return this.interpolateVariables(cached, variables);
		}

		try {
			const translations = await this.loadTranslations(language);
			const translation = translations[key];

			if (translation) {
				this.cacheService.setTranslation(key, language, translation);
				return this.interpolateVariables(translation, variables);
			}
		} catch (error) {
			console.warn(`Failed to load translations for ${language}:`, error);
		}

		if (language !== DEFAULT_SOURCE_LANGUAGE) {
			try {
				const sourceTranslation = await this.getTranslation(
					key,
					DEFAULT_SOURCE_LANGUAGE,
					variables
				);
				this.requestTranslation(key, sourceTranslation, language);
				return sourceTranslation;
			} catch (error) {
				console.warn(`Failed to get source translation for ${key}:`, error);
			}
		}

		return this.interpolateVariables(key, variables);
	}

	async requestTranslation(
		key: string,
		sourceText: string,
		targetLanguage?: string
	): Promise<void> {
		this.validateTranslationKey(key);
		this.validateSourceText(sourceText);

		if (targetLanguage) {
			this.validateLanguageCode(targetLanguage);
			await this.queueTranslation(key, sourceText, targetLanguage);
		} else {
			await this.requestTranslationForAllLanguages(key, sourceText);
		}
	}

	async requestTranslationForAllLanguages(key: string, sourceText: string): Promise<void> {
		this.validateTranslationKey(key);
		this.validateSourceText(sourceText);

		await this.ensureInitialized();

		const targetLanguages = this.availableLanguages.filter(
			(lang) => lang !== DEFAULT_SOURCE_LANGUAGE
		);

		const promises = targetLanguages.map((language) =>
			this.queueTranslation(key, sourceText, language)
		);

		await Promise.allSettled(promises);
	}

	isTranslationPending(key: string, language: string): boolean {
		this.validateTranslationKey(key);
		this.validateLanguageCode(language);

		return this.cacheService.isPending(key, language);
	}

	async loadTranslations(language: string): Promise<Record<string, string>> {
		this.validateLanguageCode(language);

		if (this.cacheService.hasLanguage(language)) {
			return this.cacheService.getAllTranslations(language);
		}

		try {
			const translations = await this.fileService.readTranslationFile(language);

			for (const [key, value] of Object.entries(translations)) {
				this.cacheService.setTranslation(key, language, value);
			}

			return translations;
		} catch (error) {
			if (isTranslationError(error)) {
				throw error;
			}
			throw createConfigurationError(
				ConfigurationErrorCode.INVALID_FILE_PATH,
				`Failed to load translations for language: ${language}`,
				error as Error
			);
		}
	}

	getAvailableLanguages(): string[] {
		return [...this.availableLanguages];
	}

	async reloadAllResources(): Promise<void> {
		try {
			await i18next.reloadResources();
		} catch (error) {
			console.warn("Failed to reload all i18next resources:", error);
		}
	}

	async initializeI18nextIntegration(): Promise<void> {
		try {
			// Ensure all available languages are loaded into i18next
			for (const language of this.availableLanguages) {
				try {
					const translations = await this.loadTranslations(language);

					// Add all translations to i18next resources
					for (const [key, value] of Object.entries(translations)) {
						i18next.addResource(language, "translation", key, value);
					}
				} catch (error) {
					console.warn(`Failed to load translations for ${language} during initialization:`, error);
				}
			}

			// Reload resources to ensure everything is up to date
			await this.reloadAllResources();
		} catch (error) {
			console.warn("Failed to initialize i18next integration:", error);
		}
	}

	async addNewLanguage(languageCode: string, languageName: string): Promise<void> {
		this.validateLanguageCode(languageCode);
		this.validateLanguageName(languageName);

		if (this.availableLanguages.includes(languageCode)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Language ${languageCode} already exists`
			);
		}

		try {
			await this.fileService.copyTranslationStructure(DEFAULT_SOURCE_LANGUAGE, languageCode);

			this.availableLanguages.push(languageCode);
			this.availableLanguages.sort();

			const sourceTranslations = await this.loadTranslations(DEFAULT_SOURCE_LANGUAGE);

			const entries = Object.entries(sourceTranslations);
			const chunkSize = CLI_CONFIG.CHUNK_SIZE;

			for (let i = 0; i < entries.length; i += chunkSize) {
				const chunk = entries.slice(i, i + chunkSize);
				const promises = chunk.map(([key, sourceText]) =>
					this.queueTranslation(key, sourceText, languageCode)
				);

				await Promise.allSettled(promises);

				if (i + chunkSize < entries.length) {
					await this.delay(1000);
				}
			}
		} catch (error) {
			this.availableLanguages = this.availableLanguages.filter((lang) => lang !== languageCode);

			if (isTranslationError(error)) {
				throw error;
			}
			throw createConfigurationError(
				ConfigurationErrorCode.INVALID_LANGUAGE_CONFIG,
				`Failed to add new language: ${languageCode}`,
				error as Error
			);
		}
	}

	handleMissingKey(lng: string, ns: string, key: string, fallbackValue: string): void {
		try {
			if (!key || !lng) {
				return;
			}

			if (this.isTranslationPending(key, lng)) {
				return;
			}

			const existing = this.cacheService.getTranslation(key, lng);
			if (existing) {
				return;
			}

			const sourceText = fallbackValue || key;

			if (lng !== DEFAULT_SOURCE_LANGUAGE) {
				this.queueTranslation(key, sourceText, lng).catch((error) => {
					console.warn(`Failed to queue translation for missing key ${key} -> ${lng}:`, error);
				});
			} else {
				this.cacheService.setTranslation(key, lng, sourceText);
				this.saveTranslationToFile(key, lng, sourceText).catch((error) => {
					console.warn(`Failed to save source translation for ${key}:`, error);
				});
			}
		} catch (error) {
			console.warn(`Error handling missing key ${key}:`, error);
		}
	}

	parseKeyContext(key: string): string {
		try {
			if (!key || typeof key !== "string") {
				return "General application text";
			}

			const parts = key.split(".");

			if (parts.length > 1) {
				const namespace = parts.slice(0, -1).join(".");

				const contextMap: Record<string, string> = {
					nav: "Navigation menu",
					button: "Button or action element",
					form: "Form field or validation",
					error: "Error message",
					success: "Success message",
					modal: "Modal dialog",
					tooltip: "Tooltip or help text",
					placeholder: "Input placeholder text",
					label: "Form label",
					title: "Page or section title",
					description: "Description text",
					player: "Media player interface",
					controls: "Control interface",
					panel: "UI panel or section",
				};

				for (const [pattern, context] of Object.entries(contextMap)) {
					if (namespace.toLowerCase().includes(pattern)) {
						return `${context} in the ${namespace} section`;
					}
				}

				return `${namespace} section of the application`;
			}

			return "General application text";
		} catch (error) {
			console.warn(`Error parsing key context for ${key}:`, error);
			return "General application text";
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			await this.fileService.ensureTranslationDirectory();

			this.availableLanguages = await this.fileService.getAvailableLanguages();

			if (!this.availableLanguages.includes(DEFAULT_SOURCE_LANGUAGE)) {
				this.availableLanguages.unshift(DEFAULT_SOURCE_LANGUAGE);
			}

			await this.initializeI18nextIntegration();

			this.isInitialized = true;
		} catch (error) {
			console.error("Failed to initialize Translation Manager:", error);
			this.availableLanguages = [DEFAULT_SOURCE_LANGUAGE];
			this.isInitialized = true;
		}
	}

	private async ensureInitialized(): Promise<void> {
		if (!this.isInitialized) {
			await this.initialize();
		}
	}

	private async queueTranslation(
		key: string,
		sourceText: string,
		targetLanguage: string
	): Promise<void> {
		const queueKey = `${key}:${targetLanguage}`;

		if (this.processingQueue.has(queueKey) || this.cacheService.isPending(key, targetLanguage)) {
			return;
		}

		const existing = this.cacheService.getTranslation(key, targetLanguage);
		if (existing) {
			return;
		}

		const request: TranslationRequest = {
			key,
			sourceText,
			targetLanguage,
			context: this.parseKeyContext(key),
			priority: "normal",
			retryCount: 0,
		};

		this.translationQueue.set(queueKey, request);
		this.cacheService.setPending(key, targetLanguage);

		if (this.aiService.isOnline()) {
			this.processTranslationQueue().catch((error) => {
				console.warn("Error processing translation queue:", error);
			});
		}
	}

	private async processTranslationQueue(): Promise<void> {
		const pendingRequests = Array.from(this.translationQueue.entries());

		if (pendingRequests.length === 0) {
			return;
		}

		const batchSize = Math.min(CLI_CONFIG.MAX_CONCURRENT_REQUESTS, pendingRequests.length);

		for (let i = 0; i < pendingRequests.length; i += batchSize) {
			const batch = pendingRequests.slice(i, i + batchSize);

			const promises = batch.map(([queueKey, request]) =>
				this.processTranslationRequest(queueKey, request)
			);

			await Promise.allSettled(promises);

			if (i + batchSize < pendingRequests.length) {
				await this.delay(1000);
			}
		}
	}

	private async processTranslationRequest(
		queueKey: string,
		request: TranslationRequest
	): Promise<void> {
		if (this.processingQueue.has(queueKey)) {
			return;
		}

		this.processingQueue.add(queueKey);

		try {
			const translation = await this.aiService.translateText(
				request.sourceText,
				request.targetLanguage,
				request.context
			);

			this.cacheService.setTranslation(request.key, request.targetLanguage, translation);

			await this.saveTranslationToFile(request.key, request.targetLanguage, translation);

			this.translationQueue.delete(queueKey);
			this.cacheService.removePending(request.key, request.targetLanguage);
		} catch (error) {
			await this.handleTranslationError(queueKey, request, error as Error);
		} finally {
			this.processingQueue.delete(queueKey);
		}
	}

	private async handleTranslationError(
		queueKey: string,
		request: TranslationRequest,
		error: Error
	): Promise<void> {
		request.retryCount++;
		request.lastAttempt = new Date();

		const maxRetries = 3;

		if (request.retryCount >= maxRetries || !isRetryableError(error as any)) {
			this.translationQueue.delete(queueKey);
			this.cacheService.removePending(request.key, request.targetLanguage);

			console.error(`Translation failed for ${request.key} -> ${request.targetLanguage}:`, error);
			return;
		}

		const delay = getRetryDelay(error as any, request.retryCount);

		setTimeout(() => {
			this.processTranslationRequest(queueKey, request).catch((retryError) => {
				console.warn(`Retry failed for ${queueKey}:`, retryError);
			});
		}, delay);
	}

	private async saveTranslationToFile(
		key: string,
		language: string,
		translation: string
	): Promise<void> {
		try {
			const existingTranslations = await this.loadTranslations(language);

			existingTranslations[key] = translation;

			await this.fileService.writeTranslationFile(language, existingTranslations);

			await this.reloadI18nextResources(language, key, translation);
		} catch (error) {
			console.error(`Failed to save translation to file for ${key} -> ${language}:`, error);
		}
	}

	private async reloadI18nextResources(
		language: string,
		key: string,
		translation: string
	): Promise<void> {
		try {
			i18next.addResource(language, "translation", key, translation);

			if (i18next.language === language) {
				await i18next.reloadResources();
			}
		} catch (error) {
			console.warn(`Failed to reload i18next resources for ${language}:`, error);
		}
	}

	private interpolateVariables(text: string, variables?: Record<string, unknown>): string {
		if (!variables || Object.keys(variables).length === 0) {
			return text;
		}

		return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
			const value = variables[key];
			return value !== undefined ? String(value) : match;
		});
	}

	private validateTranslationKey(key: string): void {
		if (!key || typeof key !== "string") {
			throw createValidationError(
				ValidationErrorCode.INVALID_TRANSLATION_KEY,
				"Translation key must be a non-empty string"
			);
		}

		if (
			key.length < VALIDATION_LIMITS.MIN_KEY_LENGTH ||
			key.length > VALIDATION_LIMITS.MAX_KEY_LENGTH
		) {
			throw createValidationError(
				ValidationErrorCode.INVALID_TRANSLATION_KEY,
				`Translation key length must be between ${VALIDATION_LIMITS.MIN_KEY_LENGTH} and ${VALIDATION_LIMITS.MAX_KEY_LENGTH} characters`
			);
		}

		if (!TRANSLATION_KEY_PATTERN.test(key)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_TRANSLATION_KEY,
				"Translation key contains invalid characters. Only letters, numbers, dots, underscores, and hyphens are allowed"
			);
		}
	}

	private validateLanguageCode(language: string): void {
		if (!language || typeof language !== "string") {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				"Language code must be a non-empty string"
			);
		}

		if (language.length > VALIDATION_LIMITS.MAX_LANGUAGE_CODE_LENGTH) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Language code too long: ${language.length} characters (max: ${VALIDATION_LIMITS.MAX_LANGUAGE_CODE_LENGTH})`
			);
		}
	}

	private validateSourceText(text: string): void {
		if (!text || typeof text !== "string") {
			throw createValidationError(
				ValidationErrorCode.EMPTY_SOURCE_TEXT,
				"Source text must be a non-empty string"
			);
		}

		if (
			text.length < VALIDATION_LIMITS.MIN_TEXT_LENGTH ||
			text.length > VALIDATION_LIMITS.MAX_TEXT_LENGTH
		) {
			throw createValidationError(
				ValidationErrorCode.INVALID_TRANSLATION_FORMAT,
				`Source text length must be between ${VALIDATION_LIMITS.MIN_TEXT_LENGTH} and ${VALIDATION_LIMITS.MAX_TEXT_LENGTH} characters`
			);
		}
	}

	private validateLanguageName(name: string): void {
		if (!name || typeof name !== "string") {
			throw createValidationError(
				ValidationErrorCode.MISSING_REQUIRED_FIELD,
				"Language name must be a non-empty string"
			);
		}

		if (name.length > VALIDATION_LIMITS.MAX_LANGUAGE_NAME_LENGTH) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Language name too long: ${name.length} characters (max: ${VALIDATION_LIMITS.MAX_LANGUAGE_NAME_LENGTH})`
			);
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// ============================================================================
// Service Instance
// ============================================================================

import { aiTranslationService } from "./ai-translation-service";
import { cacheService } from "./cache-service";
import { fileSystemService } from "./file-system-service";

export const translationManager = new TranslationManagerImpl(
	aiTranslationService,
	fileSystemService,
	cacheService
);
