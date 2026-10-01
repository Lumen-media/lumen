'use client';

import { ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useAppUpdateStore } from '@/stores/app-update-store';
import { useReleaseNotesStore } from '@/stores/release-notes-store';

function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function ReleaseNotesSkeleton() {
  return (
    <div className="space-y-6 p-2" aria-hidden>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 h-6 w-[180px] animate-pulse rounded bg-muted" />
          <div className="h-4 w-[200px] animate-pulse rounded bg-muted" />
        </div>
        <div className="h-8 w-24 shrink-0 animate-pulse rounded bg-muted" />
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="mb-4 h-8 w-[220px] animate-pulse rounded border-b border-muted bg-muted" />
        <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[85%] animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[70%] animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[90%] animate-pulse rounded bg-muted" />

        <div className="mb-4 mt-8 h-7 w-[180px] animate-pulse rounded border-b border-muted bg-muted" />
        <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[80%] animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[95%] animate-pulse rounded bg-muted" />

        <div className="ml-4 space-y-3">
          {[60, 75, 50].map((width) => (
            <div key={width} className="flex items-center gap-2">
              <div className="size-1.5 animate-pulse rounded-full bg-muted" />
              <div
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${width}%` }}
              />
            </div>
          ))}
        </div>

        <div className="mb-4 mt-8 h-6 w-[140px] animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[75%] animate-pulse rounded bg-muted" />

        <div className="my-6 border-l-2 border-primary pl-4">
          <div className="mb-1 h-4 w-[80%] animate-pulse rounded bg-muted" />
          <div className="h-4 w-[65%] animate-pulse rounded bg-muted" />
        </div>

        <div className="my-6 space-y-2 rounded-lg bg-muted p-4">
          <div className="h-4 w-[80%] animate-pulse rounded bg-background/40" />
          <div className="h-4 w-[90%] animate-pulse rounded bg-background/40" />
          <div className="h-4 w-[60%] animate-pulse rounded bg-background/40" />
        </div>

        <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-[85%] animate-pulse rounded bg-muted" />
        <div className="h-4 w-[95%] animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

export function ReleaseNotesDialog() {
  const { t } = useTranslation();
  const {
    releaseNotes,
    selectedVersion,
    loading,
    error,
    fetchReleaseNotes,
    selectVersion,
    closeDialog,
    dialogOpen: manualOpen,
  } = useReleaseNotesStore();

  const {
    showReleaseNotes,
    releaseNotesVersion,
    markReleaseNotesShown,
    closeDialog: closeUpdateDialog,
  } = useAppUpdateStore();

  const isAutoShown = showReleaseNotes;
  const shouldOpen = isAutoShown || manualOpen;
  const activeTag = selectedVersion ?? releaseNotesVersion;
  const selectedNote =
    releaseNotes.find((r) => r.tag_name === activeTag) ?? releaseNotes[0];
  const shownTag = selectedNote?.tag_name ?? null;

  useEffect(() => {
    if (!shouldOpen) return;
    void useReleaseNotesStore.getState().fetchReleaseNotes();
  }, [shouldOpen]);

  function handleClose() {
    if (isAutoShown && releaseNotesVersion) {
      markReleaseNotesShown(releaseNotesVersion);
    }
    closeUpdateDialog();
    closeDialog();
  }

  return (
    <Dialog open={shouldOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="w-[900px] max-w-[calc(100vw-3rem)] min-w-0 sm:w-[1080px] sm:min-w-[800px] sm:max-w-none"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('Release Notes')}</span>
            {releaseNotes.length > 1 && (
              <Select
                value={shownTag}
                onValueChange={(value) => { if (value) selectVersion(value); }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t('Select version')} />
                </SelectTrigger>
                <SelectContent>
                  {releaseNotes.map((note) => (
                    <SelectItem key={note.tag_name} value={note.tag_name}>
                      {note.name || note.tag_name} — {formatDate(note.published_at)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('View release notes for each version.')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea key={shownTag} className="max-h-[60vh] flex-1">
          {loading && releaseNotes.length === 0 ? (
            <ReleaseNotesSkeleton />
          ) : error && releaseNotes.length === 0 ? (
            <div className="py-8 text-center text-sm text-destructive">
              <p>{t('Failed to load release notes')}</p>
              <p className="mt-1 text-xs opacity-80">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchReleaseNotes} className="mt-4">
                {t('Retry')}
              </Button>
            </div>
          ) : selectedNote ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    {selectedNote.name || selectedNote.tag_name}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{selectedNote.tag_name}</span>
                    {formatDate(selectedNote.published_at) && (
                      <>
                        <span>·</span>
                        <span>{formatDate(selectedNote.published_at)}</span>
                      </>
                    )}
                    {selectedNote.prerelease && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        {t('Pre-release')}
                      </span>
                    )}
                    {selectedNote.draft && (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {t('Draft')}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(selectedNote.html_url, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="size-3.5" />
                  <span className="sr-only">{t('View on GitHub')}</span>
                </Button>
              </div>

              <Separator />

              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  {t('Refreshing…')}
                </div>
              )}

              {selectedNote.body ? (
                <Markdown source={selectedNote.body} className="store-readme release-notes" />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('No release notes available.')}
                </p>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('No release notes available.')}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}