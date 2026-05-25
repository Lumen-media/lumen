import { AlertTriangle, CheckCircle, Package, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { disableModule, reloadModule, uninstallModule } from '@/modules/injector';
import { useModuleStore } from '@/modules/store';
import type { ModuleRecord, ModuleStatus } from '@/modules/types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';

function StatusBadge({ status }: { status: ModuleStatus }) {
  if (status === 'active') {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-400 border-emerald-400/30">
        <CheckCircle className="size-3" /> Active
      </Badge>
    );
  }
  if (status === 'faulted') {
    return (
      <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
        <AlertTriangle className="size-3" /> Faulted
      </Badge>
    );
  }
  if (status === 'loading') {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <RefreshCw className="size-3 animate-spin" /> Loading
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <XCircle className="size-3" /> Disabled
    </Badge>
  );
}

function ModuleRow({ record }: { record: ModuleRecord }) {
  const { manifest, status, error, source } = record;

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{manifest.name}</span>
            <span className="text-xs text-muted-foreground">v{manifest.version}</span>
            <StatusBadge status={status} />
            {source === 'dev' && (
              <Badge variant="secondary" className="text-xs">dev</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{manifest.id}</p>
          {manifest.description && (
            <p className="text-xs text-muted-foreground mt-1">{manifest.description}</p>
          )}
          {status === 'faulted' && error && (
            <p className="text-xs text-destructive mt-1 font-mono">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {(status === 'faulted' || status === 'disabled') && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Reload"
              onClick={() => reloadModule(manifest.id)}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          )}
          {status === 'active' && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Disable"
              onClick={() => disableModule(manifest.id)}
            >
              <XCircle className="size-3.5" />
            </Button>
          )}
          {source !== 'bundled' && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Uninstall"
              className="text-destructive hover:text-destructive"
              onClick={() => uninstallModule(manifest.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ModulesSection() {
  const modules = useModuleStore((s) => s.modules);
  const list = Array.from(modules.values());

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
          <Package className="size-8 opacity-40" />
          <p className="text-sm">No modules installed</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {list.map((record, i) => (
            <div key={record.manifest.id}>
              <ModuleRow record={record} />
              {i < list.length - 1 && <Separator />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
