import type { TranslationError } from "../errors";
import { AIErrorCode, ConfigurationErrorCode } from "../errors";

export interface NotificationService {
	/**
	 * Show user notification for errors
	 */
	showError(message: string, details?: string): void;

	/**
	 * Show user notification for warnings
	 */
	showWarning(message: string, details?: string): void;

	/**
	 * Show user notification for info
	 */
	showInfo(message: string, details?: string): void;

	/**
	 * Show user notification for success
	 */
	showSuccess(message: string, details?: string): void;

	/**
	 * Show API key configuration notification
	 */
	showApiKeyConfigurationIssue(error: TranslationError): void;

	/**
	 * Show system health notification
	 */
	showSystemHealthIssue(
		severity: "warning" | "error" | "critical",
		message: string,
		action?: string
	): void;

	/**
	 * Clear all notifications
	 */
	clearAll(): void;
}

export interface NotificationOptions {
	duration?: number;
	action?: {
		label: string;
		callback: () => void;
	};
	dismissible?: boolean;
}

export class BrowserNotificationService implements NotificationService {
	private notifications = new Map<string, HTMLElement>();
	private container: HTMLElement;

	constructor() {
		this.container = this.createNotificationContainer();
	}

	showError(message: string, details?: string): void {
		this.showNotification("error", message, details, { duration: 0, dismissible: true });
	}

	showWarning(message: string, details?: string): void {
		this.showNotification("warning", message, details, { duration: 8000, dismissible: true });
	}

	showInfo(message: string, details?: string): void {
		this.showNotification("info", message, details, { duration: 5000, dismissible: true });
	}

	showSuccess(message: string, details?: string): void {
		this.showNotification("success", message, details, { duration: 4000, dismissible: true });
	}

	showApiKeyConfigurationIssue(error: TranslationError): void {
		const errorCode = (error as any).code;

		let message = "API Configuration Issue";
		let details = error.message;
		let action: NotificationOptions["action"];

		switch (errorCode) {
			case AIErrorCode.API_KEY_MISSING:
				message = "Gemini API Key Not Configured";
				details = "Please configure your Gemini API key to enable automatic translations.";
				action = {
					label: "Configure API Key",
					callback: () => this.openApiKeyConfiguration(),
				};
				break;

			case AIErrorCode.API_KEY_INVALID:
				message = "Invalid Gemini API Key";
				details = "The configured API key is invalid. Please check your API key configuration.";
				action = {
					label: "Check API Key",
					callback: () => this.openApiKeyConfiguration(),
				};
				break;

			case AIErrorCode.QUOTA_EXCEEDED:
				message = "API Quota Exceeded";
				details =
					"Your Gemini API quota has been exceeded. Please check your billing and usage limits.";
				action = {
					label: "Check Usage",
					callback: () => this.openGeminiConsole(),
				};
				break;

			case ConfigurationErrorCode.MISSING_API_KEY:
				message = "API Key Configuration Missing";
				details = "Please set up your Gemini API key in the environment variables or settings.";
				action = {
					label: "Setup Guide",
					callback: () => this.openSetupGuide(),
				};
				break;

			default:
				message = "Translation Service Issue";
				details = error.message;
		}

		this.showNotification("error", message, details, {
			duration: 0,
			dismissible: true,
			action,
		});
	}

	showSystemHealthIssue(
		severity: "warning" | "error" | "critical",
		message: string,
		action?: string
	): void {
		const type = severity === "critical" ? "error" : severity;
		const options: NotificationOptions = {
			duration: severity === "critical" ? 0 : 10000,
			dismissible: true,
		};

		if (action) {
			options.action = {
				label: action,
				callback: () => this.handleSystemHealthAction(action),
			};
		}

		this.showNotification(type, `System Health: ${message}`, undefined, options);
	}

