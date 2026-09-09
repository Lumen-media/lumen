import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Package,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { disableModule, enableModule, reloadModule, uninstallModule } from '@/modules/injector';
import { useModuleStore } from '@/modules/store';
import type { ModuleRecord, ModuleStatus } from '@/modules/types';
import {
  catalogAssetUrl,
  compareVersions,
  type StoreCatalogModule,
  storeService,
} from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';
import { installFromStore } from './store-actions';
import { useModuleRelease } from './use-store-data';

function StatusBadge({ status }: { status: ModuleStatus }) {
  if (status === 'active') {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-400 border-emerald-400/30">
        <CheckCircle2 className="size-3" /> {t('Active')}
      </Badge>
    );
  }
  if (status === 'faulted') {
    return (
      <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
        <AlertTriangle className="size-3" /> {t('Faulted')}
      </Badge>
    );
  }
  if (status === 'loading') {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <RefreshCw className="size-3 animate-spin" /> {t('Loading')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <XCircle className="size-3" /> {t('Disabled')}
    </Badge>
  );
}

function SourceBadge({ source }: { source: ModuleRecord['source'] }) {
  const label =
    source === 'store'
      ? t('Store')
      : source === 'dev'
        ? t('Dev')
        : source === 'bundled'
          ? t('System')
          : t('Sideload');
  return (
    <Badge variant="secondary" className="text-[10px]">
      {label}
    </Badge>
  );
}

function UpdateControl({
  module,
  installedVersion,
}: {
  module: StoreCatalogModule;
  installedVersion: string;
}) {
  const queryClient = useQueryClient();
  const { data, isFetching } = useModuleRelease(module.repo);
  const [checking, setChecking] = useState(false);

  const check = () => {
    if (checking) return;
    setChecking(true);
    void storeService
      .getRelease(module.repo, true)
      .then((res) => queryClient.setQueryData(['store-release', module.repo, false], res))
      .finally(() => setChecking(false));
  };

  const busy = checking || isFetching;

  const canUpdate =
    !!data?.release?.tagName && compareVersions(data.release.tagName, installedVersion) > 0;

  if (canUpdate) {
    return (
      <Button size="sm" className="gap-1" onClick={() => void installFromStore(module)}>
        <Download className="size-3.5" /> {t('Update')}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Check for updates')}
        disabled={busy}
        onClick={check}
      >
        <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
      </Button>
      {data?.release?.tagName && (
        <span className="text-[10px] text-muted-foreground">{t('Up to date')}</span>
      )}
    </>
  );
}

interface ModuleRowProps {
  record: ModuleRecord;
  selected: boolean;
  onSelect: () => void;
}

function ModuleRow({ record, selected, onSelect }: ModuleRowProps) {
  const { manifest, status, source } = record;
  const entry = useModulesStore((s) =>
    s.catalog?.modules.find((m) => m.id === manifest.id && m.status === 'approved')
  );
  const iconSrc = entry ? catalogAssetUrl(entry.icon) : null;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseMove={onSelect}
      className={cn(
        'group/row mb-1.5 flex w-full cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-primary/40 bg-primary/5'
          : 'border-transparent hover:border-primary/20 hover:bg-primary/5'
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-300">
        {iconSrc ? (
          <img src={iconSrc} alt="" className="size-5" />
        ) : (
          <span className="text-[11px] font-semibold">
            {manifest.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{manifest.name}</span>
          <span className="text-[10px] text-muted-foreground">v{manifest.version}</span>
          <StatusBadge status={status} />
          <SourceBadge source={source} />
        </div>
        <p className="truncate text-xs text-muted-foreground">{manifest.id}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {entry && source !== 'dev' && (
          <UpdateControl module={entry} installedVersion={manifest.version} />
        )}
        {(status === 'faulted' || status === 'disabled') && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Reload')}
            onClick={() =>
              status === 'disabled' ? void enableModule(manifest.id) : reloadModule(manifest.id)
            }
          >
            <RefreshCw className="size-3.5" />
          </Button>
        )}
        {status === 'active' && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Disable')}
            onClick={() => void disableModule(manifest.id)}
          >
            <XCircle className="size-3.5" />
          </Button>
        )}
        {source !== 'bundled' && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Uninstall')}
            className="text-destructive hover:text-destructive"
            onClick={() => void uninstallModule(manifest.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function StoreManage() {
  const modules = useModuleStore((s) => s.modules);
  const list = useMemo(() => Array.from(modules.values()), [modules]);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(0, list.length - 1)));
  }, [list.length]);

  const activate = useCallback(
    (record: ModuleRecord) => {
      const { manifest, status } = record;
      const entry = useModulesStore
        .getState()
        .catalog?.modules.find((m) => m.id === manifest.id && m.status === 'approved');
      if (entry) {
        const release = queryClient.getQueryData<{ release?: { tagName?: string } }>([
          'store-release',
          entry.repo,
          false,
        ]);
        if (
          release?.release?.tagName &&
          compareVersions(release.release.tagName, manifest.version) > 0
        ) {
          void installFromStore(entry);
          return;
        }
      }
      if (status === 'disabled') {
        void enableModule(manifest.id);
      } else if (status === 'faulted') {
        reloadModule(manifest.id);
      } else if (status === 'active') {
        void disableModule(manifest.id);
      }
    },
    [queryClient]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (list.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, list.length - 1));
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
        activate(list[selected]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [list, selected, activate]);

  if (list.length === 0) {
    return (
      <Empty>
        <div className="flex flex-col items-center gap-2 text-center">
          <Package className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('No modules installed')}</p>
        </div>
      </Empty>
    );
  }

  return (
    <ScrollArea
      className="max-h-[420px]"
      viewportClassName="!h-auto max-h-[420px] pr-3 focus-visible:ring-0 focus-visible:outline-none"
    >
      <div role="listbox" aria-label={t('Installed')} className="flex flex-col gap-2">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 pb-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('Installed')} ({list.length})
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              const catalog = useModulesStore.getState().catalog?.modules ?? [];
              for (const record of list) {
                if (record.source !== 'store') continue;
                const entry = catalog.find(
                  (m) => m.id === record.manifest.id && m.status === 'approved'
                );
                if (!entry) continue;
                void storeService
                  .getRelease(entry.repo, true)
                  .then((res) =>
                    queryClient.setQueryData(['store-release', entry.repo, false], res)
                  );
              }
            }}
          >
            <RefreshCw className="size-3.5" />
            {t('Check for updates')}
          </Button>
        </div>
        <div className="px-1">
          {list.map((record, i) => (
            <ModuleRow
              key={record.manifest.id}
              record={record}
              selected={i === selected}
              onSelect={() => setSelected(i)}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
