import { invoke } from '@tauri-apps/api/core';
import { createPresenterHost } from './presenter-host';
import type { LumenPlugin, ModuleManifest } from './types';

export async function bootPresenterModules(window: 'presenter' | 'surface' = 'presenter') {
  let manifests: Array<{ manifest: ModuleManifest }> = [];

  try {
    manifests = await invoke<Array<{ manifest: ModuleManifest; source: string }>>('module_list_installed');
  } catch (err) {
    console.error('[presenter] failed to list modules:', err);
    return;
  }

  for (const { manifest } of manifests) {
    try {
      await loadAndBootModule(manifest, window);
    } catch (err) {
      console.error(`[presenter] failed to load module ${manifest.id}:`, err);
    }
  }
}

export async function bootSingleModule(moduleId: string, window: 'presenter' | 'surface' = 'surface') {
  let installed: { manifest: ModuleManifest; source: string; enabled: boolean } | null = null;

  try {
    installed = await invoke<{ manifest: ModuleManifest; source: string; enabled: boolean } | null>('module_get', { id: moduleId });
  } catch (err) {
    console.error('[surface] failed to get module:', err);
    return;
  }

  if (!installed) {
    console.error(`[surface] module not found: ${moduleId}`);
    return;
  }

  await loadAndBootModule(installed.manifest, window);
}

async function loadAndBootModule(manifest: ModuleManifest, window: 'presenter' | 'surface') {
  const res = await fetch(`/__modules/${manifest.id}/${manifest.entry}`);
  if (!res.ok) return;

  const code = await res.text();
  const blob = new Blob([code], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    const mod = await import(/* @vite-ignore */ blobUrl) as { default: new () => LumenPlugin };
    const plugin = new mod.default();
    plugin.manifest = manifest;
    const host = await createPresenterHost(manifest, window);
    await plugin.onload(host);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
