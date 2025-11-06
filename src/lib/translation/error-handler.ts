import { isTranslationError, type TranslationError } from "./errors";
import type { ErrorContext } from "./services/error-recovery-service";
import { errorRecoveryService, notificationService } from "./services/integrated-error-recovery";

/**
 * Global error handler for translation system
 */
export class TranslationErrorHandler {
	static async handleError(
		error: unknown,
		context: Partial<ErrorContext> = {}
	): Promise<string | null> {
		try {
			const fullContext: ErrorContext = {
				operation: context.operation || "unknown",
				service: context.service || "unknown",
				language: context.language,
				key: context.key,
				retryCount: context.retryCount || 0,
			};

			let translationError: TranslationError;
			if (isTranslationError(error)) {
				translationError = error;
			} else {
				translationError = {
					name: "TranslationError",
					message: error instanceof Error ? error.message : String(error),
					category: "VALIDATION" as const,
					code: "UNKNOWN_ERROR",
					cause: error instanceof Error ? error : undefined,
				} as TranslationError;
			}

			const recovery = await errorRecoveryService.handleError(translationError, fullContext);

			console.error("Translation system error:", {
				error: translationError,
				context: fullContext,
				recovery,
			});

			return recovery.fallbackValue || null;
		} catch (handlerError) {
			console.error("Error handler failed:", handlerError);
			return null;
		}
	}

	static async handleErrorWithNotification(
		error: unknown,
		context: Partial<ErrorContext> = {},
		showNotification = true
	): Promise<string | null> {
		const result = await TranslationErrorHandler.handleError(error, context);

		if (showNotification && isTranslationError(error)) {
		}

		return result;
	}

	static withErrorHandling<T extends (...args: any[]) => Promise<any>>(
		fn: T,
		context: Partial<ErrorContext> = {}
	): T {
		return (async (...args: Parameters<T>) => {
			try {
				return await fn(...args);
			} catch (error) {
				const fallback = await TranslationErrorHandler.handleError(error, context);

				if (fallback !== null) {
					return fallback;
				}

				throw error;
			}
		}) as T;
	}

	static createSafeTranslationFunction<T extends (...args: any[]) => Promise<string>>(
		fn: T,
		defaultValue: string = "",
		context: Partial<ErrorContext> = {}
	): (...args: Parameters<T>) => Promise<string> {
		return async (...args: Parameters<T>): Promise<string> => {
			try {
				return await fn(...args);
			} catch (error) {
				const fallback = await TranslationErrorHandler.handleError(error, context);
				return fallback || defaultValue;
			}
		};
	}

	static async checkSystemHealth(): Promise<void> {
		try {
			const health = await errorRecoveryService.getSystemHealth();

			if (health.overall === "critical") {
				notificationService.showSystemHealthIssue(
					"critical",
					"Translation system has critical issues",
					"Check system configuration"
				);
			} else if (health.overall === "degraded") {
				notificationService.showSystemHealthIssue(
					"warning",
					"Translation system performance is degraded",
					"Monitor system status"
				);
			}

			for (const issue of health.issues) {
				if (issue.severity === "critical" || issue.severity === "error") {
					notificationService.showSystemHealthIssue(
						issue.severity,
						issue.message,
						issue.suggestedAction
					);
				}
			}
		} catch (error) {
			console.warn("System health check failed:", error);
		}
	}

	static async initialize(): Promise<void> {
		try {
			const apiValidation = await errorRecoveryService.validateApiKeyConfiguration();

			if (!apiValidation.isValid) {
				console.warn("API key validation failed:", apiValidation.message);
			}

			await TranslationErrorHandler.checkSystemHealth();

			console.log("Translation error handling system initialized");
		} catch (error) {
			console.error("Failed to initialize error handling system:", error);
		}
	}
}

export function withTranslationErrorHandling(context: Partial<ErrorContext> = {}) {
	return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
		const method = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			try {
				return await method.apply(this, args);
			} catch (error) {
				const fallback = await TranslationErrorHandler.handleError(error, {
					...context,
					operation: context.operation || propertyName,
					service: context.service || target.constructor.name,
				});

				if (fallback !== null) {
					return fallback;
				}

				throw error;
			}
		};

		return descriptor;
	};
}

export const ErrorHandlingUtils = {
	async safeGetTranslation(key: string, language: string, fallback: string = key): Promise<string> {
		try {
			const { translationManager } = await import("./services");
			return await translationManager.getTranslation(key, language);
		} catch (error) {
			const recovered = await TranslationErrorHandler.handleError(error, {
				operation: "getTranslation",
				service: "TranslationManager",
				key,
				language,
			});

			return recovered || fallback;
		}
	},

	async safeLoadTranslations(language: string): Promise<Record<string, string>> {
		try {
			const { translationManager } = await import("./services");
			return await translationManager.loadTranslations(language);
		} catch (error) {
			await TranslationErrorHandler.handleError(error, {
				operation: "loadTranslations",
				service: "TranslationManager",
				language,
			});
			return {};
		}
	},

	async safeFileOperation<T>(
		operation: () => Promise<T>,
		context: Partial<ErrorContext> = {}
	): Promise<T | null> {
		try {
			return await operation();
		} catch (error) {
			await TranslationErrorHandler.handleError(error, {
				...context,
				service: "FileSystemService",
			});

			return null;
		}
	},

	async safeTranslateText(
		text: string,
		targetLanguage: string,
		fallback: string = text
	): Promise<string> {
		try {
			const { aiTranslationService } = await import("./services");
			return await aiTranslationService.translateText(text, targetLanguage);
		} catch (error) {
			const recovered = await TranslationErrorHandler.handleError(error, {
				operation: "translateText",
				service: "AITranslationService",
				language: targetLanguage,
			});

			return recovered || fallback;
		}
	},
};

if (typeof window !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			TranslationErrorHandler.initialize();
		});
	} else {
		TranslationErrorHandler.initialize();
	}
}
