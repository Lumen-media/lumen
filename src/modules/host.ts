import { getVersion } from '@tauri-apps/api/app';
import { createBusAPI, createEventsAPI } from './apis/bus';
import { createCommandsAPI } from './apis/commands';
import { createDataAPI } from './apis/data';
import {
  createLibraryHostAPI,
  createLyricsHostAPI,
  createPlayerHostAPI,
  createPresentationHostAPI,
  createQueueHostAPI,
  createThemesHostAPI,
} from './apis/domain';
import { createFsAPI } from './apis/fs';
import { createI18nAPI } from './apis/i18n';
import { createLoggerAPI } from './apis/logger';
import { createNetAPI } from './apis/net';
import { createPanelsAPI } from './apis/panels';
import { createSettingsAPI } from './apis/settings';
import { createUIAPI } from './apis/ui';
import type { LumenHost, ModuleManifest } from './types';

export async function createHost(
  manifest: ModuleManifest,
  openCommandPalette: (prefilter?: string) => void,
): Promise<LumenHost> {
  const appVersion = await getVersion().catch(() => '0.0.0');
  const id = manifest.id;

  return {
    meta: { id, version: manifest.version },
    window: 'main',
    app: { version: appVersion, locale: navigator.language },

    panels: createPanelsAPI(id),
    commands: createCommandsAPI(),
    ui: createUIAPI(openCommandPalette),

    bus: createBusAPI(),
    events: createEventsAPI(),

    data: createDataAPI(id),
    settings: createSettingsAPI(id),

    lyrics: createLyricsHostAPI(),
    queue: createQueueHostAPI(),
    library: createLibraryHostAPI(),
    player: createPlayerHostAPI(),
    presentation: createPresentationHostAPI(),
    themes: createThemesHostAPI(),

    fs: createFsAPI(id),
    net: createNetAPI(),
    i18n: createI18nAPI(),
    log: createLoggerAPI(id),
  };
}
