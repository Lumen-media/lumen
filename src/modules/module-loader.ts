import { invoke } from '@tauri-apps/api/core';
import type { ModuleManifest } from './types';

/** Decodes the byte shapes the Rust side can return for a module entry. */
export function decodeModuleCode(bytes: ArrayBuffer | Uint8Array | number[]): string {
  if (bytes instanceof Uint8Array) return new TextDecoder().decode(bytes);
  if (Array.isArray(bytes)) return new TextDecoder().decode(new Uint8Array(bytes));
  return new TextDecoder().decode(bytes);
}

/**
 * Fetches a module's entry source.
 *
 * In dev the Vite plugin serves it from `/__modules/`; in a production build it
 * is read through the sandboxed `module_fs_read` command. Defaults to
 * `main.js` when the manifest omits `entry`.
 */
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

/**
 * Evaluates module source as an ES module via a temporary blob URL.
 *
 * `sourceUrl` is appended as a `//# sourceURL` comment so devtools shows a
 * meaningful name instead of a blob url. The object URL is always revoked.
 */
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