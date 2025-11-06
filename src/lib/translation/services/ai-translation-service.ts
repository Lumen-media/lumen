import {
	COMMON_LANGUAGES,
	DEFAULT_SOURCE_LANGUAGE,
	ENV_VARS,
	GEMINI_CONFIG,
	RETRY_CONFIG,
	TRANSLATION_CONFIG,
} from "../constants";
import {
	AIErrorCode,
	type AITranslationError,
	createAIError,
	createValidationError,
	ValidationErrorCode,
} from "../errors";
import type { AITranslationService, RateLimitStatus, StreamingTranslationResult } from "../types";

export class GeminiTranslationService implements AITranslationService {
	private apiKey: string;
	private rateLimitStatus: RateLimitStatus;

	private lastRequestTime = 0;
	private requestCount = 0;
	private dailyRequestCount = 0;
	private lastResetTime = Date.now();

	constructor(apiKey?: string) {
		this.apiKey = apiKey || import.meta.env[ENV_VARS.GEMINI_API_KEY] || "";
		this.rateLimitStatus = {
			remaining: GEMINI_CONFIG.RATE_LIMIT_RPM,
			resetTime: new Date(Date.now() + 60 * 1000),
		};

		this.scheduleReset();
	}

	setApiKey(key: string): void {
		this.apiKey = key;
	}

	isOnline(): boolean {
		return navigator.onLine && !!this.apiKey;
	}

	getRateLimitStatus(): RateLimitStatus {
		return { ...this.rateLimitStatus };
	}

	async translateText(text: string, targetLanguage: string, context?: string): Promise<string> {
		this.validateInput(text, targetLanguage);

		if (!this.isOnline()) {
			throw createAIError(
				AIErrorCode.API_KEY_MISSING,
				"Service is offline or API key is not configured"
			);
		}

		const prompt = this.buildPrompt(text, targetLanguage, context);
		const response = await this.makeRequest(prompt);

		return this.extractTranslation(response, text);
	}

	async translateBatch(
		texts: string[],
		targetLanguage: string,
		context?: string
	): Promise<string[]> {
		if (texts.length === 0) {
			return [];
		}

		if (texts.length > TRANSLATION_CONFIG.MAX_BATCH_SIZE) {
			const results: string[] = [];
			for (let i = 0; i < texts.length; i += TRANSLATION_CONFIG.MAX_BATCH_SIZE) {
				const batch = texts.slice(i, i + TRANSLATION_CONFIG.MAX_BATCH_SIZE);
				const batchResults = await this.translateBatch(batch, targetLanguage, context);
				results.push(...batchResults);

				if (i + TRANSLATION_CONFIG.MAX_BATCH_SIZE < texts.length) {
					await this.delay(TRANSLATION_CONFIG.BATCH_DELAY);
				}
			}
			return results;
		}

		this.validateBatchInput(texts, targetLanguage);

		if (!this.isOnline()) {
			throw createAIError(
				AIErrorCode.API_KEY_MISSING,
				"Service is offline or API key is not configured"
			);
		}

		const prompt = this.buildBatchPrompt(texts, targetLanguage, context);
		const response = await this.makeRequest(prompt);

		return this.extractBatchTranslations(response, texts);
	}

	async *translateToAllLanguages(
		text: string,
		languages: string[],
		context?: string
	): AsyncGenerator<StreamingTranslationResult, void, unknown> {
		this.validateInput(text, languages[0]);

		if (!this.isOnline()) {
			throw createAIError(
				AIErrorCode.API_KEY_MISSING,
				"Service is offline or API key is not configured"
			);
		}

		const batchSize = Math.min(3, TRANSLATION_CONFIG.MAX_BATCH_SIZE);

		for (let i = 0; i < languages.length; i += batchSize) {
			const languageBatch = languages.slice(i, i + batchSize);

			const promises = languageBatch.map(async (language) => {
				await this.waitForRateLimit();
				const translation = await this.translateText(text, language, context);
				return { language, translation };
			});

			const results = await Promise.allSettled(promises);

			for (const result of results) {
				if (result.status === "fulfilled") {
					yield result.value;
				} else {
					console.error("Translation failed for batch:", result.reason);
				}
			}

			if (i + batchSize < languages.length) {
				await this.delay(TRANSLATION_CONFIG.BATCH_DELAY);
			}
		}
	}

