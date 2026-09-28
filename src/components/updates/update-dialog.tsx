'use client';

import { CircleAlert, Download, Sparkles } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { useTranslation } from '@/lib/i18n';
import { deferUpdate, installUpdate } from '@/services/app-update-service';
import { useAppUpdateStore } from '@/stores/app-update-store';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AppUpdateDialog() {
  const { t } = useTranslation();
  const dialogOpen = useAppUpdateStore((s) => s.dialogOpen);
  const closeDialog = useAppUpdateStore((s) => s.closeDialog);
  const phase = useAppUpdateStore((s) => s.phase);
  const info = useAppUpdateStore((s) => s.info);
  const downloaded = useAppUpdateStore((s) => s.downloaded);
  const total = useAppUpdateStore((s) => s.total);
  const error = useAppUpdateStore((s) => s.error);

  if (!dialogOpen) return null;

  const busy = phase === 'downloading' || phase === 'installing';
  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const published = info?.date ? new Date(info.date * 1000).toLocaleDateString() : null;

  async function handleInstall() {
    try {
      await installUpdate();
    } catch (cause) {
      console.warn('update install failed', cause);
    }
  }

  async function handleDefer() {
    closeDialog();
    try {
      await deferUpdate();
    } catch (cause) {
      console.warn('could not defer update', cause);
    }
  }

  return (
    <AlertDialog open>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            {error ? (
              <CircleAlert className="size-5 text-destructive" />
            ) : (
              <Sparkles className="size-5 text-primary" />
            )}
          </AlertDialogMedia>
          <AlertDialogTitle>
            {error
              ? t('The update could not be installed')
              : t('A new version of Lumen is available')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {error ?? (
              <>
                {info?.version && (
                  <span className="block font-medium text-foreground">
                    {t('Version {{version}}', { version: info.version })}
                    {published ? ` · ${published}` : ''}
                  </span>
                )}
                {info?.notes ? (
                  <span className="mt-2 block max-h-32 overflow-y-auto whitespace-pre-line text-xs">
                    {info.notes}
                  </span>
                ) : (
                  <span className="mt-2 block text-xs">
                    {t('It will be downloaded now and installed the next time Lumen starts.')}
                  </span>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {busy && (
          <div className="space-y-2 px-1">
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground">
              {phase === 'installing'
                ? t('Installing the update…')
                : total
                  ? `${t('Downloading…')} ${formatBytes(downloaded)} / ${formatBytes(total)}`
                  : t('Downloading…')}
            </p>
          </div>
        )}

        <AlertDialogFooter>
          {error ? (
            <AlertDialogAction onClick={closeDialog}>{t('Close')}</AlertDialogAction>
          ) : busy ? null : (
            <>
              <AlertDialogCancel onClick={handleDefer}>{t('Not now')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleInstall}>
                <Download className="size-3.5" />
                {t('Update now')}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
