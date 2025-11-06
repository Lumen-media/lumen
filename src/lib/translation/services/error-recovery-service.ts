import { DEFAULT_SOURCE_LANGUAGE } from "../constants";
import {
	AIErrorCode,
	CacheErrorCode,
	ConfigurationErrorCode,
	FileSystemErrorCode,
	isTranslationError,
	type TranslationError,
} from "../errors";
import type {
	AITranslationService,
	CacheService,
	FileSystemService,
	TranslationManager,
} from "../types";

export interface ErrorRecoveryService {
	handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult>;
	recoverFromFileCorruption(language: string): Promise<boolean>;
	validateApiKeyConfiguration(): Promise<ApiKeyValidationResult>;
	createTranslationFallback(key: string, language: string): Promise<string>;
	recoverFromCacheCorruption(): Promise<boolean>;
	handleNetworkError(error: TranslationError): Promise<NetworkRecoveryResult>;
	onError(callback: ErrorNotificationCallback): void;
	getSystemHealth(): Promise<SystemHealthStatus>;
}

export interface ErrorContext {
	operation: string;
	service: string;
	language?: string;
	key?: string;
	retryCount?: number;
}

export interface ErrorRecoveryResult {
	recovered: boolean;
	fallbackValue?: string;
	message: string;
	shouldRetry: boolean;
	retryDelay?: number;
}

export interface ApiKeyValidationResult {
	isValid: boolean;
	isConfigured: boolean;
	message: string;
	suggestedAction?: string;
}

export interface NetworkRecoveryResult {
	isOnline: boolean;
	canRetry: boolean;
	estimatedRecoveryTime?: number;
}

export interface SystemHealthStatus {
	overall: "healthy" | "degraded" | "critical";
	services: {
		ai: ServiceHealth;
		fileSystem: ServiceHealth;
		cache: ServiceHealth;
		network: ServiceHealth;
	};
	issues: HealthIssue[];
}

export interface ServiceHealth {
	status: "healthy" | "degraded" | "critical";
	lastCheck: Date;
	message?: string;
}

export interface HealthIssue {
	severity: "warning" | "error" | "critical";
	service: string;
	message: string;
	suggestedAction?: string;
}

export type ErrorNotificationCallback = (
	error: TranslationError,
	context: ErrorContext,
	recovery: ErrorRecoveryResult
) => void;

export class ErrorRecoveryServiceImpl implements ErrorRecoveryService {
	private errorCallbacks: ErrorNotificationCallback[] = [];
	private lastHealthCheck = new Date(0);
	private healthCheckInterval = 5 * 60 * 1000; // 5 minutes
	private cachedHealthStatus: SystemHealthStatus | null = null;

	constructor(
		private aiService: AITranslationService,
		private fileService: FileSystemService,
		private cacheService: CacheService,
		private translationManager: TranslationManager
	) {}

	async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
		const translationError = isTranslationError(error) ? error : null;

		if (!translationError) {
			return {
				recovered: false,
				message: `Unhandled error in ${context.service}: ${error.message}`,
				shouldRetry: false,
			};
		}

		const result = await this.processError(translationError, context);
		this.notifyErrorCallbacks(translationError, context, result);

