import { listen } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { create } from 'zustand';
import { localesService } from '@/services/locales-service';

const MINIMAL_FALLBACK_EN: Record<string, string> = {
  Version: 'Version',
  'Desktop App': 'Desktop App',
  'Check for Updates': 'Check for Updates',
  'Updating...': 'Updating...',
  'Update available': 'Update available',
  'Your app is up to date': 'Your app is up to date',
  'Starting Lumen…': 'Starting Lumen…',
  'Welcome to Lumen': 'Welcome to Lumen',
  'Choose the modules you want to install. You can manage them anytime in Settings → Modules.':
    'Choose the modules you want to install. You can manage them anytime in Settings → Modules.',
  Verified: 'Verified',
  Installed: 'Installed',
  Installing: 'Installing',
  '{{count}} selected': '{{count}} selected',
  'Select all': 'Select all',
  Clear: 'Clear',
  Refresh: 'Refresh',
  'Could not load the module catalog': 'Could not load the module catalog',
  'Try again': 'Try again',
  'No modules available': 'No modules available',
  'Skip for now': 'Skip for now',
  'Install selected': 'Install selected',
};

const MINIMAL_FALLBACK_PT_BR: Record<string, string> = {
  Version: 'Versão',
  'Desktop App': 'App Desktop',
  'Check for Updates': 'Verificar Atualizações',
  'Updating...': 'Atualizando...',
  'Update available': 'Atualização disponível',
  'Your app is up to date': 'Seu app está atualizado',
  'Starting Lumen…': 'Iniciando Lumen…',
  'Welcome to Lumen': 'Bem-vindo ao Lumen',
  'Choose the modules you want to install. You can manage them anytime in Settings → Modules.':
    'Escolha os módulos que deseja instalar. Você pode gerenciá-los a qualquer momento em Configurações → Módulos.',
  Verified: 'Verificado',
  Installed: 'Instalado',
  Installing: 'Instalando',
  '{{count}} selected': '{{count}} selecionados',
  'Select all': 'Selecionar todos',
  Clear: 'Limpar',
  Refresh: 'Atualizar',
  'Could not load the module catalog': 'Não foi possível carregar o catálogo de módulos',
  'Try again': 'Tentar novamente',
  'No modules available': 'Nenhum módulo disponível',
  'Skip for now': 'Pular por enquanto',
  'Install selected': 'Instalar selecionados',
};

const BUNDLED_FALLBACK: Record<string, Record<string, string>> = {
  en: MINIMAL_FALLBACK_EN,
  'pt-BR': MINIMAL_FALLBACK_PT_BR,
};

const BUNDLED_LANGUAGES: LanguageMeta[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)' },
  { code: 'es-AR', name: 'Spanish (Argentina)', nativeName: 'Español (Argentina)' },
  { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español (España)' },
];

const LOCALES_CACHE_KEY = 'lumen-locales-cache';

interface LocalesCache {
  runtime: Record<string, Record<string, string>>;
  languages: LanguageMeta[];
}

function readLocalesCache(): LocalesCache | null {
  try {
    const raw = localStorage.getItem(LOCALES_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalesCache;
  } catch {
    return null;
  }
}

function writeLocalesCache(cache: LocalesCache): void {
  try {
    localStorage.setItem(LOCALES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full or unavailable */
  }
}

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
      writeLocalesCache({ runtime, languages });
    } else if (languages.length > 0) {
      useI18nStore.setState({ languages });
      writeLocalesCache({ runtime, languages });
    }
  } catch {
    /* not synced yet */
  }
  const cached = readLocalesCache();
  if (cached && Object.keys(cached.runtime).length > 0) {
    useI18nStore.setState({ runtime: cached.runtime, languages: cached.languages });
  } else if (cached && cached.languages.length > 0) {
    useI18nStore.setState({ languages: cached.languages });
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
  const runtime = useI18nStore((s) => s.runtime);

  const resolveable = languages.filter((l) => runtime[l.code] ?? BUNDLED_FALLBACK[l.code]);
  if (resolveable.length > 0) return resolveable;

  const runtimeCodes = Object.keys(runtime).filter((code) => runtime[code]);
  if (runtimeCodes.length > 0) {
    return runtimeCodes.map((code) => ({
      code,
      name: code,
      nativeName: code,
    }));
  }

  return BUNDLED_LANGUAGES;
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
