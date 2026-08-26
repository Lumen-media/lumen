import { createDataAPI } from './apis/data';
import { createThemesHostAPI } from './apis/domain';
import { createFsAPI } from './apis/fs';
import { createI18nAPI } from './apis/i18n';
import { createLoggerAPI } from './apis/logger';
import { createNetAPI } from './apis/net';
import { createPanelsAPI } from './apis/panels';
import { getBackgroundPickerOpener } from './apis/ui';
import { emit, listen } from '@tauri-apps/api/event';
import type { BusAPI, Disposable, LumenHost, ModuleManifest } from './types';

const noop = () => {};
const stub = <T>(v: T) => () => v;
const noopDisposable: Disposable = { dispose: noop };

type Handler = (payload: unknown) => void;

function createPresenterEvents(): BusAPI {
  const subscribers = new Map<string, Set<Handler>>();

  const localBus: BusAPI = {
    emit<T = unknown>(topic: string, payload?: T): void {
      const handlers = subscribers.get(topic);
      if (!handlers) return;
      for (const handler of handlers) {
        try { handler(payload as unknown); } catch {}
      }
    },
    on<T = unknown>(topic: string, handler: (payload: T) => void): Disposable {
      if (!subscribers.has(topic)) subscribers.set(topic, new Set());
      subscribers.get(topic)!.add(handler as Handler);
      return {
        dispose() { subscribers.get(topic)?.delete(handler as Handler); },
      };
    },
  };

  void (async () => {
    const presenterEvents = ['module:presenter-clear', 'module:presenter-window-closed'];
    for (const t of presenterEvents) {
      try {
        await listen(t, () => localBus.emit(t));
      } catch {}
    }
  })();

  return localBus;
}

export async function createPresenterHost(
  manifest: ModuleManifest,
  window: 'presenter' | 'surface' = 'presenter',
): Promise<LumenHost> {
  const id = manifest.id;

  return {
    meta: { id, version: manifest.version },
    window,
    app: { version: '0.0.0', locale: navigator.language },

    panels: createPanelsAPI(id),

    commands: {
      add: () => noopDisposable,
      invoke: stub(undefined),
      addPrefix: () => noopDisposable,
    },
    menus: {
      register: () => noopDisposable,
      addItem: () => noopDisposable,
    },
    ui: {
      notify: noop,
      confirm: stub(Promise.resolve(false)),
      prompt: stub(Promise.resolve(null)),
      openCommandPalette: noop,
      openDialog: noop,
      openBackgroundPicker: window === 'surface' ? getBackgroundPickerOpener() : noop,
    },

    bus: { emit: noop, on: () => noopDisposable },
    events: createPresenterEvents(),

    data: createDataAPI(id),
    settings: {
      register: () => noopDisposable,
      get: stub(undefined),
      set: noop,
      onChange: () => noopDisposable,
    },

    lyrics: {
      list: stub(Promise.resolve([])),
      get: stub(Promise.resolve(null)),
      currentSlide: stub(null),
      advance: noop,
      back: noop,
    },
    queue: {
      items: stub([]),
      currentIndex: stub(-1),
      add: noop, remove: noop, reorder: noop, shuffle: noop, markPlayed: noop,
      state: stub({ items: [], currentIndex: null }),
      onChange: () => noopDisposable,
      next: noop,
      previous: noop,
      goTo: noop,
      registerTrigger: () => noopDisposable,
      registerAction: () => noopDisposable,
      addTrigger: (triggerId: string, config: unknown) => {
        emit('module:queue-add-trigger', { triggerId, config }).catch(() => {});
      },
      addUrl: (input: { url: string; position?: 'end' | 'next'; duration?: number }) => {
        emit('module:queue-add-url', input).catch(() => {});
        return Promise.resolve();
      },
    },
    library: {
      list: stub(Promise.resolve([])),
      get: stub(Promise.resolve(null)),
      metadata: stub(Promise.resolve({})),
      thumbnail: stub(Promise.resolve('')),
    },
    player: {
      current: stub(null),
      state: stub('idle' as const),
      play: noop, pause: noop, seek: noop,
      volume: stub(1),
      next: noop, prev: noop,
    },
    presentation: {
      state: stub('idle' as const),
      onStateChange: () => noopDisposable,
      project:
        window === 'surface'
          ? (viewId: string, props?: unknown) => {
              emit('module:surface-presenter-project', { viewId, props }).catch(() => {});
            }
          : noop,
      requestPresenterControls: noop,
      controls: {
        slides: noop,
      },
      clear:
        window === 'surface'
          ? () => {
              emit('module:surface-presenter-clear').catch(() => {});
            }
          : noop,
      isWindowOpen: stub(false),
    },
    overlay: {
      state: stub('idle' as const),
      onStateChange: () => noopDisposable,
      project: noop,
      clear: noop,
      isWindowOpen: stub(false),
    },
    surface: {
      state: stub(window === 'surface' ? 'live' as const : 'idle' as const),
      onStateChange: () => noopDisposable,
      openWindow: async () => {},
      clear: noop,
      isWindowOpen: stub(window === 'surface'),
    },
    fonts: {
      list: stub(Promise.resolve([] as string[])),
    },
    themes: createThemesHostAPI(id),

    fs: createFsAPI(id),
    net: createNetAPI(id),
    i18n: createI18nAPI(),
    log: createLoggerAPI(id),
  };
}
