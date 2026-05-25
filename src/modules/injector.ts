import { invoke } from '@tauri-apps/api/core';
import { createHost } from './host';
import { useModuleStore } from './store';
import type { Disposable, LumenPlugin, ModuleManifest } from './types';

const CRASH_THRESHOLD = 5;
const CRASH_WINDOW_MS = 10_000;

interface LoadedModule {
  plugin: LumenPlugin;
  disposables: Disposable[];
  errorTimestamps: number[];
}

const loaded = new Map<string, LoadedModule>();

let openCommandPaletteFn: (prefilter?: string) => void = () => {};

export function setOpenCommandPalette(fn: (prefilter?: string) => void) {
  openCommandPaletteFn = fn;
}

export async function bootModules() {
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
}

export async function loadModule(manifest: ModuleManifest) {
  const store = useModuleStore.getState();

  try {
    const mod = await import(/* @vite-ignore */ `lumen-module://${manifest.id}/${manifest.entry}`);
    const PluginClass = mod.default as new () => LumenPlugin;

    const plugin = new PluginClass();
    plugin.manifest = manifest;

    const disposables: Disposable[] = [];
    const host = await createHost(manifest, openCommandPaletteFn);

    const trackedHost = wrapHostForTracking(host, disposables);

    await plugin.onload(trackedHost);

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
  useModuleStore.getState().removePanelsForModule(id);
  useModuleStore.getState().setStatus(id, 'disabled');
}

export async function reloadModule(id: string) {
  await unloadModule(id);
  const record = useModuleStore.getState().modules.get(id);
  if (record) {
    useModuleStore.getState().setStatus(id, 'loading');
    await loadModule(record.manifest);
  }
}

export async function installModule(path: string, devMode = false) {
  await invoke('module_install', { path, devMode });
  const result = await invoke<{ manifest: ModuleManifest; source: string }>(
    'module_get',
    { id: path },
  ).catch(() => null);
  if (!result) return;

  useModuleStore.getState().registerModule({
    manifest: result.manifest,
    status: 'loading',
    errorCount: 0,
    source: result.source as 'bundled' | 'store' | 'sideload' | 'dev',
  });
  await loadModule(result.manifest);
}

export async function disableModule(id: string) {
  await unloadModule(id);
  await invoke('module_disable', { id });
}

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
        const wrappedSpec = {
          ...spec,
          run: wrapCallback(id, spec.run),
        };
        return track(host.commands.add(wrappedSpec));
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
