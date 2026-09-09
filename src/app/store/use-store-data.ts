import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useI18nStore } from '@/lib/i18n';
import { storeService } from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';

export function useCachedReleases(): Record<string, string> {
  const queryClient = useQueryClient();
  const [dates, setDates] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = () => {
      const next: Record<string, string> = {};
      for (const query of queryClient.getQueryCache().getAll()) {
        const [kind, repo, force] = query.queryKey as [string, string, boolean | undefined];
        if (kind !== 'store-release' || force !== false || !repo) continue;
        const publishedAt = (query.state.data as { release?: { publishedAt?: string } } | undefined)
          ?.release?.publishedAt;
        if (publishedAt) next[repo] = publishedAt;
      }
      setDates((prev) => {
        if (
          Object.keys(next).length === Object.keys(prev).length &&
          Object.entries(next).every(([repo, date]) => prev[repo] === date)
        ) {
          return prev;
        }
        return next;
      });
    };
    read();
    return queryClient.getQueryCache().subscribe(() => queueMicrotask(read));
  }, [queryClient]);

  return dates;
}

export function useStoreCatalog() {
  const catalog = useModulesStore((s) => s.catalog);
  const catalogLoading = useModulesStore((s) => s.catalogLoading);
  const catalogError = useModulesStore((s) => s.catalogError);
  const catalogStale = useModulesStore((s) => s.catalogStale);

  useEffect(() => {
    if (!catalog && !catalogLoading) {
      void useModulesStore.getState().loadCatalog();
    }
  }, [catalog, catalogLoading]);

  const refresh = (force = true) => {
    void useModulesStore.getState().loadCatalog({ force });
  };

  return { catalog, loading: catalogLoading, error: catalogError, stale: catalogStale, refresh };
}

export function useModuleRelease(repo: string | undefined, force = false, enabled = true) {
  return useQuery({
    queryKey: ['store-release', repo, force],
    queryFn: () => storeService.getRelease(repo!, force),
    enabled: enabled && !!repo,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });
}

export function useModuleReadme(repo: string | undefined, enabled = true) {
  const locale = useI18nStore((s) => s.locale);
  return useQuery({
    queryKey: ['store-readme', repo, locale],
    queryFn: () => storeService.getReadme(repo!, locale),
    enabled: enabled && !!repo,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });
}

export function useModuleManifest(repo: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['store-manifest', repo],
    queryFn: () => storeService.getManifest(repo!),
    enabled: enabled && !!repo,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });
}
