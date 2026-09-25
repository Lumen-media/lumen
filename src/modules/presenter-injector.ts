import { invoke } from '@tauri-apps/api/core';
import { importModuleCode, readModuleEntry } from './module-loader';
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
  let code: string;
  try {
    code = await readModuleEntry(manifest);
  } catch (err) {
    console.error(`[presenter] failed to read module ${manifest.id}:`, err);
    return;
  }

  try {
    const mod = await importModuleCode(
      code,
      `lumen-module://${manifest.id}/${manifest.entry || 'main.js'}`,
    ) as { default: new () => LumenPlugin };
    const plugin = new mod.default();
    plugin.manifest = manifest;
    const host = await createPresenterHost(manifest, window);
    await plugin.onload(host);
  } catch (err) {
    console.error(`[presenter] failed to boot module ${manifest.id}:`, err);
  }
}
