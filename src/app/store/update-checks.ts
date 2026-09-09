import type { QueryClient } from '@tanstack/react-query';
import { useModuleStore } from '@/modules/store';
import { type StoreCatalogModule, storeService } from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';

const STAGGER_MS = 1000;

let running = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function runBackgroundUpdateCheck(queryClient: QueryClient): Promise<void> {
  if (running) return;
  running = true;
  try {
    const catalogState = useModulesStore.getState();
    if (!catalogState.catalog) {
      await catalogState.loadCatalog();
    }
    const catalog = useModulesStore.getState().catalog;
    if (!catalog) return;

    const seen = new Set<string>();
    const targets: StoreCatalogModule[] = [];
    for (const record of useModuleStore.getState().modules.values()) {
      if (record.source !== 'store') continue;
      const entry = catalog.modules.find(
        (m) => m.id === record.manifest.id && m.status === 'approved'
      );
      if (entry && !seen.has(entry.repo)) {
        seen.add(entry.repo);
        targets.push(entry);
      }
    }

    for (const entry of targets) {
      try {
        const response = await storeService.getRelease(entry.repo);
        queryClient.setQueryData(['store-release', entry.repo, false], response);
      } catch {
        // keep whatever is cached
      }
      await delay(STAGGER_MS);
    }
  } finally {
    running = false;
  }
}
