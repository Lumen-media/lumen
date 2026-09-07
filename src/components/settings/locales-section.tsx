'use client';

import { CheckCircle2, DownloadCloud, Globe2, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { type LocaleStatus, localesService } from '@/services/locales-service';
import { Button } from '../ui/button';
import { CardContent } from '../ui/card';
import { Separator } from '../ui/separator';

export function LocalesSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LocaleStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await localesService.listLocales();
      setStatus((prev) =>
        prev
          ? { ...prev, languages: next }
          : {
              latestTag: null,
              lastSyncedTag: null,
              syncedAt: null,
              localesDir: '',
              languages: next,
            }
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      setStatus(await localesService.checkLocales());
    } catch {
      setStatus(
        (prev) =>
          prev ?? {
            latestTag: null,
            lastSyncedTag: null,
            syncedAt: null,
            localesDir: '',
            languages: [],
          }
      );
    } finally {
      setChecking(false);
      setChecked(true);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      setStatus(await localesService.syncLocales());
      setChecked(true);
    } catch {
      /* keep current status */
    } finally {
      setSyncing(false);
    }
  };

  const latestTag = status?.latestTag ?? null;
  const lastSyncedTag = status?.lastSyncedTag ?? null;
  const needsUpdate = latestTag !== null && latestTag !== lastSyncedTag;
  const installedCount = status?.languages.filter((l) => l.installed).length ?? 0;

  return (
    <>
      <div className="mb-6">
        <h3 className="text-base font-semibold">{t('Translations')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('Download localized language files to your device and keep translations up to date.')}
        </p>
      </div>

      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
              <Globe2 className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {latestTag
                  ? checked
                    ? needsUpdate
                      ? t('A new translation release is available')
                      : t('You are up to date')
                    : `${t('Current release')} ${latestTag}`
                  : t('Could not reach the translation server')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lastSyncedTag
                  ? t('Installed release {{tag}}', { tag: lastSyncedTag })
                  : t('No translations installed yet')}
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('Installed languages')}: {installedCount}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleCheck()}
            disabled={checking}
          >
            {checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('Check for updates')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSync()}
            disabled={syncing || needsUpdate === false}
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <DownloadCloud className="size-4" />
            )}
            {t('Update now')}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          {(status?.languages ?? []).map((lang) => (
            <div key={lang.code} className="flex items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{lang.nativeName}</span>
                <span className="text-xs text-muted-foreground">({lang.code})</span>
              </div>
              {lang.installed ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                  <CheckCircle2 className="size-3.5" />
                  {t('Installed')}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{t('Not installed')}</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </>
  );
}