	private buildPrompt(text: string, targetLanguage: string, context?: string): string {
		const languageName =
			COMMON_LANGUAGES[targetLanguage as keyof typeof COMMON_LANGUAGES] || targetLanguage;

		let prompt = `You are a professional translator. Translate the following text from ${DEFAULT_SOURCE_LANGUAGE} to ${languageName} (${targetLanguage}).

Rules:
1. Maintain the original meaning and tone
2. Keep any placeholders like {{variable}} unchanged
3. Preserve formatting and special characters
4. Return ONLY the translated text, no explanations
5. If the text contains technical terms, keep them accurate`;

		if (context) {
			prompt += `\n6. Context: ${context}`;
		}

		prompt += `\n\nText to translate: "${text}"

Translation:`;

		return prompt;
	}

	private buildBatchPrompt(texts: string[], targetLanguage: string, context?: string): string {
		const languageName =
			COMMON_LANGUAGES[targetLanguage as keyof typeof COMMON_LANGUAGES] || targetLanguage;

		let prompt = `You are a professional translator. Translate the following texts from ${DEFAULT_SOURCE_LANGUAGE} to ${languageName} (${targetLanguage}).

Rules:
1. Maintain the original meaning and tone for each text
2. Keep any placeholders like {{variable}} unchanged
3. Preserve formatting and special characters
4. Return translations in the same order, one per line
5. If a text contains technical terms, keep them accurate`;

		if (context) {
			prompt += `\n6. Context: ${context}`;
		}

		prompt += `\n\nTexts to translate:\n`;

		texts.forEach((text, index) => {
			prompt += `${index + 1}. "${text}"\n`;
		});

		prompt += `\nTranslations (one per line, in order):`;

		return prompt;
	}

