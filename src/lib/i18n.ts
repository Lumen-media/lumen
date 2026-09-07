import { listen } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { create } from 'zustand';
import en from '@/locales/en/translation.json';
import pt from '@/locales/pt/translation.json';
import { localesService } from '@/services/locales-service';

const BUNDLED_FALLBACK: Record<string, Record<string, string>> = {
  en: en as Record<string, string>,
  'pt-BR': pt as Record<string, string>,
};

export interface LanguageMeta {
  code: string;
  name: string;
  nativeName: string;
}

interface I18nState {
  locale: string;
  runtime: Record<string, Record<string, string>>;
  languages: LanguageMeta[];
  setLocale: (locale: string) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: localStorage.getItem('lumen-language') ?? 'en',
  runtime: {},
  languages: [],
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
  const { runtime } = useI18nStore.getState();
  const runtimeDict = runtime[locale] ?? {};
  const runtimeEn = runtime.en ?? {};
  const raw =
    runtimeDict[key] ??
    runtimeEn[key] ??
    BUNDLED_FALLBACK[locale]?.[key] ??
    BUNDLED_FALLBACK.en[key] ??
    key;
  return params ? interpolate(raw, params) : raw;
}

async function loadLocalesFromDisk(): Promise<void> {
  try {
    const dir = await appDataDir();
    const localesDir = await join(dir, 'locales');
    const entries = await readDir(localesDir);
    const runtime: Record<string, Record<string, string>> = {};
    let languages: LanguageMeta[] = [];

    const indexRaw = await readTextFile(await join(localesDir, 'languages.json')).catch(() => '');
    if (indexRaw) {
      languages = JSON.parse(indexRaw) as LanguageMeta[];
    }

    for (const entry of entries) {
      if (!entry.isFile || entry.name === 'languages.json') continue;
      if (!entry.name.endsWith('.json')) continue;
      const code = entry.name.replace(/\.json$/, '');
      const raw = await readTextFile(await join(localesDir, entry.name));
      try {
        runtime[code] = JSON.parse(raw) as Record<string, string>;
      } catch {
        /* skip corrupt file */
      }
    }

    if (Object.keys(runtime).length > 0) {
      useI18nStore.setState({ runtime, languages });
    } else if (languages.length > 0) {
      useI18nStore.setState({ languages });
    }
  } catch {
    /* not synced yet */
  }
}

export async function initI18n(): Promise<void> {
  await listen('locales-synced', () => {
    void loadLocalesFromDisk();
  });
  await loadLocalesFromDisk();
  localesService
    .syncLocales()
    .then(() => loadLocalesFromDisk())
    .catch(() => {});
}

export function useAvailableLanguages(): LanguageMeta[] {
  const languages = useI18nStore((s) => s.languages);
  if (languages.length > 0) return languages;
  return [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  ];
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