		return result;
	}

	async recoverFromFileCorruption(language: string): Promise<boolean> {
		try {
			console.warn(`Attempting to recover corrupted translation file for language: ${language}`);

			try {
				await this.fileService.restoreTranslationFile(language);
				console.log(`Successfully restored ${language} translation file from backup`);
				return true;
			} catch (restoreError) {
				console.warn(`Backup restoration failed for ${language}:`, restoreError);
			}

			if (language !== DEFAULT_SOURCE_LANGUAGE) {
				try {
					await this.fileService.copyTranslationStructure(DEFAULT_SOURCE_LANGUAGE, language);
					console.log(`Recreated ${language} translation file from source language`);
					return true;
				} catch (copyError) {
					console.warn(`Failed to recreate ${language} from source:`, copyError);
				}
			}

			try {
				await this.fileService.writeTranslationFile(language, {});
				console.log(`Created empty translation file for ${language}`);
				return true;
			} catch (createError) {
				console.error(`Failed to create empty translation file for ${language}:`, createError);
				return false;
			}
		} catch (error) {
			console.error(`File corruption recovery failed for ${language}:`, error);
			return false;
		}
	}

	async validateApiKeyConfiguration(): Promise<ApiKeyValidationResult> {
		try {
			const isOnline = this.aiService.isOnline();

			if (!isOnline) {
				return {
					isValid: false,
					isConfigured: false,
					message: "Gemini AI API key is not configured or service is offline",
					suggestedAction:
						"Please configure your Gemini API key in the environment variables or settings",
				};
			}

			try {
				await this.aiService.translateText("test", "es", "API key validation test");
				return {
					isValid: true,
					isConfigured: true,
					message: "API key is valid and working",
				};
			} catch (error) {
				const translationError = error as TranslationError;

				if (translationError.code === AIErrorCode.API_KEY_INVALID) {
					return {
						isValid: false,
						isConfigured: true,
						message: "API key is configured but invalid",
						suggestedAction:
							"Please check your Gemini API key and ensure it has the correct permissions",
					};
				}

				if (translationError.code === AIErrorCode.QUOTA_EXCEEDED) {
					return {
						isValid: true,
						isConfigured: true,
						message: "API key is valid but quota exceeded",
						suggestedAction: "Please check your Gemini API usage limits and billing",
					};
				}

				return {
					isValid: false,
					isConfigured: true,
					message: `API key validation failed: ${translationError.message}`,
					suggestedAction: "Please check your API key configuration and network connection",
				};
			}
		} catch (error) {
			return {
				isValid: false,
				isConfigured: false,
				message: `Failed to validate API key: ${error instanceof Error ? error.message : "Unknown error"}`,
				suggestedAction: "Please check your configuration and try again",
			};
		}
	}

	async createTranslationFallback(key: string, language: string): Promise<string> {
		try {
			const cached = this.cacheService.getTranslation(key, language);
			if (cached) {
				return cached;
			}

			if (language !== DEFAULT_SOURCE_LANGUAGE) {
				try {
					const sourceTranslation = await this.translationManager.getTranslation(
						key,
						DEFAULT_SOURCE_LANGUAGE
					);
					return sourceTranslation;
				} catch (error) {
					console.warn(`Failed to get source translation for fallback: ${key}`, error);
				}
			}

			const availableLanguages = this.translationManager.getAvailableLanguages();
			for (const lang of availableLanguages) {
				if (lang !== language) {
					try {
						const fallbackTranslation = this.cacheService.getTranslation(key, lang);
						if (fallbackTranslation) {
							console.warn(`Using ${lang} translation as fallback for ${language}: ${key}`);
							return fallbackTranslation;
						}
					} catch (error) {}
				}
			}

			console.warn(
				`No fallback translation found for ${key} in ${language}, using key as fallback`
			);
			return key;
		} catch (error) {
			console.error(`Fallback creation failed for ${key} in ${language}:`, error);
			return key;
		}
	}

	async recoverFromCacheCorruption(): Promise<boolean> {
		try {
			console.warn("Attempting to recover from cache corruption");

			this.cacheService.clearCache();

			const availableLanguages = this.translationManager.getAvailableLanguages();
			let recoveredLanguages = 0;

			for (const language of availableLanguages) {
				try {
					await this.translationManager.loadTranslations(language);
					recoveredLanguages++;
				} catch (error) {
					console.warn(`Failed to reload translations for ${language}:`, error);
				}
			}

			const success = recoveredLanguages > 0;
			if (success) {
				console.log(
					`Cache recovery successful: reloaded ${recoveredLanguages}/${availableLanguages.length} languages`
				);
			} else {
				console.error("Cache recovery failed: no languages could be reloaded");
			}

			return success;
		} catch (error) {
			console.error("Cache corruption recovery failed:", error);
			return false;
		}
	}

	async handleNetworkError(error: TranslationError): Promise<NetworkRecoveryResult> {
		const isOnline = navigator.onLine;

		if (!isOnline) {
			return {
				isOnline: false,
				canRetry: false,
				estimatedRecoveryTime: undefined,
			};
		}

		const retryableCodes = [
			AIErrorCode.NETWORK_ERROR,
			AIErrorCode.TIMEOUT,
			AIErrorCode.SERVICE_UNAVAILABLE,
		];

		const canRetry = retryableCodes.includes(error.code as AIErrorCode);

		let estimatedRecoveryTime: number | undefined;
		if (error.code === AIErrorCode.RATE_LIMIT_EXCEEDED) {
			const rateLimitStatus = this.aiService.getRateLimitStatus();
			estimatedRecoveryTime = rateLimitStatus.resetTime.getTime() - Date.now();
		}

		return {
			isOnline: true,
			canRetry,
			estimatedRecoveryTime,
		};
	}

	onError(callback: ErrorNotificationCallback): void {
		this.errorCallbacks.push(callback);
	}

	async getSystemHealth(): Promise<SystemHealthStatus> {
		const now = new Date();

		if (
			this.cachedHealthStatus &&
			now.getTime() - this.lastHealthCheck.getTime() < this.healthCheckInterval
		) {
			return this.cachedHealthStatus;
		}

		const health: SystemHealthStatus = {
			overall: "healthy",
			services: {
				ai: await this.checkAIServiceHealth(),
				fileSystem: await this.checkFileSystemHealth(),
				cache: await this.checkCacheHealth(),
				network: await this.checkNetworkHealth(),
			},
			issues: [],
		};

		const services = Object.values(health.services);
		const criticalServices = services.filter((s) => s.status === "critical");
		const degradedServices = services.filter((s) => s.status === "degraded");

		if (criticalServices.length > 0) {
			health.overall = "critical";
		} else if (degradedServices.length > 0) {
			health.overall = "degraded";
		}

		for (const [serviceName, serviceHealth] of Object.entries(health.services)) {
			if (serviceHealth.status !== "healthy" && serviceHealth.message) {
				health.issues.push({
					severity: serviceHealth.status === "critical" ? "critical" : "warning",
					service: serviceName,
					message: serviceHealth.message,
					suggestedAction: this.getSuggestedAction(serviceName, serviceHealth.status),
				});
			}
		}

		this.cachedHealthStatus = health;
		this.lastHealthCheck = now;

		return health;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private async processError(
		error: TranslationError,
		context: ErrorContext
	): Promise<ErrorRecoveryResult> {
		switch (error.category) {
			case "AI_SERVICE":
				return this.handleAIServiceError(error, context);
			case "FILE_SYSTEM":
				return this.handleFileSystemError(error, context);
			case "CACHE":
				return this.handleCacheError(error, context);
			case "VALIDATION":
				return this.handleValidationError(error, context);
			case "CONFIGURATION":
				return this.handleConfigurationError(error, context);
			default:
				return {
					recovered: false,
					message: `Unknown error category: ${error.category}`,
					shouldRetry: false,
				};
		}
	}

	private async handleAIServiceError(
		error: TranslationError,
		context: ErrorContext
	): Promise<ErrorRecoveryResult> {
		const aiError = error as any;

		switch (aiError.code) {
			case AIErrorCode.API_KEY_MISSING:
			case AIErrorCode.API_KEY_INVALID:
				return {
					recovered: false,
					message: "API key configuration issue detected",
					shouldRetry: false,
				};

			case AIErrorCode.RATE_LIMIT_EXCEEDED: {
				const rateLimitStatus = this.aiService.getRateLimitStatus();
				const retryDelay = rateLimitStatus.resetTime.getTime() - Date.now();

				return {
					recovered: false,
					message: "Rate limit exceeded, will retry after reset",
					shouldRetry: true,
					retryDelay: Math.max(retryDelay, 60000), // At least 1 minute
				};
			}

			case AIErrorCode.NETWORK_ERROR:
			case AIErrorCode.TIMEOUT:
			case AIErrorCode.SERVICE_UNAVAILABLE: {
				const fallback =
					context.key && context.language
						? await this.createTranslationFallback(context.key, context.language)
						: undefined;

				return {
					recovered: !!fallback,
					fallbackValue: fallback,
					message: "Network error, using fallback translation",
					shouldRetry: true,
					retryDelay: 5000,
				};
			}

			default:
				return {
					recovered: false,
					message: `AI service error: ${error.message}`,
					shouldRetry: false,
				};
		}
	}

	private async handleFileSystemError(
		error: TranslationError,
		context: ErrorContext
	): Promise<ErrorRecoveryResult> {
		const fsError = error as any;

		switch (fsError.code) {
			case FileSystemErrorCode.CORRUPTION_DETECTED:
				if (context.language) {
					const recovered = await this.recoverFromFileCorruption(context.language);
					return {
						recovered,
						message: recovered
							? "File corruption recovered from backup"
							: "File corruption recovery failed",
						shouldRetry: recovered,
					};
				}
				break;

			case FileSystemErrorCode.PERMISSION_DENIED:
				return {
					recovered: false,
					message: "File permission denied - check file system permissions",
					shouldRetry: false,
				};

			case FileSystemErrorCode.DISK_FULL:
				return {
					recovered: false,
					message: "Disk full - free up space and try again",
					shouldRetry: false,
				};

			case FileSystemErrorCode.FILE_NOT_FOUND:
				if (context.language && context.language !== DEFAULT_SOURCE_LANGUAGE) {
					try {
						await this.fileService.copyTranslationStructure(
							DEFAULT_SOURCE_LANGUAGE,
							context.language
						);
						return {
							recovered: true,
							message: "Missing translation file recreated from source",
							shouldRetry: true,
						};
					} catch (recreateError) {}
				}
				break;
		}

		return {
			recovered: false,
			message: `File system error: ${error.message}`,
			shouldRetry: false,
		};
	}

	private async handleCacheError(
		error: TranslationError,
		context: ErrorContext
	): Promise<ErrorRecoveryResult> {
		const cacheError = error as any;

		switch (cacheError.code) {
			case CacheErrorCode.CORRUPTION_DETECTED:
			case CacheErrorCode.MEMORY_LIMIT_EXCEEDED: {
				const recovered = await this.recoverFromCacheCorruption();
				return {
					recovered,
					message: recovered ? "Cache corruption recovered" : "Cache recovery failed",
					shouldRetry: recovered,
				};
			}

			default:
				return {
					recovered: false,
					message: `Cache error: ${error.message}`,
					shouldRetry: false,
				};
		}
	}

	private async handleValidationError(
		error: TranslationError,
		context: ErrorContext
	): Promise<ErrorRecoveryResult> {
		return {
			recovered: false,
			message: `Validation error: ${error.message}`,
			shouldRetry: false,
		};
	}

	private async handleConfigurationError(
		error: TranslationError,
		context: ErrorContext
	): Promise<ErrorRecoveryResult> {
		const configError = error as any;

		switch (configError.code) {
			case ConfigurationErrorCode.MISSING_API_KEY:
				return {
					recovered: false,
					message: "API key not configured - please set up your Gemini API key",
					shouldRetry: false,
				};

			default:
				return {
					recovered: false,
					message: `Configuration error: ${error.message}`,
					shouldRetry: false,
				};
		}
	}

	private async checkAIServiceHealth(): Promise<ServiceHealth> {
		try {
			const isOnline = this.aiService.isOnline();

			if (!isOnline) {
				return {
					status: "critical",
					lastCheck: new Date(),
					message: "AI service is offline or API key not configured",
				};
			}

			const rateLimitStatus = this.aiService.getRateLimitStatus();
			if (rateLimitStatus.remaining < 10) {
				return {
					status: "degraded",
					lastCheck: new Date(),
					message: "AI service rate limit nearly exceeded",
				};
			}

			return {
				status: "healthy",
				lastCheck: new Date(),
			};
		} catch (error) {
			return {
				status: "critical",
				lastCheck: new Date(),
				message: `AI service check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			};
		}
	}

	private async checkFileSystemHealth(): Promise<ServiceHealth> {
		try {
			await this.fileService.ensureTranslationDirectory();
			const languages = await this.fileService.getAvailableLanguages();

			if (languages.length === 0) {
				return {
					status: "degraded",
					lastCheck: new Date(),
					message: "No translation files found",
				};
			}

			return {
				status: "healthy",
				lastCheck: new Date(),
			};
		} catch (error) {
			return {
				status: "critical",
				lastCheck: new Date(),
				message: `File system check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			};
		}
	}

	private async checkCacheHealth(): Promise<ServiceHealth> {
		try {
			const stats = (this.cacheService as any).getStats?.();

			if (stats && stats.memoryUsage > 50 * 1024 * 1024) {
				return {
					status: "degraded",
					lastCheck: new Date(),
					message: "Cache memory usage is high",
				};
			}

			return {
				status: "healthy",
				lastCheck: new Date(),
			};
		} catch (error) {
			return {
				status: "critical",
				lastCheck: new Date(),
				message: `Cache check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			};
		}
	}

	private async checkNetworkHealth(): Promise<ServiceHealth> {
		const isOnline = navigator.onLine;

		if (!isOnline) {
			return {
				status: "critical",
				lastCheck: new Date(),
				message: "Network is offline",
			};
		}

		return {
			status: "healthy",
			lastCheck: new Date(),
		};
	}

	private getSuggestedAction(serviceName: string, status: string): string {
		const actions: Record<string, Record<string, string>> = {
			ai: {
				critical: "Check API key configuration and network connection",
				degraded: "Monitor API usage and consider upgrading plan if needed",
			},
			fileSystem: {
				critical: "Check file permissions and disk space",
				degraded: "Review translation file structure and backup status",
			},
			cache: {
				critical: "Clear cache and restart application",
				degraded: "Monitor memory usage and consider clearing cache",
			},
			network: {
				critical: "Check internet connection and firewall settings",
				degraded: "Monitor network stability",
			},
		};

		return actions[serviceName]?.[status] || "Contact support for assistance";
	}

	private notifyErrorCallbacks(
		error: TranslationError,
		context: ErrorContext,
		recovery: ErrorRecoveryResult
	): void {
		for (const callback of this.errorCallbacks) {
			try {
				callback(error, context, recovery);
			} catch (callbackError) {
				console.error("Error in error notification callback:", callbackError);
			}
		}
	}
}
