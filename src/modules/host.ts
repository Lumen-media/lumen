import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { createBusAPI, createEventsAPI } from './apis/bus';
import { createCommandsAPI } from './apis/commands';
import { createMenusAPI } from './apis/menus';
import { createDataAPI } from './apis/data';
import {
  createLibraryHostAPI,
  createLyricsHostAPI,
  createPlayerHostAPI,
  createOverlayHostAPI,
  createPresentationHostAPI,
  createQueueHostAPI,
  createSurfaceHostAPI,
  createThemesHostAPI,
} from './apis/domain';
import { createFontsAPI } from './apis/fonts';
import { createFsAPI } from './apis/fs';
import { createI18nAPI } from './apis/i18n';
import { createLoggerAPI } from './apis/logger';
import { createNetAPI } from './apis/net';
import { createPanelsAPI } from './apis/panels';
import { createSettingsAPI } from './apis/settings';
import { createUIAPI } from './apis/ui';
import { useI18nStore } from '@/lib/i18n';
import { useQueueEntriesStore } from '@/stores/queue-entries-store';
import { useQueueStore } from '@/stores/queue-store';
import { queueDbService } from '@/services/queue-db-service';
import type { LumenHost, ModuleManifest } from './types';

listen<{ triggerId: string; config: unknown }>('module:queue-add-trigger', (event) => {
  const { triggerId, config } = event.payload;
  const cfg = config as Record<string, unknown> | undefined;
  const title =
    cfg?.bookName != null && cfg?.chapter != null && cfg?.verse != null
      ? `${cfg.bookName} ${cfg.chapter}:${cfg.verse}`
      : triggerId;
  const tag = cfg?.versionDisplayName != null ? String(cfg.versionDisplayName) : '';
  const configStr = JSON.stringify(config);
  const entryId = hashString(triggerId + ':' + configStr);

  const entriesStore = useQueueEntriesStore.getState();
  const existing = entriesStore.entries.find((e) => e.id === entryId);
  if (!existing) {
    entriesStore.setEntries([
      ...entriesStore.entries,
      {
        kind: 'trigger' as const,
        id: entryId,
        inst: {
          id: entryId,
          triggerId,
          config,
          showLabel: true,
          played: false,
        },
      },
    ]);
  }

  queueDbService.addTriggerEntry(entryId, triggerId, configStr, title, tag).catch(() => {});
}).catch(() => {});

function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

listen<{ url: string; position?: 'end' | 'next'; duration?: number }>(
  'module:queue-add-url',
  (event) => {
    const { url, position, duration } = event.payload;
    if (position === 'next') {
      void useQueueStore.getState().playUrlNext(url, duration);
      return;
    }
    void useQueueStore.getState().addUrlToQueue(url, duration);
  }
).catch(() => {});

export async function createHost(
  manifest: ModuleManifest,
  openCommandPalette: (prefilter?: string) => void,
): Promise<LumenHost> {
  const appVersion = await getVersion().catch(() => '0.0.0');
  const id = manifest.id;

  return {
    meta: { id, version: manifest.version },
    window: 'main',
    app: { version: appVersion, locale: useI18nStore.getState().locale || navigator.language },

    panels: createPanelsAPI(id),
    commands: createCommandsAPI(),
    menus: createMenusAPI(),
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
    overlay: createOverlayHostAPI(),
    surface: createSurfaceHostAPI(id),
    themes: createThemesHostAPI(id),
    fonts: createFontsAPI(),

    fs: createFsAPI(id),
    net: createNetAPI(id),
    i18n: createI18nAPI(),
    log: createLoggerAPI(id),
  };
}
