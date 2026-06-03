import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "./locales/en/translation.json";
import ptTranslation from "./locales/pt/translation.json";

const savedLng = localStorage.getItem("lumen-language") ?? "en";

document.documentElement.lang = savedLng;

i18n.use(initReactI18next).init({
	resources: {
		en: {
			translation: enTranslation,
		},
		"pt-BR": {
			translation: ptTranslation,
		},
	},
	fallbackLng: "en",
	lng: savedLng,
	interpolation: {
		escapeValue: false,
	},
	returnEmptyString: false,
	returnNull: false,
});

export default i18n;
