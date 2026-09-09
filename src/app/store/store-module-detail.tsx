import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import type React from 'react';
import { useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';
import { useModuleStore } from '@/modules/store';
import type { ModuleManifest } from '@/modules/types';
import {
  catalogAssetUrl,
  compareVersions,
  type StoreCatalogModule,
} from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';
import { Markdown } from './markdown';
import { installFromStore } from './store-actions';
import { useModuleManifest, useModuleReadme, useModuleRelease } from './use-store-data';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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

  const iconSrc = catalogAssetUrl(module.icon);
  const coverSrc = catalogAssetUrl(module.cover);

  let action: React.ReactNode;
  if (progress?.phase === 'downloading') {
    action = (
      <div className="flex w-full max-w-[260px] flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('Installing')}…</span>
          <span>{Math.round(progress.progress * 100)}%</span>
        </div>
        <Progress value={Math.round(progress.progress * 100)} />
      </div>
    );
  } else if (progress?.phase === 'installing') {
    action = (
      <Button size="default" disabled className="w-full max-w-[220px]">
        <Loader2 className="animate-spin" /> {t('Installing')}…
      </Button>
    );
  } else if (!installed) {
    action = (
      <div className="flex flex-col gap-1.5">
        <Button
          size="default"
          className="w-full max-w-[220px]"
          onClick={() => void installFromStore(module)}
        >
          {t('Install')}
        </Button>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <kbd className="inline-flex h-4 items-center rounded-sm bg-muted px-1 font-sans text-[10px]">
            {IS_MAC ? '⌘' : 'Ctrl'}↵
          </kbd>
          {t('Install with the shortcut')}
        </span>
      </div>
    );
  } else if (updateAvailable) {
    action = (
      <div className="flex flex-col gap-1.5">
        <Button
          size="default"
          className="w-full max-w-[220px]"
          onClick={() => void installFromStore(module)}
        >
          <CheckCircle2 /> {t('Update to')} v{latestTag!.replace(/^v/i, '')}
        </Button>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <kbd className="inline-flex h-4 items-center rounded-sm bg-muted px-1 font-sans text-[10px]">
            {IS_MAC ? '⌘' : 'Ctrl'}↵
          </kbd>
          {t('Update with the shortcut')}
        </span>
      </div>
    );
  } else {
    action = (
      <Button size="default" variant="secondary" disabled className="w-full max-w-[220px]">
        <CheckCircle2 /> {t('Installed')} · v{installed!.version.replace(/^v/i, '')}
      </Button>
    );
  }

  return (
    <ScrollArea
      className="max-h-[420px]"
      viewportClassName="!h-auto max-h-[420px] pr-3 focus-visible:ring-0 focus-visible:outline-none"
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
          <Avatar size="lg" className="size-12 rounded-lg after:rounded-lg">
            {iconSrc ? (
              <AvatarImage src={iconSrc} alt={module.name} />
            ) : (
              <AvatarFallback>{module.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            )}
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{module.name}</h2>
              {module.lumenVerified && (
                <Badge variant="secondary" title={t('Lumen verified')}>
                  <ShieldCheck className="size-3" /> {t('Verified')}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('by')} {module.author.name}
              {module.license ? ` · ${module.license}` : ''}
              {latestTag ? ` · v${latestTag.replace(/^v/i, '')}` : ''}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {module.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Repository')}
            onClick={() => void openUrl(`https://github.com/${module.repo}`)}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>

        {module.description && (
          <p className="text-sm text-muted-foreground">{module.description}</p>
        )}

        {action}

        <div className="flex flex-col gap-3">
          <Details module={module} />
          <Permissions manifest={manifestQ.data ?? null} isLoading={manifestQ.isLoading} />
        </div>

        <div className="flex flex-col gap-2">
          {readmeQ.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
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

function Details({ module }: { module: StoreCatalogModule }) {
  return (
    <div className="flex flex-col rounded-lg border border-border p-3">
      <h3 className="text-xs font-medium text-muted-foreground">{t('Details')}</h3>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{t('Author')}</dt>
          <dd className="text-foreground">{module.author.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{t('License')}</dt>
          <dd className="text-foreground">{module.license ?? '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{t('Repository')}</dt>
          <dd className="truncate text-foreground">{module.repo}</dd>
        </div>
      </dl>
    </div>
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
