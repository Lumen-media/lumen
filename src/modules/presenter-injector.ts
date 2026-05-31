import { invoke } from '@tauri-apps/api/core';
import { createPresenterHost } from './presenter-host';
import type { LumenPlugin, ModuleManifest } from './types';

export async function bootPresenterModules() {
  let manifests: Array<{ manifest: ModuleManifest }> = [];

  try {
    manifests = await invoke<Array<{ manifest: ModuleManifest; source: string }>>('module_list_installed');
  } catch (err) {
    console.error('[presenter] failed to list modules:', err);
    return;
  }

  for (const { manifest } of manifests) {
    try {
      const res = await fetch(`/__modules/${manifest.id}/${manifest.entry}?t=${Date.now()}`);
      if (!res.ok) continue;

      const code = await res.text();
      const blob = new Blob([code], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      try {
        const mod = await import(/* @vite-ignore */ blobUrl) as { default: new () => LumenPlugin };
        const plugin = new mod.default();
        plugin.manifest = manifest;
        const host = await createPresenterHost(manifest);
        await plugin.onload(host);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      console.error(`[presenter] failed to load module ${manifest.id}:`, err);
    }
  }
}
