import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslations from "./locales/en/translation.json";
import ptTranslations from "./locales/pt/translation.json";

i18n.use(initReactI18next).init({
	resources: {
		en: {
			translation: enTranslations,
		},
		pt: {
			translation: ptTranslations,
		},
	},
	fallbackLng: "en",
	lng: "en",
	interpolation: {
		escapeValue: false,
	},
	returnEmptyString: false,
	returnNull: false,
	returnObjects: false,
	keySeparator: ".",
	nsSeparator: ":",
	saveMissing: true,
	missingKeyHandler: async (lngs: readonly string[], ns: string, key: string, fallbackValue: string) => {
		
		for (const lng of lngs) {
			i18n.addResource(lng, ns, key, key);
		}
		
		if (typeof window !== "undefined" && (window as any).__TAURI__) {
			try {
				const { translationManager } = await import("./lib/translation");
				
				for (const lng of lngs) {
					try {
						translationManager.handleMissingKey(lng, ns, key, fallbackValue || key);
					} catch (handleError) {
						console.error(`❌ Error calling handleMissingKey for ${lng}:`, handleError);
					}
				}
			} catch (error) {
				console.error("❌ Failed to handle missing key:", error);
				console.error("Error details:", error);
			}
		} else {
			if (typeof window !== "undefined" && !(window as any).__PENDING_MISSING_KEYS__) {
				(window as any).__PENDING_MISSING_KEYS__ = [];
			}
			if (typeof window !== "undefined") {
				(window as any).__PENDING_MISSING_KEYS__.push({key, lngs, ns, fallbackValue});
			}
		}
	},
	parseMissingKeyHandler: async (key: string) => {
		if (typeof window !== "undefined" && (window as any).__TAURI__) {
			try {
				const { translationManager } = await import("./lib/translation");
				return translationManager.parseKeyContext(key);
			} catch (error) {
				console.warn("Failed to parse key context:", error);
			}
		}

		return key;
	},
	react: {
		useSuspense: false,
	},
});

export default i18n;

export async function loadTranslationsFromManager(): Promise<void> {
	try {
		const { translationManager } = await import("./lib/translation");
		
		const staticTranslations = {
			en: enTranslations,
			pt: ptTranslations,
		};
		
		for (const [language, translations] of Object.entries(staticTranslations)) {
			try {
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
				
				flatten(translations);
				
				for (const [key, value] of Object.entries(flatTranslations)) {
					try {
						await translationManager.requestTranslationForAllLanguages(key, String(value));
					} catch (error) {
						console.warn(`Failed to sync key "${key}" with value "${value}":`, error);
					}
				}
				
			} catch (error) {
				console.warn(`Failed to sync translations for ${language}:`, error);
			}
		}
		
		const availableLanguages = translationManager.getAvailableLanguages();
		
		for (const language of availableLanguages) {
			try {
				const managerTranslations = await translationManager.loadTranslations(language);
				
				for (const [key, value] of Object.entries(managerTranslations)) {
					if (!i18n.exists(key, { lng: language })) {
						i18n.addResource(language, "translation", key, value);
					}
				}
			} catch (error) {
				console.warn(`Failed to load additional translations for ${language}:`, error);
			}
		}
		
		await i18n.reloadResources();
	} catch (error) {
		console.error("Failed to sync translations:", error);
	}
}

if (typeof window !== "undefined") {
	let dynamicSystemInitialized = false;
	
	window.addEventListener("translation-system-ready", async () => {
		dynamicSystemInitialized = true;
		loadTranslationsFromManager().catch(console.error);
		
		const pendingKeys = (window as any).__PENDING_MISSING_KEYS__ || [];
		if (pendingKeys.length > 0) {
			try {
				const { translationManager } = await import("./lib/translation");
				
				for (const {key, lngs, ns, fallbackValue} of pendingKeys) {
					for (const lng of lngs) {
						translationManager.handleMissingKey(lng, ns, key, fallbackValue || key);
					}
				}
				
				(window as any).__PENDING_MISSING_KEYS__ = [];
			} catch (error) {
				console.error("❌ Failed to process pending missing keys:", error);
			}
		}
	});
	
	setTimeout(() => {
		if (dynamicSystemInitialized) {
			return;
		}
		
		if (typeof window !== "undefined" && 
			(window as any).__TAURI__ && 
			!(window as any).__TRANSLATION_DISABLED__) {
			loadTranslationsFromManager().catch(console.error);
		} else {
			console.log("ℹ️ Using static translations - dynamic translation system disabled");
		}
	}, 5000);
}