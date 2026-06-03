import { create } from 'zustand';

const translations: Record<string, Record<string, string>> = {
  en: {},
  'pt-BR': {
    Language: 'Idioma',
    'Color Mode': 'Modo de Cor',
    'Accent Color': 'Cor de Destaque',
    'Default Background': 'Plano de Fundo Padrão',
    'Add background': 'Adicionar plano de fundo',
    'Workspace': 'Espaço de Trabalho',
    'Appearance Settings': 'Aparência',
    'Theme & Profiles': 'Temas e Perfis',
    'New Profile': 'Novo Perfil',
    'Developer Mode': 'Modo Desenvolvedor',
    'Enable advanced options for module development and debugging.': 'Habilita opções avançadas para desenvolvimento e depuração de módulos.',
    'Advanced': 'Avançado',
    'Modules': 'Módulos',
    'About': 'Sobre',
  },
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
