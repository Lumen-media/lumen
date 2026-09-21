'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir } from '@tauri-apps/plugin-fs';
import { useTranslation } from '@/lib/i18n';
import { CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getAppPaths, invalidateAppPathsCache } from '@/services/app-paths';
import { setMediaFolder, restartApp } from '@/services/media-folder-settings';
import type { MediaType } from '@/services/types';

const MEDIA_TYPES: MediaType[] = [
  'lyrics',
  'video',
  'image',
  'text',
  'audio',
  'files',
  'themes',
  'presentation',
];

export function MediaFoldersSection() {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<{ base: string; media: Record<MediaType, string> } | null>(null);
  const [defaults, setDefaults] = useState<Record<MediaType, string> | null>(null);
  const [pendingType, setPendingType] = useState<MediaType | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [restartPrompt, setRestartPrompt] = useState(false);

  const load = useCallback(async () => {
    const p = await getAppPaths();
    setPaths(p);
    const d = {} as Record<MediaType, string>;
    for (const type of MEDIA_TYPES) {
      d[type] = await join(p.base, 'files', 'media', type);
    }
    setDefaults(d);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChange = async (mediaType: MediaType) => {
    const picked = await open({ directory: true, multiple: false });
    if (!picked) return;
    const current = paths?.media[mediaType];
    if (picked === current) return;

    let content = false;
    if (current) {
      try {
        const entries = await readDir(current);
        content = entries.length > 0;
      } catch {
        content = false;
      }
    }

    if (!content) {
      await setMediaFolder({ mediaType, path: picked, migrate: 'none' });
      invalidateAppPathsCache();
      await load();
      setRestartPrompt(true);
      return;
    }

    setPendingType(mediaType);
    setPendingPath(picked);
    setDialogOpen(true);
  };

  const handleReset = async (mediaType: MediaType) => {
    const current = paths?.media[mediaType];
    const def = defaults?.[mediaType];
    if (!current || !def || current === def) return;
    let content = false;
    try {
      const entries = await readDir(current);
      content = entries.length > 0;
    } catch {
      content = false;
    }
    if (!content) {
      await setMediaFolder({ mediaType, path: null, migrate: 'none' });
      invalidateAppPathsCache();
      await load();
      setRestartPrompt(true);
      return;
    }
    setPendingType(mediaType);
    setPendingPath(def ?? null);
    setDialogOpen(true);
  };

  const confirmMigrate = async (mode: 'move' | 'copy' | 'none') => {
    if (!pendingType || !pendingPath) return;
    await setMediaFolder({ mediaType: pendingType, path: pendingPath, migrate: mode });
    invalidateAppPathsCache();
    await load();
    setDialogOpen(false);
    setRestartPrompt(true);
  };

  if (!paths || !defaults) return null;

  return (
    <>
      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5">
          <FolderOpen className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Media Folders')}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('Choose where each media type stores its files.')}
        </p>
        <div className="space-y-2">
          {MEDIA_TYPES.map((type) => {
            const current = paths.media[type];
            const def = defaults[type];
            const overridden = current !== def;
            return (
              <div key={type} className="flex items-center justify-between rounded-lg p-3 border">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium capitalize">{t(`mediaType.${type}`)}</p>
                  <p className="text-xs text-muted-foreground truncate">{current}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-3">
                  <Button variant="outline" size="sm" onClick={() => handleChange(type)}>
                    <FolderOpen className="size-3.5" />
                  </Button>
                  {overridden && (
                    <Button variant="ghost" size="icon-sm" onClick={() => handleReset(type)} title={t('Reset')}>
                      <RefreshCw className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('The folder has files. How should they move to the new location?')}</DialogTitle>
            <DialogDescription>{t('You can move the files, copy them, or keep them in place.')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" className="w-full" onClick={() => confirmMigrate('move')}>
              {t('Move')}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => confirmMigrate('copy')}>
              {t('Copy')}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => confirmMigrate('none')}>
              {t('Keep in place')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {restartPrompt && (
        <Dialog open={restartPrompt} onOpenChange={setRestartPrompt}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('Restart to apply')}</DialogTitle>
              <DialogDescription>{t('Restart the app now to apply the changes?')}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="default" onClick={() => { setRestartPrompt(false); void restartApp(); }}>{t('Restart now')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
