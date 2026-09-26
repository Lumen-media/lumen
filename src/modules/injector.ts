import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createHost } from './host';
import { importModuleCode, readModuleEntry } from './module-loader';
import { useModuleStore } from './store';
import type { Disposable, LumenPlugin, ModuleManifest } from './types';

const CRASH_THRESHOLD = 5;
const CRASH_WINDOW_MS = 10_000;

let globalHandlersInstalled = false;

interface LoadedModule {
  plugin: LumenPlugin;
  disposables: Disposable[];
  errorTimestamps: number[];
}

const loaded = new Map<string, LoadedModule>();

let openCommandPaletteFn: (prefilter?: string) => void = () => {};

/** Injected by the app shell so the host can open the command palette. */
export function setOpenCommandPalette(fn: (prefilter?: string) => void) {
  openCommandPaletteFn = fn;
}

function attributeToModule(error: Error | null | undefined): string | null {
  const stack = error?.stack ?? '';
  const match = stack.match(/lumen-module:\/\/([^/\s]+)/);
  return match?.[1] ?? null;
}

function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    const id = attributeToModule(event.error instanceof Error ? event.error : null);
    if (id) {
      recordError(id);
      event.preventDefault();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason instanceof Error ? event.reason : null;
    const id = attributeToModule(err);
    if (id) {
      recordError(id);
      event.preventDefault();
    }
  });
}

function scopeModuleStyles(moduleId: string) {
  const styleEl = document.head.querySelector<HTMLStyleElement>(
    `style[data-module="${CSS.escape(moduleId)}"]`,
  );
  if (styleEl?.textContent) {
    styleEl.textContent = `@scope ([data-module-scope="${moduleId}"]) {\n${styleEl.textContent}\n}`;
  }
}

/**
 * Loads every enabled module.
 *
 * Installs the global error handlers on the first call, then resolves the
 * module list from the Rust side and loads each one. A module that throws is
 * marked `faulted` and the rest still load.
 */
export async function bootModules() {
  if (!globalHandlersInstalled) {
    installGlobalErrorHandlers();
    globalHandlersInstalled = true;
  }

  let manifests: Array<{ manifest: ModuleManifest; source: string }> = [];

  try {
    manifests = await invoke<Array<{ manifest: ModuleManifest; source: string }>>(
      'module_list_installed',
    );
  } catch (err) {
    console.error('[injector] failed to list modules:', err);
    return;
  }

  for (const { manifest, source } of manifests) {
    useModuleStore.getState().registerModule({
      manifest,
      status: 'loading',
      errorCount: 0,
      source: source as 'bundled' | 'store' | 'sideload' | 'dev',
    });
    await loadModule(manifest);
  }

  startModuleEventListeners();
}

let eventListenersStarted = false;

function startModuleEventListeners() {
  if (eventListenersStarted) return;
  eventListenersStarted = true;

  listen<{ manifest: ModuleManifest; source: string; enabled: boolean }>('module:installed', (event) => {
    const { manifest, source } = event.payload;
    const store = useModuleStore.getState();
    if (store.modules.has(manifest.id)) return;
    store.registerModule({
      manifest,
      status: 'loading',
      errorCount: 0,
      source: source as 'bundled' | 'store' | 'sideload' | 'dev',
    });
    loadModule(manifest);
  });

  listen<string>('module:reload', (event) => {
    reloadModule(event.payload);
  });

  listen<string>('module:uninstalled', (event) => {
    const id = event.payload;
    const entry = loaded.get(id);
    if (entry) {
      unloadModule(id).then(() => {
        useModuleStore.getState().removeModule(id);
      });
    } else {
      useModuleStore.getState().removeModule(id);
    }
  });

  listen<string>('module:disabled', (event) => {
    const id = event.payload;
    unloadModule(id).then(() => {
      useModuleStore.getState().setStatus(id, 'disabled');
    });
  });
}

/**
 * Reads, evaluates and invokes a module's `onload`.
 *
 * On failure the record becomes `faulted` with `error`/`errorAt` set and
 * `errorCount` incremented; the loader disables a module once it passes the
 * crash quota. Never throws for a module-level failure.
 */
