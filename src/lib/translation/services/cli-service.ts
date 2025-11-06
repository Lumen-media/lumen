import {
	CLI_CONFIG,
	COMMON_LANGUAGES,
	DEFAULT_SOURCE_LANGUAGE,
	LANGUAGE_CODE_PATTERN,
	VALIDATION_LIMITS,
} from "../constants";
import { createValidationError, isTranslationError, ValidationErrorCode } from "../errors";
import type {
	CLIService,
	LanguageProgress,
	TranslationManager,
	TranslationProgress,
} from "../types";

export class CLIServiceImpl implements CLIService {
	private progressCallbacks = new Map<string, (progress: number, details?: string) => void>();

	constructor(private translationManager: TranslationManager) {}

	async addLanguage(languageCode: string, languageName: string): Promise<void> {
		if (!this.validateLanguageCode(languageCode)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Invalid language code format: ${languageCode}. Expected format: 'en' or 'en-US'`
			);
		}

		this.validateLanguageName(languageName);

		const availableLanguages = this.translationManager.getAvailableLanguages();
		if (availableLanguages.includes(languageCode)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Language ${languageCode} already exists`
			);
		}

		try {
			this.showProgress("Adding Language", 0, `Initializing ${languageName} (${languageCode})`);

			await this.translationManager.addNewLanguage(languageCode, languageName);

			this.showProgress(
				"Adding Language",
				100,
				`Successfully added ${languageName} (${languageCode})`
			);

			console.log(`✅ Language ${languageName} (${languageCode}) added successfully!`);
		} catch (error) {
			console.error(`❌ Failed to add language ${languageCode}:`, error);
			throw error;
		}
	}

	async *translateAllKeys(
		sourceLanguage: string,
		targetLanguage: string
	): AsyncGenerator<TranslationProgress, void, unknown> {
		if (!this.validateLanguageCode(sourceLanguage)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Invalid source language code: ${sourceLanguage}`
			);
		}

		if (!this.validateLanguageCode(targetLanguage)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Invalid target language code: ${targetLanguage}`
			);
		}

		try {
			const sourceTranslations = await this.translationManager.loadTranslations(sourceLanguage);
			const keys = Object.keys(sourceTranslations);
			const totalKeys = keys.length;

			if (totalKeys === 0) {
				console.log(`No translations found for source language: ${sourceLanguage}`);
				return;
			}

			console.log(
				`🔄 Starting translation of ${totalKeys} keys from ${sourceLanguage} to ${targetLanguage}`
			);

			const chunkSize = CLI_CONFIG.CHUNK_SIZE;
			let processedKeys = 0;

			for (let i = 0; i < keys.length; i += chunkSize) {
				const chunk = keys.slice(i, i + chunkSize);

				const chunkPromises = chunk.map(async (key) => {
					const sourceText = sourceTranslations[key];

					try {
						await this.translationManager.requestTranslation(key, sourceText, targetLanguage);
						processedKeys++;

						const progress = Math.round((processedKeys / totalKeys) * 100);

						return {
							key,
							progress,
						} as TranslationProgress;
					} catch (error) {
						console.warn(`⚠️  Failed to translate key "${key}":`, error);
						processedKeys++;

						const progress = Math.round((processedKeys / totalKeys) * 100);

						return {
							key,
							progress,
						} as TranslationProgress;
					}
				});

				const chunkResults = await Promise.allSettled(chunkPromises);

				for (const result of chunkResults) {
					if (result.status === "fulfilled") {
						yield result.value;
					}
				}

				if (i + chunkSize < keys.length) {
					await this.delay(CLI_CONFIG.PROGRESS_UPDATE_INTERVAL);
				}
			}

			console.log(
				`✅ Completed translation of ${processedKeys}/${totalKeys} keys to ${targetLanguage}`
			);
		} catch (error) {
			console.error(
				`❌ Failed to translate keys from ${sourceLanguage} to ${targetLanguage}:`,
				error
			);
			throw error;
		}
	}

	async getTranslationProgress(languageCode: string): Promise<LanguageProgress> {
		if (!this.validateLanguageCode(languageCode)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Invalid language code: ${languageCode}`
			);
		}

		try {
			const sourceTranslations =
				await this.translationManager.loadTranslations(DEFAULT_SOURCE_LANGUAGE);
			const total = Object.keys(sourceTranslations).length;

			let translated = 0;
			let pending = 0;

			try {
				const targetTranslations = await this.translationManager.loadTranslations(languageCode);
				translated = Object.keys(targetTranslations).length;

				for (const key of Object.keys(sourceTranslations)) {
					if (this.translationManager.isTranslationPending(key, languageCode)) {
						pending++;
					}
				}
			} catch (error) {
				if (isTranslationError(error)) {
					translated = 0;
					pending = 0;
				} else {
					throw error;
				}
			}

			return {
				total,
				translated,
				pending,
			};
		} catch (error) {
			console.error(`Failed to get translation progress for ${languageCode}:`, error);
			throw error;
		}
	}

	validateLanguageCode(code: string): boolean {
		if (!code || typeof code !== "string") {
			return false;
		}

		if (code.length > VALIDATION_LIMITS.MAX_LANGUAGE_CODE_LENGTH) {
			return false;
		}

		return LANGUAGE_CODE_PATTERN.test(code);
	}

	showProgress(operation: string, progress: number, details?: string): void {
		const clampedProgress = Math.max(0, Math.min(100, progress));

		const barLength = 30;
		const filledLength = Math.round((clampedProgress / 100) * barLength);
		const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

		const progressText = `${operation}: [${bar}] ${clampedProgress}%`;
		const message = details ? `${progressText} - ${details}` : progressText;

		process.stdout.write(`\r${message}`);

		if (clampedProgress === 100) {
			process.stdout.write("\n");
		}

		const callback = this.progressCallbacks.get(operation);
		if (callback) {
			callback(clampedProgress, details);
		}
	}

	// ============================================================================
	// Additional CLI Methods
	// ============================================================================

	onProgress(operation: string, callback: (progress: number, details?: string) => void): void {
		this.progressCallbacks.set(operation, callback);
	}

	offProgress(operation: string): void {
		this.progressCallbacks.delete(operation);
	}

	getCommonLanguages(): Record<string, string> {
		return { ...COMMON_LANGUAGES };
	}

	getSuggestedLanguageName(code: string): string | null {
		return COMMON_LANGUAGES[code as keyof typeof COMMON_LANGUAGES] || null;
	}

	validateAndSuggest(code: string): { valid: boolean; suggestions?: string[] } {
		if (this.validateLanguageCode(code)) {
			return { valid: true };
		}

		const suggestions: string[] = [];
		const lowerCode = code.toLowerCase();

		for (const [validCode, name] of Object.entries(COMMON_LANGUAGES)) {
			if (validCode.toLowerCase() === lowerCode || name.toLowerCase().includes(lowerCode)) {
				suggestions.push(validCode);
			}
		}

		return {
			valid: false,
			suggestions: suggestions.slice(0, 5),
		};
	}

	displayAvailableLanguages(): void {
		const availableLanguages = this.translationManager.getAvailableLanguages();

		console.log("\n📋 Available Languages:");
		console.log("─".repeat(50));

		for (const code of availableLanguages) {
			const name = this.getSuggestedLanguageName(code) || "Unknown";
			const status = code === DEFAULT_SOURCE_LANGUAGE ? "(Source)" : "";
			console.log(`  ${code.padEnd(8)} │ ${name} ${status}`);
		}

		console.log("─".repeat(50));
		console.log(`Total: ${availableLanguages.length} languages\n`);
	}

	async displayTranslationStats(): Promise<void> {
		const availableLanguages = this.translationManager.getAvailableLanguages();

		console.log("\n📊 Translation Statistics:");
		console.log("─".repeat(70));
		console.log(
			"Language".padEnd(12) +
				"│ Total".padEnd(8) +
				"│ Translated".padEnd(12) +
				"│ Pending".padEnd(10) +
				"│ Progress"
		);
		console.log("─".repeat(70));

		for (const code of availableLanguages) {
			try {
				const progress = await this.getTranslationProgress(code);
				const percentage =
					progress.total > 0 ? Math.round((progress.translated / progress.total) * 100) : 0;
				const progressBar = this.createMiniProgressBar(percentage);

				console.log(
					`${code.padEnd(12)}│ ${progress.total.toString().padEnd(6)}│ ${progress.translated.toString().padEnd(10)}│ ${progress.pending.toString().padEnd(8)}│ ${progressBar} ${percentage}%`
				);
			} catch (error) {
				console.log(`${code.padEnd(12)}│ Error loading stats`);
			}
		}

		console.log("─".repeat(70) + "\n");
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

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

		const validNamePattern = /^[a-zA-Z\s\-()]+$/;
		if (!validNamePattern.test(name)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				"Language name contains invalid characters. Only letters, spaces, hyphens, and parentheses are allowed"
			);
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private createMiniProgressBar(percentage: number): string {
		const barLength = 10;
		const filledLength = Math.round((percentage / 100) * barLength);
		return "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
	}
}

// ============================================================================
// Service Instance
// ============================================================================

import { translationManager } from "./translation-manager";

export const cliService = new CLIServiceImpl(translationManager);
