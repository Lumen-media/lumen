import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, CloudOff, Layers, PackageOpen, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useModuleStore } from '@/modules/store';
import {
  catalogAssetUrl,
  compareVersions,
  type StoreCatalogModule,
} from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';
import { installFromStore } from './store-actions';
import { useCachedReleases, useModuleRelease, useStoreCatalog } from './use-store-data';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

interface StoreBrowseProps {
  query?: string;
  onOpenModule: (module: StoreCatalogModule) => void;
  onManage: () => void;
}

type BrowseRow = { kind: 'installed' } | { kind: 'module'; module: StoreCatalogModule };

function ModuleIcon({ module }: { module: StoreCatalogModule }) {
  const iconSrc = catalogAssetUrl(module.icon);
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-300">
      {iconSrc ? (
        <img src={iconSrc} alt={module.name} className="size-6" />
      ) : (
        <span className="text-[11px] font-semibold">{module.name.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

function AuthorAvatar({ module }: { module: StoreCatalogModule }) {
  const src = `${module.author.url.replace(/\/+$/, '')}.png`;
  return (
    <TooltipProvider delay={400}>
      <Tooltip>
        <TooltipTrigger
          render={
            <img
              src={src}
              alt=""
              className="size-6 shrink-0 rounded-full border border-border/60 bg-muted"
            />
          }
        />
        <TooltipContent side="left">
          {t('by')} {module.author.name}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function UpdateBadge({ module }: { module: StoreCatalogModule }) {
  const { data } = useModuleRelease(module.repo);
  const installed = useModuleStore((s) => s.modules.get(module.id)?.manifest.version);

  if (!data?.release?.tagName || !installed) return null;
  if (compareVersions(data.release.tagName, installed) > 0) {
    return (
      <Badge variant="default" className="text-[10px]">
        {t('Update')} v{data.release.tagName.replace(/^v/i, '')}
      </Badge>
    );
  }
  return null;
}

function RowActions({ module }: { module: StoreCatalogModule }) {
  const installed = useModuleStore((s) => s.modules.get(module.id)?.manifest.version);
  const progress = useModulesStore((s) => s.progress[module.id]);

  if (progress?.phase === 'downloading' || progress?.phase === 'installing') {
    return (
      <div className="flex w-28 flex-col items-end gap-1">
        <Progress value={Math.round(progress.progress * 100)} className="h-1 w-24" />
        <span className="text-[10px] text-muted-foreground">{t('Installing')}…</span>
      </div>
    );
  }

  if (!installed) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Kbd className="opacity-60">{IS_MAC ? '⌘' : 'Ctrl'}↵</Kbd>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            void installFromStore(module);
          }}
        >
          {t('Install')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <UpdateBadge module={module} />
    </div>
  );
}

export function StoreBrowse({ query, onOpenModule, onManage }: StoreBrowseProps) {
  const { catalog, loading, error, stale, refresh } = useStoreCatalog();
  const installedCount = useModuleStore((s) => s.modules.size);
  const releaseDates = useCachedReleases();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const source = (catalog?.modules ?? []).filter((m) => m.status === 'approved');
    const q = (query ?? '').trim().toLowerCase();
    return source
      .filter((m) => {
        if (selectedTag && !m.tags.includes(selectedTag)) return false;
        if (!q) return true;
        const hay = [m.name, m.tagline ?? '', m.description ?? '', m.author.name, ...m.tags]
          .join(' ')
          .toLowerCase();
        return q.split(/\s+/).every((tok) => hay.includes(tok));
      })
      .sort((a, b) =>
        (releaseDates[b.repo] ?? b.approvedAt ?? '').localeCompare(
          releaseDates[a.repo] ?? a.approvedAt ?? ''
        )
      );
  }, [catalog, query, selectedTag, releaseDates]);

  const rows = useMemo<BrowseRow[]>(
    () => [
      { kind: 'installed' },
      ...filtered.map((module) => ({ kind: 'module', module }) as const),
    ],
    [filtered]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'installed' ? 52 : 62),
    overscan: 6,
  });

  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(0, filtered.length)));
  }, [filtered.length]);

  useEffect(() => {
    if (selected >= 0 && selected < rows.length) {
      virtualizer.scrollToIndex(selected, { align: 'auto' });
    }
  }, [selected, rows.length, virtualizer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, rows.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, [role="button"]')) return;
        e.preventDefault();
        const row = rows[selected];
        if (row?.kind === 'installed') onManage();
        else if (row?.kind === 'module') onOpenModule(row.module);
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rows, selected, onManage, onOpenModule]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const m of catalog?.modules ?? []) for (const tag of m.tags) set.add(tag);
    return Array.from(set).sort();
  }, [catalog]);

  if (loading && !catalog) {
    return (
      <div className="flex flex-col gap-2 p-1">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error && !catalog) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <PackageOpen className="size-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => refresh(true)}>
          <RefreshCw className="size-3.5" /> {t('Try again')}
        </Button>
      </div>
    );
  }

  const showStale = !!catalog && (!!error || stale);

  return (
    <div className="flex flex-col gap-2">
      {showStale && (
        <div className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-[11px] text-amber-300">
          <CloudOff className="size-3 shrink-0" />
          {t('Stale — showing cached catalog')}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 pb-2">
        {[{ id: null, label: t('All') }, ...tags.map((tag) => ({ id: tag, label: tag }))].map(
          (chip) => {
            const active = selectedTag === chip.id || (chip.id === null && selectedTag === null);
            return (
              <button
                key={chip.id ?? 'all'}
                type="button"
                onClick={() => setSelectedTag(chip.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                )}
              >
                <span>{chip.label}</span>
              </button>
            );
          }
        )}
      </div>

      <ScrollArea
        ref={scrollRef}
        className="max-h-105"
        viewportClassName="!h-auto max-h-[420px] px-2 pb-2 pr-2 focus-visible:ring-0 focus-visible:outline-none"
      >
        <div role="listbox" aria-label={t('Module Store')}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index];
              if (!row) return null;
              const isSelected = v.index === selected;
              const notLast = v.index !== rows.length - 1;
              return (
                <div
                  key={row.kind === 'module' ? row.module.id : 'installed'}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${v.start}px)`,
                  }}
                  className={`pb-1.5 ${notLast ? 'border-b border-border/40' : ''}`}
                >
                  {row.kind === 'installed' ? (
                    <div
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      onMouseMove={() => setSelected(v.index)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a, [role="button"]')) return;
                        onManage();
                      }}
                      className={cn(
                        'group/row flex w-full cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors',
                        isSelected
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-transparent hover:border-primary/20 hover:bg-primary/5'
                      )}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-300">
                        <Layers className="size-4" />
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                        {t('Installed')}
                        {installedCount > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {installedCount}
                          </Badge>
                        )}
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  ) : (
                    <div
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={-1}
                      onMouseMove={() => setSelected(v.index)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a, [role="button"]')) return;
                        onOpenModule(row.module);
                      }}
                      className={cn(
                        'group/row flex w-full cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors',
                        isSelected
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-transparent hover:border-primary/20 hover:bg-primary/5'
                      )}
                    >
                      <ModuleIcon module={row.module} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {row.module.name}
                          </span>
                          {row.module.lumenVerified && (
                            <Badge variant="secondary" className="text-[9px]">
                              ✓
                            </Badge>
                          )}
                        </div>
                        {row.module.tagline && (
                          <span className="truncate text-xs text-muted-foreground">
                            {row.module.tagline}
                          </span>
                        )}
                      </div>
                      <RowActions module={row.module} />
                      <AuthorAvatar module={row.module} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <PackageOpen className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('No modules found')}</p>
        </div>
      )}
    </div>
  );
}
