import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { installModuleFromStore, type StoreCatalogModule } from '@/services/store-service';
import { useModulesStore } from '@/stores/modules-store';

export async function installFromStore(module: StoreCatalogModule, tag = 'latest') {
  const state = useModulesStore.getState();
  const existing = state.progress[module.id]?.phase;
  if (existing === 'downloading' || existing === 'installing') return;

  state.setPhase(module.id, 'installing', 0);
  try {
    await installModuleFromStore(module.repo, tag, module.id);
    state.clearPhase(module.id);
    toast.success(t('Install complete', { name: module.name }));
  } catch (err) {
    state.setPhase(module.id, 'error', 0);
    toast.error(t('Install failed', { name: module.name }));
    console.error('[store] install failed:', err);
  }
}
