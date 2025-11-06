import { aiTranslationService } from "./ai-translation-service";
import { cacheService } from "./cache-service";
import { ErrorRecoveryServiceImpl } from "./error-recovery-service";
import { fileSystemService } from "./file-system-service";
import { notificationService } from "./notification-service";
import { translationManager } from "./translation-manager";

export const errorRecoveryService = new ErrorRecoveryServiceImpl(
	aiTranslationService,
	fileSystemService,
	cacheService,
	translationManager
);

translationManager.setErrorRecoveryService(errorRecoveryService);

errorRecoveryService.onError((error, context, recovery) => {
	// Handle API key configuration issues with user notifications
	if (error.category === "AI_SERVICE" || error.category === "CONFIGURATION") {
		notificationService.showApiKeyConfigurationIssue(error);
	}

	// Handle critical system issues
	if (!recovery.recovered && context.operation === "loadTranslations") {
		notificationService.showSystemHealthIssue(
			"error",
			`Failed to load translations for ${context.language}`,
			"Check file permissions"
		);
	}

	if (error.category === "CACHE" && (error as any).code === "CACHE_CORRUPTION_DETECTED") {
		notificationService.showSystemHealthIssue(
			"warning",
			"Translation cache corruption detected and recovered",
			"Monitor system performance"
		);
	}

	if (error.category === "FILE_SYSTEM") {
		const fsError = error as any;

		switch (fsError.code) {
			case "FS_CORRUPTION_DETECTED":
				if (recovery.recovered) {
					notificationService.showWarning(
						"Translation file corruption recovered",
						`File for ${context.language} was restored from backup`
					);
				} else {
					notificationService.showError(
						"Translation file corruption",
						`Unable to recover file for ${context.language}`
					);
				}
				break;

			case "FS_PERMISSION_DENIED":
				notificationService.showError(
					"File permission error",
					"Check file system permissions for translation files"
				);
				break;

			case "FS_DISK_FULL":
				notificationService.showError(
					"Disk space error",
					"Free up disk space to continue saving translations"
				);
				break;
		}
	}
});

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthMonitoring(): void {
	if (healthCheckInterval) {
		return;
	}

	healthCheckInterval = setInterval(
		async () => {
			try {
				const health = await errorRecoveryService.getSystemHealth();
				const criticalIssues = health.issues.filter((issue) => issue.severity === "critical");

				for (const issue of criticalIssues) {
					notificationService.showSystemHealthIssue(
						issue.severity,
						issue.message,
						issue.suggestedAction
					);
				}
			} catch (error) {
				console.warn("Health check failed:", error);
			}
		},
		5 * 60 * 1000
	);
}

export function stopHealthMonitoring(): void {
	if (healthCheckInterval) {
		clearInterval(healthCheckInterval);
		healthCheckInterval = null;
	}
}

// Auto-start health monitoring
if (typeof window !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", startHealthMonitoring);
	} else {
		startHealthMonitoring();
	}

	window.addEventListener("beforeunload", stopHealthMonitoring);
}

export async function validateSystemConfiguration(): Promise<void> {
	try {
		const apiKeyValidation = await errorRecoveryService.validateApiKeyConfiguration();

		if (!apiKeyValidation.isValid) {
			const mockError = {
				category: "CONFIGURATION" as const,
				code: apiKeyValidation.isConfigured ? "API_KEY_INVALID" : "API_KEY_MISSING",
				message: apiKeyValidation.message,
			};

			notificationService.showApiKeyConfigurationIssue(mockError as any);
		} else {
			console.log("✅ API key validation successful");
		}
	} catch (error) {
		console.warn("System configuration validation failed:", error);
	}
}

export { notificationService };
