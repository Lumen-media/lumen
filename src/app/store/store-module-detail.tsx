import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useModuleStore } from '@/modules/store';
import type { ModuleManifest } from '@/modules/types';
import {
  catalogAssetUrl,
  compareVersions,
  type StoreCatalogModule,
} from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';
import { Markdown } from './markdown';
import { ModuleIcon } from './module-icon';
import { installFromStore } from './store-actions';
import { useModuleManifest, useModuleReadme, useModuleRelease } from './use-store-data';

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 31) + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type SkeletonBlock =
  | { type: 'title' }
  | { type: 'image'; height: string }
  | { type: 'paragraph'; lines: number[] }
  | { type: 'list'; items: number[] }
  | { type: 'table'; rows: number }
  | { type: 'code'; height: string };

function ReadmeSkeleton({ seed }: { seed: string }) {
  const rand = useMemo(() => seededRandom(hashString(seed)), [seed]);

  const blocks = useMemo<SkeletonBlock[]>(() => {
    const all: SkeletonBlock[] = [];
    if (rand() > 0.5) all.push({ type: 'title' });
    if (rand() > 0.35) {
      all.push({ type: 'image', height: rand() > 0.5 ? 'h-24' : 'h-32' });
    }
    const lines = Array.from(
      { length: 3 + Math.floor(rand() * 8) },
      () => 0.45 + Math.floor(rand() * 5) / 10
    );
    all.push({ type: 'paragraph', lines });
    if (rand() > 0.5) {
      all.push({
        type: 'list',
        items: Array.from(
          { length: 2 + Math.floor(rand() * 3) },
          () => 0.35 + Math.floor(rand() * 4) / 10
        ),
      });
    }
    if (rand() > 0.5) all.push({ type: 'table', rows: 2 + Math.floor(rand() * 3) });
    if (rand() > 0.5) all.push({ type: 'code', height: rand() > 0.5 ? 'h-16' : 'h-20' });
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  }, [rand]);

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'title':
            return <Skeleton key={i} className="h-5 w-2/5" />;
          case 'image':
            return (
              <div
                key={i}
                className={cn(
                  'flex items-center animate-pulse justify-center rounded-lg border border-border/60 bg-muted/50',
                  block.height
                )}
              >
                <ImageIcon className="size-6 text-muted-foreground/40" />
              </div>
            );
          case 'paragraph':
            return (
              <div key={i} className="flex flex-col gap-2">
                {block.lines.map((w, j) => (
                  <Skeleton
                    key={j}
                    className="h-3.5"
                    style={{ width: `${Math.round(w * 100)}%` }}
                  />
                ))}
              </div>
            );
          case 'list':
            return (
              <div key={i} className="flex flex-col gap-1.5">
                {block.items.map((w, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <Skeleton className="size-2 shrink-0 rounded-full" />
                    <Skeleton className="h-3" style={{ width: `${Math.round(w * 100)}%` }} />
                  </div>
                ))}
              </div>
            );
          case 'table':
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex gap-2 border-b border-border/60 pb-1.5">
                  {[0, 1, 2].map((c) => (
                    <Skeleton key={c} className="h-4 flex-1" />
                  ))}
                </div>
                {Array.from({ length: block.rows }, (_, r) => (
                  <div key={r} className="flex gap-2">
                    <Skeleton className="h-3.5 flex-1" />
                    <Skeleton className="h-3.5 flex-1" />
                    <Skeleton className="h-3.5 flex-1" />
                  </div>
                ))}
              </div>
            );
          case 'code':
            return <Skeleton key={i} className={cn('w-full rounded-lg', block.height)} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export function StoreModuleDetail({ module }: { module: StoreCatalogModule }) {
  const release = useModuleRelease(module.repo);
  const manifestQ = useModuleManifest(module.repo);
  const readmeQ = useModuleReadme(module.repo);
  const installed = useModuleStore((s) => s.modules.get(module.id)?.manifest);
  const progress = useModulesStore((s) => s.progress[module.id]);

  const latestTag = release.data?.release?.tagName;
  const updateAvailable =
    !!installed && !!latestTag && compareVersions(latestTag, installed.version) > 0;
  const busy = progress?.phase === 'downloading' || progress?.phase === 'installing';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, [role="button"]')) return;
        e.preventDefault();
        if (busy) return;
        if (!installed || updateAvailable) {
          void installFromStore(module);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [module, installed, updateAvailable, busy]);

  const coverSrc = catalogAssetUrl(module.cover);

  let action: React.ReactNode;
  if (progress?.phase === 'downloading') {
    action = (
      <div className="flex w-48 flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('Installing')}…</span>
          <span>{Math.round(progress.progress * 100)}%</span>
        </div>
        <Progress value={Math.round(progress.progress * 100)} />
      </div>
    );
  } else if (progress?.phase === 'installing') {
    action = (
      <Button size="default" disabled>
        <Loader2 className="animate-spin" /> {t('Installing')}…
      </Button>
    );
  } else if (!installed) {
    action = (
      <div className="flex flex-col items-end gap-1.5">
        <Button size="default" onClick={() => void installFromStore(module)}>
          {t('Install')}
        </Button>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <kbd className="inline-flex h-4 items-center rounded-sm bg-muted px-1 font-sans text-[10px]">
            ↵
          </kbd>
          {t('Install with the shortcut')}
        </span>
      </div>
    );
  } else if (updateAvailable) {
    action = (
      <div className="flex flex-col items-end gap-1.5">
        <Button size="default" onClick={() => void installFromStore(module)}>
          <CheckCircle2 /> {t('Update to')} v{latestTag!.replace(/^v/i, '')}
        </Button>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <kbd className="inline-flex h-4 items-center rounded-sm bg-muted px-1 font-sans text-[10px]">
            ↵
          </kbd>
          {t('Update with the shortcut')}
        </span>
      </div>
    );
  } else {
    action = (
      <Button size="default" variant="secondary" disabled>
        <CheckCircle2 /> {t('Installed')}
      </Button>
    );
  }

  return (
    <ScrollArea
      className="max-h-105"
      viewportClassName="h-auto max-h-105 px-3 focus-visible:ring-0 focus-visible:outline-none"
    >
      <div className="flex flex-col gap-4">
        {coverSrc && (
          <img
            src={coverSrc}
            alt={module.name}
            className="h-28 w-full rounded-lg border border-border/60 object-cover"
          />
        )}
        <div className="flex items-start gap-3">
          <ModuleIcon
            name={module.name}
            icon={module.icon}
            boxClassName="size-17 rounded-lg"
            iconClassName="size-7"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{module.name}</h2>
              {manifestQ.data?.version && (
                <span className="text-xs font-medium text-muted-foreground opacity-70">
                  v{manifestQ.data.version.replace(/^v/i, '')}
                </span>
              )}
              {module.lumenVerified && (
                <Badge variant="secondary" title={t('Lumen verified')}>
                  <ShieldCheck className="size-3" /> {t('Verified')}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('by')} {module.author.name}
              {module.license ? ` · ${module.license}` : ''}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {module.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Repository')}
              onClick={() => void openUrl(`https://github.com/${module.repo}`)}
            >
              <ExternalLink className="size-3.5" />
            </Button>
            {action}
          </div>
        </div>

        {module.description && (
          <p className="text-sm text-muted-foreground">{module.description}</p>
        )}

        {manifestQ.data?.permissions?.network.length && (
          <div className="flex flex-col gap-3">
            <Permissions manifest={manifestQ.data ?? null} isLoading={manifestQ.isLoading} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {readmeQ.isLoading ? (
            <div className="rounded-lg border border-border p-4">
              <ReadmeSkeleton seed={module.id} />
            </div>
          ) : readmeQ.data?.content ? (
            <div className="rounded-lg border border-border p-4">
              <Markdown source={readmeQ.data.content} className="store-readme" />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('No README provided')}</p>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function Permissions({
  manifest,
  isLoading,
}: {
  manifest: ModuleManifest | null;
  isLoading: boolean;
}) {
  const networks = manifest?.permissions?.network ?? [];
  return (
    <div className="flex flex-col rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="size-3.5 text-muted-foreground" />
        <h3 className="text-xs font-medium text-muted-foreground">{t('Permissions')}</h3>
      </div>
      {isLoading ? (
        <Skeleton className="mt-2 h-4 w-40" />
      ) : networks.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {networks.map((host) => (
            <li key={host} className="flex items-center gap-1.5 text-xs font-mono text-foreground">
              <ShieldCheck className="size-3 text-muted-foreground" />
              {host}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('No special permissions')}</p>
      )}
    </div>
  );
}
