import { fileSystemService } from "./services/file-system-service";

/**
 * Initialize translation system with basic translations
 */
export async function initializeTranslations(): Promise<void> {
	try {
		console.log("Initializing translation system...");
		await fileSystemService.ensureTranslationDirectory();

		const basicTranslations = {
			welcome: "Welcome to Lumen!",
			greeting: "Hello, {{name}}!",
			language: "Language",
			player: {
				play: "Play",
				pause: "Pause",
				stop: "Stop",
				next: "Next",
				previous: "Previous",
				volume: "Volume",
			},
			nav: {
				home: "Home",
				library: "Library",
				settings: "Settings",
			},
		};

		try {
			await fileSystemService.readTranslationFile("en");
			console.log("English translations already exist");
		} catch (error) {
			console.log("Creating initial English translations...");
			await fileSystemService.createLanguageDirectory("en");
			const flatTranslations: Record<string, string> = {};

			function flatten(obj: any, prefix = ""): void {
				for (const [key, value] of Object.entries(obj)) {
					const newKey = prefix ? `${prefix}.${key}` : key;
					if (typeof value === "object" && value !== null) {
						flatten(value, newKey);
					} else {
						flatTranslations[newKey] = String(value);
					}
				}
			}

			flatten(basicTranslations);
			await fileSystemService.writeTranslationFile("en", flatTranslations);
			console.log("✅ Initial English translations created");
		}

		try {
			await fileSystemService.createLanguageDirectory("pt");
			console.log("✅ Portuguese language directory ready");
		} catch (error) {
			console.warn("Could not create Portuguese directory:", error);
		}

		console.log("✅ Translation system initialized successfully");
	} catch (error) {
		console.error("❌ Failed to initialize translation system:", error);
		throw error;
	}
}

/**
 * Get available languages safely
 */
export async function getAvailableLanguagesSafely(): Promise<string[]> {
	try {
		return await fileSystemService.getAvailableLanguages();
	} catch (error) {
		console.warn("Could not get available languages:", error);
		return ["en"];
	}
}
