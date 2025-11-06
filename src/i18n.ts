import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enTranslation from "./locales/en/translation.json";
import ptTranslation from "./locales/pt/translation.json";
import { translationManager } from "./lib/translation";

i18n.use(initReactI18next).init({
	resources: {
		en: {
			translation: enTranslation,
		},
		pt: {
			translation: ptTranslation,
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
	// Enable missing key handling for automatic translation
	missingKeyHandler: (lngs: readonly string[], ns: string, key: string, fallbackValue: string) => {
		// Handle missing keys for all requested languages
		for (const lng of lngs) {
			translationManager.handleMissingKey(lng, ns, key, fallbackValue);
		}
	},
	// Parse missing keys to extract context for better translations
	parseMissingKeyHandler: (key: string) => {
		return translationManager.parseKeyContext(key);
	},
	// Ensure backward compatibility
	react: {
		useSuspense: false, // Prevent suspense issues during dynamic loading
	},
});

export default i18n;