	private async makeRequest(prompt: string): Promise<string> {
		return this.executeWithRetry(async () => {
			await this.waitForRateLimit();

			const response = await fetch(
				`${GEMINI_CONFIG.BASE_URL}/models/${GEMINI_CONFIG.MODEL}:generateContent?key=${this.apiKey}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						contents: [
							{
								parts: [
									{
										text: prompt,
									},
								],
							},
						],
						generationConfig: {
							temperature: 0.1,
							topK: 1,
							topP: 0.8,
							maxOutputTokens: 2048,
						},
					}),
					signal: AbortSignal.timeout(GEMINI_CONFIG.TIMEOUT),
				}
			);

			this.updateRateLimit();

			if (!response.ok) {
				// Enhanced error handling for different HTTP status codes
				switch (response.status) {
					case 401:
						throw createAIError(
							AIErrorCode.API_KEY_INVALID,
							"Invalid API key - please check your Gemini API key configuration"
						);
					case 403:
						throw createAIError(
							AIErrorCode.API_KEY_INVALID,
							"API key lacks required permissions - please check your Gemini API key permissions"
						);
					case 429:
						throw createAIError(
							AIErrorCode.RATE_LIMIT_EXCEEDED,
							"Rate limit exceeded - please wait before making more requests"
						);
					case 500:
					case 502:
					case 503:
					case 504:
						throw createAIError(
							AIErrorCode.SERVICE_UNAVAILABLE,
							`Gemini API service temporarily unavailable (${response.status})`
						);
					default:
						throw createAIError(
							AIErrorCode.NETWORK_ERROR,
							`API request failed: ${response.status} ${response.statusText}`
						);
				}
			}

			const data = await response.json();

			if (!data.candidates || data.candidates.length === 0) {
				throw createAIError(
					AIErrorCode.INVALID_RESPONSE,
					"No translation candidates returned from API"
				);
			}

			const content = data.candidates[0]?.content?.parts?.[0]?.text;
			if (!content) {
				throw createAIError(AIErrorCode.INVALID_RESPONSE, "Invalid response format from API");
			}

			return content.trim();
		});
	}

	private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
		let lastError: Error | undefined;

		for (let attempt = 1; attempt <= RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error as Error;

				const translationError = error as AITranslationError;

				// Enhanced error handling with proper retry logic
				if (translationError.code) {
					// Don't retry non-retryable errors
					if (!isRetryableError(translationError)) {
						throw error;
					}

					// Handle specific error types
					if (
						translationError.code === AIErrorCode.API_KEY_INVALID ||
						translationError.code === AIErrorCode.API_KEY_MISSING
					) {
						throw createAIError(
							translationError.code,
							"API key configuration issue - please check your Gemini API key",
							translationError
						);
					}

					if (translationError.code === AIErrorCode.QUOTA_EXCEEDED) {
						throw createAIError(
							AIErrorCode.QUOTA_EXCEEDED,
							"API quota exceeded - please check your billing and usage limits",
							translationError
						);
					}
				}

				if (attempt === RETRY_CONFIG.MAX_ATTEMPTS) {
					break;
				}

				// Use enhanced retry delay calculation
				const delay = isRetryableError(translationError)
					? getRetryDelay(translationError, attempt)
					: RETRY_CONFIG.BASE_DELAY_MS * 2 ** (attempt - 1);

				console.warn(`Translation attempt ${attempt} failed, retrying in ${delay}ms:`, error);
				await this.delay(delay);
			}
		}

		// Enhanced error reporting
		const finalError = lastError as AITranslationError;
		if (finalError?.code === AIErrorCode.RATE_LIMIT_EXCEEDED) {
			throw createAIError(
				AIErrorCode.RATE_LIMIT_EXCEEDED,
				`Rate limit exceeded after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts. Please wait before retrying.`,
				finalError
			);
		}

		throw createAIError(
			AIErrorCode.TRANSLATION_FAILED,
			`Translation failed after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts: ${lastError?.message || "Unknown error"}`,
			lastError as Error
		);
	}

	private async waitForRateLimit(): Promise<void> {
		const now = Date.now();

		if (now - this.lastResetTime > 60 * 1000) {
			this.requestCount = 0;
			this.lastResetTime = now;
			this.rateLimitStatus.remaining = GEMINI_CONFIG.RATE_LIMIT_RPM;
			this.rateLimitStatus.resetTime = new Date(now + 60 * 1000);
		}

		if (this.dailyRequestCount >= GEMINI_CONFIG.RATE_LIMIT_RPD) {
			throw createAIError(AIErrorCode.RATE_LIMIT_EXCEEDED, "Daily rate limit exceeded");
		}

		if (this.requestCount >= GEMINI_CONFIG.RATE_LIMIT_RPM) {
			const waitTime = this.rateLimitStatus.resetTime.getTime() - now;
			if (waitTime > 0) {
				console.log(`Rate limit reached, waiting ${waitTime}ms`);
				await this.delay(waitTime);
			}
		}

		const timeSinceLastRequest = now - this.lastRequestTime;
		const minDelay = 1000;

		if (timeSinceLastRequest < minDelay) {
			await this.delay(minDelay - timeSinceLastRequest);
		}

		this.lastRequestTime = Date.now();
	}

	private updateRateLimit(): void {
		this.requestCount++;
		this.dailyRequestCount++;
		this.rateLimitStatus.remaining = Math.max(0, GEMINI_CONFIG.RATE_LIMIT_RPM - this.requestCount);
	}

	private extractTranslation(response: string, originalText: string): string {
		const translation = response.trim();

		if (!translation) {
			throw createAIError(AIErrorCode.INVALID_RESPONSE, "Empty translation received from API");
		}

		if (translation === originalText) {
			console.warn("Translation is identical to original text, this might indicate an issue");
		}

		return translation;
	}

	private extractBatchTranslations(response: string, originalTexts: string[]): string[] {
		const lines = response
			.trim()
			.split("\n")
			.filter((line) => line.trim());

		if (lines.length !== originalTexts.length) {
			console.warn(`Expected ${originalTexts.length} translations, got ${lines.length}`);

			const translations: string[] = [];
			for (let i = 0; i < originalTexts.length; i++) {
				if (i < lines.length) {
					const translation = lines[i].replace(/^\d+\.\s*/, "").trim();
					translations.push(translation || originalTexts[i]);
				} else {
					translations.push(originalTexts[i]);
				}
			}
			return translations;
		}

		return lines.map((line, index) => {
			const translation = line.replace(/^\d+\.\s*/, "").trim();
			return translation || originalTexts[index];
		});
	}

	private validateInput(text: string, targetLanguage: string): void {
		if (!text || text.trim().length === 0) {
			throw createValidationError(ValidationErrorCode.EMPTY_SOURCE_TEXT, "Text cannot be empty");
		}

		if (text.length > TRANSLATION_CONFIG.MAX_TEXT_LENGTH) {
			throw createValidationError(
				ValidationErrorCode.INVALID_TRANSLATION_FORMAT,
				`Text too long: ${text.length} characters (max: ${TRANSLATION_CONFIG.MAX_TEXT_LENGTH})`
			);
		}

		if (!targetLanguage || targetLanguage.trim().length === 0) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				"Target language cannot be empty"
			);
		}
	}

	private validateBatchInput(texts: string[], targetLanguage: string): void {
		if (texts.length === 0) {
			throw createValidationError(
				ValidationErrorCode.MISSING_REQUIRED_FIELD,
				"Texts array cannot be empty"
			);
		}

		for (const text of texts) {
			this.validateInput(text, targetLanguage);
		}
	}

	private scheduleReset(): void {
		const now = new Date();
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(0, 0, 0, 0);

		const msUntilMidnight = tomorrow.getTime() - now.getTime();

		setTimeout(() => {
			this.dailyRequestCount = 0;
			this.scheduleReset();
		}, msUntilMidnight);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export const aiTranslationService = new GeminiTranslationService();
