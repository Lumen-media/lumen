import { ipc, type RawLocaleStatus } from '@/lib/ipc';

export interface LanguageRef {
  code: string;
  name: string;
  nativeName: string;
}

export interface LocaleInfo {
  code: string;
  name: string;
  nativeName: string;
  installed: boolean;
  path: string | null;
}

export interface LocaleStatus {
  latestTag: string | null;
  lastSyncedTag: string | null;
  syncedAt: number | null;
  localesDir: string;
  languages: LocaleInfo[];
}

class LocalesService {
  async checkLocales(): Promise<LocaleStatus> {
    return unmap(await ipc('check_locales'));
  }

  async syncLocales(): Promise<LocaleStatus> {
    return unmap(await ipc('sync_locales'));
  }

  async listLocales(): Promise<LocaleInfo[]> {
    const result = await ipc('list_locales');
    return result.map((item) => ({
      code: item.code,
      name: item.name,
      nativeName: item.native_name,
      installed: item.installed,
      path: item.path,
    }));
  }

  async applyLocale(lang: string): Promise<string> {
    return await ipc('apply_locale', { lang });
  }
}

function unmap(raw: RawLocaleStatus): LocaleStatus {
  return {
    latestTag: raw.latest_tag,
    lastSyncedTag: raw.last_synced_tag,
    syncedAt: raw.synced_at,
    localesDir: raw.locales_dir,
    languages: raw.languages.map((item) => ({
      code: item.code,
      name: item.name,
      nativeName: item.native_name,
      installed: item.installed,
      path: item.path,
    })),
  };
}

export const localesService = new LocalesService();
