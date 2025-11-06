import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { translationManager } from "../lib/translation";

export interface UseAutoTranslationReturn {
	t: (key: string, variables?: Record<string, unknown>) => string;
	isLoading: boolean;
	changeLanguage: (language: string) => Promise<void>;
	currentLanguage: string;
	availableLanguages: string[];
	isTranslationPending: (key: string, language?: string) => boolean;
	reloadResources: () => Promise<void>;
}

export function useAutoTranslation(): UseAutoTranslationReturn {
	const { t: i18nT, i18n } = useTranslation();
	const [isLoading, setIsLoading] = useState(false);
	const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);

	useEffect(() => {
		const loadLanguages = async () => {
			try {
				const languages = translationManager.getAvailableLanguages();
				setAvailableLanguages(languages);
			} catch (error) {
				console.warn("Failed to load available languages:", error);
				setAvailableLanguages(["en", "pt"]); // Fallback to known languages
			}
		};

		loadLanguages();
	}, []);

	const t = useCallback(
		(key: string, variables?: Record<string, unknown>): string => {
			try {
				const translation = i18nT(key, variables as any);

				if (typeof translation === "string") {
					return translation;
				}

				return String(translation) || key;
			} catch (error) {
				console.warn(`Translation error for key ${key}:`, error);
				return key;
			}
		},
		[i18nT]
	);

	const changeLanguage = useCallback(
		async (language: string): Promise<void> => {
			setIsLoading(true);
			try {
				await i18n.changeLanguage(language);

				await translationManager.loadTranslations(language);
			} catch (error) {
				console.error(`Failed to change language to ${language}:`, error);
				throw error;
			} finally {
				setIsLoading(false);
			}
		},
		[i18n]
	);

	const isTranslationPending = useCallback(
		(key: string, language?: string): boolean => {
			const targetLanguage = language || i18n.language;
			return translationManager.isTranslationPending(key, targetLanguage);
		},
		[i18n.language]
	);

	const reloadResources = useCallback(async (): Promise<void> => {
		setIsLoading(true);
		try {
			await translationManager.reloadAllResources();
		} catch (error) {
			console.error("Failed to reload translation resources:", error);
			throw error;
		} finally {
			setIsLoading(false);
		}
	}, []);

	return {
		t,
		isLoading,
		changeLanguage,
		currentLanguage: i18n.language,
		availableLanguages,
		isTranslationPending,
		reloadResources,
	};
}

export { useTranslation } from "react-i18next";