	clearAll(): void {
		this.notifications.forEach((element, id) => {
			this.removeNotification(id, element);
		});
		this.notifications.clear();
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private showNotification(
		type: "error" | "warning" | "info" | "success",
		message: string,
		details?: string,
		options: NotificationOptions = {}
	): void {
		const id = this.generateNotificationId();
		const element = this.createNotificationElement(type, message, details, options, id);

		this.notifications.set(id, element);
		this.container.appendChild(element);

		if (options.duration && options.duration > 0) {
			setTimeout(() => {
				this.removeNotification(id, element);
			}, options.duration);
		}

		requestAnimationFrame(() => {
			element.classList.add("notification-show");
		});
	}

	private createNotificationContainer(): HTMLElement {
		let container = document.getElementById("translation-notifications");

		if (!container) {
			container = document.createElement("div");
			container.id = "translation-notifications";
			container.className = "translation-notifications-container";

			const style = document.createElement("style");
			style.textContent = `
				.translation-notifications-container {
					position: fixed;
					top: 20px;
					right: 20px;
					z-index: 10000;
					max-width: 400px;
					pointer-events: none;
				}
				
				.translation-notification {
					background: white;
					border-radius: 8px;
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
					margin-bottom: 12px;
					padding: 16px;
					pointer-events: auto;
					transform: translateX(100%);
					transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;
					opacity: 0;
					border-left: 4px solid #ccc;
				}
				
				.translation-notification.notification-show {
					transform: translateX(0);
					opacity: 1;
				}
				
				.translation-notification.notification-error {
					border-left-color: #ef4444;
				}
				
				.translation-notification.notification-warning {
					border-left-color: #f59e0b;
				}
				
				.translation-notification.notification-info {
					border-left-color: #3b82f6;
				}
				
				.translation-notification.notification-success {
					border-left-color: #10b981;
				}
				
				.translation-notification-header {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					margin-bottom: 8px;
				}
				
				.translation-notification-title {
					font-weight: 600;
					font-size: 14px;
					color: #1f2937;
					margin: 0;
				}
				
				.translation-notification-close {
					background: none;
					border: none;
					font-size: 18px;
					cursor: pointer;
					color: #6b7280;
					padding: 0;
					margin-left: 12px;
				}
				
				.translation-notification-close:hover {
					color: #374151;
				}
				
				.translation-notification-details {
					font-size: 13px;
					color: #6b7280;
					margin-bottom: 12px;
					line-height: 1.4;
				}
				
				.translation-notification-action {
					background: #3b82f6;
					color: white;
					border: none;
					border-radius: 4px;
					padding: 6px 12px;
					font-size: 12px;
					cursor: pointer;
					font-weight: 500;
				}
				
				.translation-notification-action:hover {
					background: #2563eb;
				}
			`;

			document.head.appendChild(style);
			document.body.appendChild(container);
		}

		return container;
	}

	private createNotificationElement(
		type: "error" | "warning" | "info" | "success",
		message: string,
		details?: string,
		options: NotificationOptions = {},
		id: string = ""
	): HTMLElement {
		const notification = document.createElement("div");
		notification.className = `translation-notification notification-${type}`;
		notification.setAttribute("data-id", id);

		const header = document.createElement("div");
		header.className = "translation-notification-header";

		const title = document.createElement("h4");
		title.className = "translation-notification-title";
		title.textContent = message;

		header.appendChild(title);

		if (options.dismissible !== false) {
			const closeButton = document.createElement("button");
			closeButton.className = "translation-notification-close";
			closeButton.innerHTML = "×";
			closeButton.onclick = () => this.removeNotification(id, notification);
			header.appendChild(closeButton);
		}

		notification.appendChild(header);

		if (details) {
			const detailsElement = document.createElement("div");
			detailsElement.className = "translation-notification-details";
			detailsElement.textContent = details;
			notification.appendChild(detailsElement);
		}

		if (options.action) {
			const actionButton = document.createElement("button");
			actionButton.className = "translation-notification-action";
			actionButton.textContent = options.action.label;
			actionButton.onclick = () => {
				options.action?.callback();
				this.removeNotification(id, notification);
			};
			notification.appendChild(actionButton);
		}

		return notification;
	}

	private removeNotification(id: string, element: HTMLElement): void {
		element.classList.remove("notification-show");

		setTimeout(() => {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
			this.notifications.delete(id);
		}, 300);
	}

	private generateNotificationId(): string {
		return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private openApiKeyConfiguration(): void {
		console.log("Opening API key configuration...");
		console.log(`
To configure your Gemini API key:

1. Get an API key from Google AI Studio: https://makersuite.google.com/app/apikey
2. Set the environment variable: VITE_GEMINI_API_KEY=your_api_key_here
3. Restart the application

Or add it to your .env file:
VITE_GEMINI_API_KEY=your_api_key_here
		`);
	}

	private openGeminiConsole(): void {
		window.open(
			"https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas",
			"_blank"
		);
	}

	private openSetupGuide(): void {
		console.log("Opening setup guide...");
		console.log(`
Gemini API Setup Guide:

1. Visit Google AI Studio: https://makersuite.google.com/app/apikey
2. Create a new API key
3. Copy the API key
4. Add it to your environment:
   - Create/edit .env file in project root
   - Add: VITE_GEMINI_API_KEY=your_api_key_here
   - Restart the application

The translation system will automatically detect the API key and enable automatic translations.
		`);
	}

	private handleSystemHealthAction(action: string): void {
		switch (action.toLowerCase()) {
			case "check api key":
			case "configure api key":
				this.openApiKeyConfiguration();
				break;
			case "check usage":
				this.openGeminiConsole();
				break;
			case "clear cache":
				console.log("Clearing translation cache...");
				break;
			case "restart service":
				console.log("Restarting translation service...");
				break;
			default:
				console.log(`Handling system health action: ${action}`);
		}
	}
}

export class ConsoleNotificationService implements NotificationService {
	showError(message: string, details?: string): void {
		console.error(`❌ ${message}${details ? `\n   ${details}` : ""}`);
	}

	showWarning(message: string, details?: string): void {
		console.warn(`⚠️  ${message}${details ? `\n   ${details}` : ""}`);
	}

	showInfo(message: string, details?: string): void {
		console.info(`ℹ️  ${message}${details ? `\n   ${details}` : ""}`);
	}

	showSuccess(message: string, details?: string): void {
		console.log(`✅ ${message}${details ? `\n   ${details}` : ""}`);
	}

	showApiKeyConfigurationIssue(error: TranslationError): void {
		const errorCode = (error as any).code;

		console.error("🔑 API Configuration Issue:");
		console.error(`   ${error.message}`);

		switch (errorCode) {
			case AIErrorCode.API_KEY_MISSING:
			case ConfigurationErrorCode.MISSING_API_KEY:
				console.error("\n   To fix this:");
				console.error(
					"   1. Get an API key from Google AI Studio: https://makersuite.google.com/app/apikey"
				);
				console.error("   2. Set environment variable: VITE_GEMINI_API_KEY=your_api_key_here");
				console.error("   3. Restart the application");
				break;

			case AIErrorCode.API_KEY_INVALID:
				console.error("\n   To fix this:");
				console.error("   1. Check your API key is correct");
				console.error("   2. Verify the key has proper permissions");
				console.error("   3. Try generating a new key if needed");
				break;

			case AIErrorCode.QUOTA_EXCEEDED:
				console.error("\n   To fix this:");
				console.error(
					"   1. Check your usage at: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas"
				);
				console.error("   2. Upgrade your plan if needed");
				console.error("   3. Wait for quota reset if on free tier");
				break;
		}
	}

	showSystemHealthIssue(
		severity: "warning" | "error" | "critical",
		message: string,
		action?: string
	): void {
		const icon = severity === "critical" ? "🚨" : severity === "error" ? "❌" : "⚠️";
		console.log(`${icon} System Health [${severity.toUpperCase()}]: ${message}`);

		if (action) {
			console.log(`   Suggested action: ${action}`);
		}
	}

	clearAll(): void {}
}

export function createNotificationService(): NotificationService {
	if (typeof window !== "undefined" && typeof document !== "undefined") {
		return new BrowserNotificationService();
	} else {
		return new ConsoleNotificationService();
	}
}

export const notificationService = createNotificationService();
