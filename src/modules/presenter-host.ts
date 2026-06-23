import { createDataAPI } from './apis/data';
import { createFsAPI } from './apis/fs';
import { createI18nAPI } from './apis/i18n';
import { createLoggerAPI } from './apis/logger';
import { createNetAPI } from './apis/net';
import { createPanelsAPI } from './apis/panels';
import type { Disposable, LumenHost, ModuleManifest } from './types';

const noop = () => {};
const stub = <T>(v: T) => () => v;
const noopDisposable: Disposable = { dispose: noop };

export async function createPresenterHost(manifest: ModuleManifest): Promise<LumenHost> {
  const id = manifest.id;

  return {
    meta: { id, version: manifest.version },
    window: 'presenter',
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
      openBackgroundPicker: noop,
    },

    bus: { emit: noop, on: () => noopDisposable },
    events: { emit: noop, on: () => noopDisposable },

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
      state: stub('live' as const),
      onStateChange: () => noopDisposable,
      project: noop,
      clear: noop,
      isWindowOpen: stub(true),
    },
    overlay: {
      state: stub('idle' as const),
      onStateChange: () => noopDisposable,
      project: noop,
      clear: noop,
      isWindowOpen: stub(false),
    },
    fonts: {
      list: stub(Promise.resolve([] as string[])),
    },
    themes: {
      current: stub({ id: 'default', name: 'Default', colorMode: 'dark' as const, accentId: 'cyan' }),
      list: stub([]),
      apply: noop,
      defaultBackground: stub(null),
      onDefaultBackgroundChange: () => noopDisposable,
    },

    fs: createFsAPI(id),
    net: createNetAPI(),
    i18n: createI18nAPI(),
    log: createLoggerAPI(id),
  };
}
