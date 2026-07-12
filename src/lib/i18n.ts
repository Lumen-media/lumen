import { create } from 'zustand';
import en from '@/locales/en/translation.json';
import pt from '@/locales/pt/translation.json';

const translations: Record<string, Record<string, string>> = {
  en: en as Record<string, string>,
  'pt-BR': pt as Record<string, string>,
};

interface I18nState {
  locale: string;
  setLocale: (locale: string) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: localStorage.getItem('lumen-language') ?? 'en',
  setLocale: (locale) => {
    localStorage.setItem('lumen-language', locale);
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

function interpolate(str: string, params: Record<string, string | number>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''));
}

function resolve(locale: string, key: string, params?: Record<string, string | number>): string {
  const dict = translations[locale] ?? translations.en;
  const fallback = translations.en;
  const raw = dict[key] ?? fallback[key] ?? key;
  return params ? interpolate(raw, params) : raw;
}

export function useTranslation() {
  const { locale, setLocale } = useI18nStore();
  return {
    t: (key: string, params?: Record<string, string | number>) => resolve(locale, key, params),
    locale,
    setLocale,
  };
}

export function t(key: string, params?: Record<string, string | number>): string {
  const { locale } = useI18nStore.getState();
  return resolve(locale, key, params);
}