export async function loadModule(manifest: ModuleManifest) {
  const store = useModuleStore.getState();

  try {
    const code = await readModuleEntry(manifest);
    let mod: unknown;
    try {
      mod = await importModuleCode(
        code,
        `lumen-module://${manifest.id}/${manifest.entry || 'main.js'}`,
      );
    } catch (err) {
      throw new Error(
        `failed to evaluate module ${manifest.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const PluginClass = (mod as { default: new () => LumenPlugin }).default;

    const plugin = new PluginClass();
    plugin.manifest = manifest;

    const disposables: Disposable[] = [];
    const host = await createHost(manifest, openCommandPaletteFn);

    const trackedHost = wrapHostForTracking(host, disposables);

    await plugin.onload(trackedHost);

    scopeModuleStyles(manifest.id);

    loaded.set(manifest.id, { plugin, disposables, errorTimestamps: [] });
    store.setStatus(manifest.id, 'active');
  } catch (err) {
    console.error(`[injector] failed to load module ${manifest.id}:`, err);
    store.setStatus(
      manifest.id,
      'faulted',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Runs `onunload` and disposes everything the module registered.
 * No-op when the module was never loaded.
 */
export async function unloadModule(id: string) {
  const entry = loaded.get(id);
  if (!entry) return;

  try {
    await entry.plugin.onunload();
  } catch (err) {
    console.error(`[injector] onunload error for ${id}:`, err);
  }

  for (const disposable of entry.disposables) {
    try {
      disposable.dispose();
    } catch (err) {
      console.error(`[injector] dispose error for ${id}:`, err);
    }
  }

  loaded.delete(id);
  try {
    await invoke('module_data_sqlite_close', { moduleId: id });
  } catch {
    // connection may not have been opened
  }
  useModuleStore.getState().removePanelsForModule(id);
  useModuleStore.getState().setStatus(id, 'disabled');
}

/** Unloads then loads a module in place, keeping its enabled state. */
export async function reloadModule(id: string) {
  await unloadModule(id);
  const record = useModuleStore.getState().modules.get(id);
  if (record) {
    useModuleStore.getState().setStatus(id, 'loading');
    await loadModule(record.manifest);
  }
}

/**
 * Installs a module from a local path or archive via the Rust runtime, then
 * loads it. `devMode` keeps it sideloaded so it survives updates.
 */
export async function installModule(path: string, devMode = false) {
  const result = await invoke<{ manifest: ModuleManifest; source: string; enabled: boolean }>(
    'module_install', { path, devMode }
  );
  if (!result) return;

  useModuleStore.getState().registerModule({
    manifest: result.manifest,
    status: 'loading',
    errorCount: 0,
    source: result.source as 'bundled' | 'store' | 'sideload' | 'dev',
  });
  await loadModule(result.manifest);
}

/** Unloads the module and marks it disabled in the persisted module list. */
export async function disableModule(id: string) {
  await unloadModule(id);
  await invoke('module_disable', { id });
}

/** Clears the disabled flag and loads the module again. */
export async function enableModule(id: string) {
  await invoke('module_enable', { id });
  const record = useModuleStore.getState().modules.get(id);
  if (record) {
    useModuleStore.getState().setStatus(id, 'loading');
    await loadModule(record.manifest);
  }
}

/** Unloads the module and removes it and its data from disk. */
export async function uninstallModule(id: string) {
  await unloadModule(id);
  await invoke('module_uninstall', { id });
  useModuleStore.getState().removeModule(id);
}

function recordError(id: string) {
  const entry = loaded.get(id);
  if (!entry) return;

  const now = Date.now();
  entry.errorTimestamps = entry.errorTimestamps.filter((t) => now - t < CRASH_WINDOW_MS);
  entry.errorTimestamps.push(now);
  useModuleStore.getState().incrementErrorCount(id);

  if (entry.errorTimestamps.length >= CRASH_THRESHOLD) {
    console.error(`[injector] crash quota exceeded for ${id}, auto-disabling`);
    unloadModule(id).then(() => {
      useModuleStore.getState().setStatus(
        id,
        'faulted',
        `Auto-disabled: ${CRASH_THRESHOLD} errors in ${CRASH_WINDOW_MS / 1000}s`,
      );
    });
  }
}

function wrapCallback<T extends (...args: never[]) => unknown>(
  id: string,
  fn: T,
): T {
  return ((...args: Parameters<T>) => {
    try {
      return fn(...args);
    } catch (err) {
      console.error(`[injector] callback error in ${id}:`, err);
      recordError(id);
      return undefined;
    }
  }) as T;
}

function wrapDisposable(id: string, d: Disposable): Disposable {
  return {
    dispose() {
      try {
        d.dispose();
      } catch (err) {
        console.error(`[injector] dispose error in ${id}:`, err);
      }
    },
  };
}

function wrapHostForTracking(
  host: ReturnType<typeof createHost> extends Promise<infer T> ? T : never,
  disposables: Disposable[],
) {
  const id = host.meta.id;

  function track<T extends Disposable>(d: T): T {
    const wrapped = wrapDisposable(id, d);
    disposables.push(wrapped);
    return d;
  }

  return {
    ...host,

    panels: {
      add(spec: Parameters<typeof host.panels.add>[0]) {
        return track(host.panels.add(spec));
      },
    },

    commands: {
      ...host.commands,
      add(spec: Parameters<typeof host.commands.add>[0]) {
        const wrappedSpec = spec.run
          ? { ...spec, run: wrapCallback(id, spec.run) }
          : spec;
        return track(host.commands.add(wrappedSpec));
      },
    },

    menus: {
      register(spec: Parameters<typeof host.menus.register>[0]) {
        return track(host.menus.register(spec));
      },
      addItem(menuId: string, item: Parameters<typeof host.menus.addItem>[1], priority?: number) {
        const wrappedItem = item.onClick
          ? { ...item, onClick: wrapCallback(id, item.onClick) }
          : item;
        return track(host.menus.addItem(menuId, wrappedItem, priority));
      },
    },

    bus: {
      emit: host.bus.emit.bind(host.bus),
      on<T = unknown>(topic: string, handler: (payload: T) => void) {
        return track(host.bus.on(topic, wrapCallback(id, handler)));
      },
    },

    events: {
      emit: host.events.emit.bind(host.events),
      on<T = unknown>(topic: string, handler: (payload: T) => void) {
        return track(host.events.on(topic, wrapCallback(id, handler)));
      },
    },

    settings: {
      ...host.settings,
      register(spec: Parameters<typeof host.settings.register>[0]) {
        return track(host.settings.register(spec));
      },
      onChange<T>(key: string, handler: (value: T) => void) {
        return track(host.settings.onChange(key, wrapCallback(id, handler)));
      },
    },
  } as typeof host;
}
