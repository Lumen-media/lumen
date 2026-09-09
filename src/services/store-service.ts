import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { loadModule, unloadModule } from '@/modules/injector';
import { useModuleStore } from '@/modules/store';
import type { ModuleManifest, ModuleRecord } from '@/modules/types';

export interface StoreAuthor {
  name: string;
  url: string;
}

export interface StoreCatalogModule {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  tags: string[];
  author: StoreAuthor;
  license?: string;
  repo: string;
  icon?: string;
  cover?: string;
  lumenVerified?: boolean;
  status: string;
  approvedAt?: string;
}

export interface StoreCatalog {
  schemaVersion: number;
  generatedAt?: string;
  modules: StoreCatalogModule[];
}

export interface StoreCatalogResponse {
  catalog: StoreCatalog;
  stale: boolean;
  cached: boolean;
}

export interface StoreReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  size: number;
}

export interface StoreRelease {
  tagName: string;
  publishedAt?: string;
  assets: StoreReleaseAsset[];
}

export interface StoreReleaseResponse {
  release: StoreRelease | null;
  stale: boolean;
  cached: boolean;
  notFound: boolean;
}

export interface StoreReadmeResponse {
  content: string;
  resolvedLocale: string;
  stale: boolean;
  cached: boolean;
}

export interface StoreInstallResult {
  manifest: ModuleManifest;
  source: string;
  enabled: boolean;
}

export type StoreProgressPhase = 'downloading' | 'installing' | 'done' | 'error';

export interface StoreDownloadProgressPayload {
  key: string;
  phase: string;
  progress: number;
}

class StoreService {
  async fetchCatalog(): Promise<StoreCatalogResponse> {
    return invoke<StoreCatalogResponse>('store_fetch_catalog');
  }

  async getRelease(repo: string, force = false): Promise<StoreReleaseResponse> {
    return invoke<StoreReleaseResponse>('store_get_release', { repo, force });
  }

  async getReadme(
    repo: string,
    locale?: string,
    branch?: string,
  ): Promise<StoreReadmeResponse | null> {
    return invoke<StoreReadmeResponse | null>('store_get_readme', {
      repo,
      locale: locale ?? null,
      branch: branch ?? null,
    });
  }

  async getManifest(repo: string, branch?: string): Promise<ModuleManifest | null> {
    return invoke<ModuleManifest | null>('store_get_manifest', {
      repo,
      branch: branch ?? null,
    });
  }

  async downloadModule(repo: string, tag: string): Promise<string> {
    return invoke<string>('store_download_module', { repo, tag });
  }

  async installModule(repo: string, tag: string): Promise<StoreInstallResult> {
    return invoke<StoreInstallResult>('store_install', { repo, tag });
  }

  onDownloadProgress(callback: (payload: StoreDownloadProgressPayload) => void): UnlistenFn {
    const promise = listen<StoreDownloadProgressPayload>('store:download-progress', (event) =>
      callback(event.payload),
    );
    return () => {
      void promise.then((fn) => fn());
    };
  }
}

export const storeService = new StoreService();

const CATALOG_RAW_BASE = 'https://raw.githubusercontent.com/Lumen-media/community-modules/main';

export function catalogAssetUrl(path?: string): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${CATALOG_RAW_BASE}/${path.replace(/^\/+/, '')}`;
}

export function authorAvatarUrl(authorName: string, size = 64): string {
  return `https://github.com/${encodeURIComponent(authorName)}.png?size=${size}`;
}

function parseVersion(tag: string): number[] {
  const core = tag.replace(/^v/i, '').split('-')[0];
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}

export async function installModuleFromStore(
  repo: string,
  tag: string,
  expectedId: string,
): Promise<StoreInstallResult> {
  const store = useModuleStore.getState();
  const existed = store.modules.has(expectedId);
  const result = await storeService.installModule(repo, tag);

  if (existed) {
    await unloadModule(expectedId);
    store.registerModule({
      manifest: result.manifest,
      status: 'loading',
      errorCount: 0,
      source: result.source as ModuleRecord['source'],
    });
    await loadModule(result.manifest);
  }

  return result;
}