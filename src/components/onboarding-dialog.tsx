import { invoke } from '@tauri-apps/api/core';
import { Sparkles } from 'lucide-react';
import * as React from 'react';
import { ModuleIcon } from '@/app/store/module-icon';
import { installFromStore } from '@/app/store/store-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n';
import { useModuleStore } from '@/modules/store';
import type { StoreCatalogModule } from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';
import { useOnboardingStore } from '@/stores/onboarding-store';

const LEGACY_STATE_KEYS = [
  'lumen-locales-cache',
  'lumen-language',
  'main-layout-panels',
  'lumen-developer-mode',
  'lumen-full-content',
  'lumen-shown-release-notes',
];

function ModuleRow({
  module,
  checked,
  disabled,
  onToggle,
}: {
  module: StoreCatalogModule;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const installed = useModuleStore((s) => s.modules.has(module.id));
  const progress = useModulesStore((s) => s.progress[module.id]);
  const busy = progress?.phase === 'downloading' || progress?.phase === 'installing';
  const checkboxId = `onboarding-module-${module.id}`;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
        checked ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card hover:bg-muted/40'
      }`}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        disabled={disabled || installed || busy}
        onCheckedChange={(next) => onToggle(next === true)}
        aria-label={module.name}
      />
      <label
        htmlFor={checkboxId}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
      >
        <ModuleIcon
          name={module.name}
          icon={module.icon}
          boxClassName="size-8"
          iconClassName="size-4.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{module.name}</span>
            {module.lumenVerified ? (
              <Badge className="shrink-0 text-[10px]">{t('Verified')}</Badge>
            ) : null}
            {installed ? (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {t('Installed')}
              </Badge>
            ) : null}
          </div>
          {module.tagline ? (
            <p className="truncate text-xs text-muted-foreground">{module.tagline}</p>
          ) : null}
        </div>
      </label>
      {busy ? (
        <div className="flex w-24 shrink-0 flex-col items-end gap-1">
          <Progress value={Math.round((progress?.progress ?? 0) * 100)} className="h-1 w-24" />
          <span className="text-[10px] text-muted-foreground">{t('Installing')}…</span>
        </div>
      ) : null}
    </div>
  );
}

export function OnboardingDialog() {
  const { t } = useTranslation();
  const open = useOnboardingStore((s) => s.open);
  const catalog = useModulesStore((s) => s.catalog);
  const catalogLoading = useModulesStore((s) => s.catalogLoading);
  const catalogError = useModulesStore((s) => s.catalogError);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [installing, setInstalling] = React.useState(false);
  const installingRef = React.useRef(false);

  React.useEffect(() => {
    const store = useOnboardingStore.getState();
    if (store.completed) return;

    let alive = true;

    const isLegacyUser = LEGACY_STATE_KEYS.some((key) => localStorage.getItem(key) !== null);
    if (isLegacyUser) {
      store.complete();
      return;
    }

    invoke<Array<{ manifest: { id: string }; source: string }>>('module_list_installed')
      .then((installed) => {
        if (!alive) return;
        if (installed.length > 0) {
          store.complete();
          return;
        }
        store.show();
        void useModulesStore.getState().loadCatalog();
      })
      .catch(() => {
        if (alive) store.show();
      });

    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const unlisten = useModulesStore.getState().bindDownloadProgress();
    return () => {
      unlisten();
    };
  }, [open]);

  const modules = React.useMemo(
    () => (catalog?.modules ?? []).filter((m) => m.status === 'approved'),
    [catalog]
  );

  const selectableIds = React.useMemo(
    () =>
      modules.filter((m) => !useModuleStore.getState().modules.has(m.id)).map((m) => m.id),
    [modules]
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (installingRef.current) return;
    useOnboardingStore.getState().complete();
  };

  const handleInstall = async () => {
    const targets = modules.filter((m) => selected.has(m.id));
    if (targets.length === 0) {
      useOnboardingStore.getState().complete();
      return;
    }
    setInstalling(true);
    installingRef.current = true;
    try {
      for (const module of targets) {
        await installFromStore(module);
      }
    } finally {
      setInstalling(false);
      installingRef.current = false;
      useOnboardingStore.getState().complete();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            {t('Welcome to Lumen')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Choose the modules you want to install. You can manage them anytime in Settings → Modules.'
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-w-0 max-h-[55vh] flex-1">
          {catalogError && modules.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t('Could not load the module catalog')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void useModulesStore.getState().loadCatalog({ force: true })}
              >
                {t('Try again')}
              </Button>
            </div>
          ) : catalogLoading && modules.length === 0 ? (
            <div className="flex flex-col gap-2 pr-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : modules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('No modules available')}
            </p>
          ) : (
            <div className="flex flex-col gap-2 pr-3">
              {modules.map((module) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  checked={selected.has(module.id)}
                  disabled={installing}
                  onToggle={(checked) => toggle(module.id, checked)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <div className="mr-auto flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {t('{{count}} selected', { count: selected.size })}
            </span>
            {modules.length > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={installing}
                onClick={handleSelectAll}
              >
                {allSelected ? t('Clear') : t('Select all')}
              </Button>
            ) : null}
          </div>
          <Button
            variant="outline"
            disabled={installing}
            onClick={() => useOnboardingStore.getState().complete()}
          >
            {t('Skip for now')}
          </Button>
          <Button
            disabled={installing || catalogLoading || modules.length === 0}
            onClick={() => void handleInstall()}
          >
            {installing ? `${t('Installing')}…` : t('Install selected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
