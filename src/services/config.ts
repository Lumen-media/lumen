import { join } from '@tauri-apps/api/path';
import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { Store } from '@tauri-apps/plugin-store';
import { getAppBasePath } from './app-paths';

export interface AppConfig {
  theme: {
    colorMode: 'dark' | 'light';
    accentId: string;
  };
  activeProfileId: string | null;
}

const DEFAULT_CONFIG: AppConfig = {
  theme: {
    colorMode: 'dark',
    accentId: 'cyan',
  },
  activeProfileId: null,
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    const basePath = await getAppBasePath();
    const configDir = await join(basePath, 'config');

    if (!(await exists(configDir))) {
      await mkdir(configDir, { recursive: true });
    }

    const configPath = await join(configDir, 'app.json');
    store = await Store.load(configPath);
  }
  return store;
}

export async function loadConfig(): Promise<AppConfig> {
  const s = await getStore();
  const theme = await s.get<AppConfig['theme']>('theme');
  const activeProfileId = await s.get<string>('activeProfileId');
  return {
    theme: theme ?? DEFAULT_CONFIG.theme,
    activeProfileId: activeProfileId ?? null,
  };
}

export async function saveConfigKey<K extends keyof AppConfig>(
  key: K,
  value: AppConfig[K]
): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
}
