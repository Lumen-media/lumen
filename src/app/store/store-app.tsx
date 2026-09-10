import { ArrowUpDown, Boxes, CornerDownLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FooterHint, FooterHints } from '@/components/footer-hint';
import { t } from '@/lib/i18n';
import { useModuleStore } from '@/modules/store';
import type { CommanderAppProps, CommandSpec } from '@/modules/types';
import { compareVersions, type StoreCatalogModule } from '@/services/store-service';
import { useCommandStore } from '@/stores/command-store';
import { useModulesStore } from '@/stores/modules-store';
import { StoreBrowse } from './store-browse';
import { StoreManage } from './store-manage';
import { StoreModuleDetail } from './store-module-detail';
import { useModuleRelease } from './use-store-data';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

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

function StoreFooter({ view }: { view: StoreView }) {
  const module = view.kind === 'detail' ? view.module : undefined;
  const installed = useModuleStore((s) =>
    module ? s.modules.get(module.id)?.manifest.version : undefined
  );
  const progress = useModulesStore((s) => (module ? s.progress[module.id] : undefined));
  const release = useModuleRelease(module?.repo);

  const busy = progress?.phase === 'downloading' || progress?.phase === 'installing';
  const latestTag = release.data?.release?.tagName;
  const updateAvailable = !!installed && !!latestTag && compareVersions(latestTag, installed) > 0;
  const canInstall = !busy && (!installed || updateAvailable);

  return (
    <FooterHints>
      {view.kind === 'browse' && (
        <>
          <FooterHint kbd={<ArrowUpDown />} label={t('Navigate')} tooltip={t('Arrow Up / Down')} />
          <FooterHint kbd={<CornerDownLeft />} label={t('Open')} tooltip={t('Enter')} />
          <FooterHint
            kbd={
              <>
                <span className="text-[10px]">{IS_MAC ? '⌘' : 'Ctrl'}</span>
                <CornerDownLeft />
              </>
            }
            label={t('Install')}
            tooltip={t('Ctrl + Enter')}
          />
        </>
      )}
      {view.kind === 'detail' && (
        <>
          {canInstall && (
            <FooterHint kbd={<CornerDownLeft />} label={t('Install')} tooltip={t('Enter')} />
          )}
          <FooterHint
            kbd={<span className="text-[10px]">Esc</span>}
            label={t('Back')}
            tooltip={t('Esc')}
          />
        </>
      )}
      {view.kind === 'manage' && (
        <>
          <FooterHint kbd={<ArrowUpDown />} label={t('Navigate')} tooltip={t('Arrow Up / Down')} />
          <FooterHint kbd={<CornerDownLeft />} label={t('Select')} tooltip={t('Enter')} />
          <FooterHint
            kbd={<span className="text-[10px]">Esc</span>}
            label={t('Back')}
            tooltip={t('Esc')}
          />
        </>
      )}
    </FooterHints>
  );
}

export function StoreApp({ query, setBackHandler, setFooterTrailing }: CommanderAppProps) {
  const [view, setView] = useState<StoreView>({ kind: 'browse' });
  const viewKind = view.kind;

  useEffect(() => {
    if (!setFooterTrailing) return;
    setFooterTrailing(<StoreFooter view={view} />);
    return () => setFooterTrailing(undefined);
  }, [view, setFooterTrailing]);

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
