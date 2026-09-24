import { invoke } from '@tauri-apps/api/core';
import type { ModuleManifest } from './types';

export function decodeModuleCode(bytes: ArrayBuffer | Uint8Array | number[]): string {
  if (bytes instanceof Uint8Array) return new TextDecoder().decode(bytes);
  if (Array.isArray(bytes)) return new TextDecoder().decode(new Uint8Array(bytes));
  return new TextDecoder().decode(bytes);
}

export async function readModuleEntry(manifest: ModuleManifest): Promise<string> {
  const entry = manifest.entry || 'main.js';

  if (import.meta.env.DEV) {
    const res = await fetch(`/__modules/${manifest.id}/${entry}`);
    if (!res.ok) throw new Error(`module fetch failed: ${res.status}`);
    return res.text();
  }

  const bytes = await invoke<ArrayBuffer | number[]>('module_fs_read', {
    moduleId: manifest.id,
    path: entry,
  });
  return decodeModuleCode(bytes);
}

export async function importModuleCode(
  code: string,
  sourceUrl?: string,
): Promise<unknown> {
  const blobSource = sourceUrl ? `${code}\n//# sourceURL=${sourceUrl}` : code;
  const blob = new Blob([blobSource], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}