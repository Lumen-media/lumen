import { Boxes } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import type { CommanderAppProps, CommandSpec } from '@/modules/types';
import type { StoreCatalogModule } from '@/services/store-service';
import { useCommandStore } from '@/stores/command-store';
import { useModulesStore } from '@/stores/modules-store';
import { StoreBrowse } from './store-browse';
import { StoreManage } from './store-manage';
import { StoreModuleDetail } from './store-module-detail';

let registered = false;

export function registerStoreCommand() {
  if (registered) return;
  registered = true;
  useCommandStore.getState()._register({
    id: 'store.open',
    title: t('Module Store'),
    subtitle: t('Discover and install community modules'),
    icon: Boxes,
    keywords: ['store', 'loja', 'modules', 'módulos', 'extensions', 'plugins'],
    type: 'app',
    component: StoreApp,
    commanderSearch: { placeholder: t('Search modules…') },
  } satisfies CommandSpec);
}

type StoreView =
  | { kind: 'browse' }
  | { kind: 'manage' }
  | { kind: 'detail'; module: StoreCatalogModule };

export function StoreApp({ query, setBackHandler }: CommanderAppProps) {
  const [view, setView] = useState<StoreView>({ kind: 'browse' });
  const viewKind = view.kind;

  useEffect(() => {
    const unsubProgress = useModulesStore.getState().bindDownloadProgress();
    void useModulesStore.getState().loadCatalog();
    return () => {
      unsubProgress();
    };
  }, []);

  useEffect(() => {
    if (viewKind === 'browse') {
      setBackHandler?.(undefined);
      return;
    }
    setBackHandler?.(() => {
      setView({ kind: 'browse' });
      return true;
    });
    return () => setBackHandler?.(undefined);
  }, [viewKind, setBackHandler]);

  if (view.kind === 'detail') {
    return <StoreModuleDetail module={view.module} />;
  }
  if (view.kind === 'manage') {
    return <StoreManage />;
  }
  return (
    <StoreBrowse
      query={query}
      onOpenModule={(module) => setView({ kind: 'detail', module })}
      onManage={() => setView({ kind: 'manage' })}
    />
  );
}
