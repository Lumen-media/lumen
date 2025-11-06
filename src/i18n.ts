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
	missingKeyHandler: (lngs: readonly string[], ns: string, key: string, fallbackValue: string) => {
		for (const lng of lngs) {
			translationManager.handleMissingKey(lng, ns, key, fallbackValue);
		}
	},
	parseMissingKeyHandler: (key: string) => {
		return translationManager.parseKeyContext(key);
	},
});

export default i18n;
