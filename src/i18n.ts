import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Initialize i18n with basic configuration
// Resources will be loaded dynamically by the translation manager
i18n.use(initReactI18next).init({
	resources: {
		en: {
			translation: {
				welcome: "Welcome to Lumen!",
				greeting: "Hello, {{name}}!",
				language: "Language",
			},
		},
		pt: {
			translation: {
				welcome: "Bem-vindo ao Lumen!",
				greeting: "Olá, {{name}}!",
				language: "Idioma",
			},
		},
	},
	fallbackLng: "en",
	lng: "en",
	interpolation: {
		escapeValue: false,
	},
	returnEmptyString: false,
	returnNull: false,
	saveMissing: true,
	missingKeyHandler: async (lngs: readonly string[], ns: string, key: string, fallbackValue: string) => {
		try {
			const { translationManager } = await import("./lib/translation");
			for (const lng of lngs) {
				translationManager.handleMissingKey(lng, ns, key, fallbackValue);
			}
		} catch (error) {
			console.warn("Failed to handle missing key:", error);
		}
	},
	parseMissingKeyHandler: async (key: string) => {
		try {
			const { translationManager } = await import("./lib/translation");
			return translationManager.parseKeyContext(key);
		} catch (error) {
			console.warn("Failed to parse key context:", error);
			return "General application text";
		}
	},
	react: {
		useSuspense: false,
	},
});

export default i18n;

export async function loadTranslationsFromManager(): Promise<void> {
	try {
		const { translationManager } = await import("./lib/translation");
		
		const languages = translationManager.getAvailableLanguages();
		
		for (const language of languages) {
			try {
				const translations = await translationManager.loadTranslations(language);
				
				for (const [key, value] of Object.entries(translations)) {
					i18n.addResource(language, "translation", key, value);
				}
				
				console.log(`✅ Loaded ${Object.keys(translations).length} translations for ${language}`);
			} catch (error) {
				console.warn(`Failed to load translations for ${language}:`, error);
			}
		}
		
		await i18n.reloadResources();
		console.log("✅ i18n integration with translation manager complete");
	} catch (error) {
		console.error("Failed to integrate i18n with translation manager:", error);
	}
}

if (typeof window !== "undefined" && (window as any).__TAURI__) {
	setTimeout(() => {
		loadTranslationsFromManager().catch(console.error);
	}, 1000);
} else {
	console.log("ℹ️ Using static translations - dynamic translation system disabled");
}