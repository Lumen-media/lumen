'use client';

import { Loader2, X, ChevronRight, ExternalLink } from 'lucide-react';
import { Markdown } from '@tanstack/markdown';
import { useTranslation } from '@/lib/i18n';
import { useReleaseNotesStore } from '@/stores/release-notes-store';
import { useAppUpdateStore } from '@/stores/app-update-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function ReleaseNotesDialog() {
  const { t } = useTranslation();
  const {
    releaseNotes,
    selectedVersion,
    loading,
    error,
    dialogOpen,
    fetchReleaseNotes,
    selectVersion,
    closeDialog,
    openDialog,
  } = useReleaseNotesStore();

  const { showReleaseNotes, releaseNotesVersion, markReleaseNotesShown, closeDialog: closeUpdateDialog } = useAppUpdateStore();

  const isAutoShown = showReleaseNotes;
  const targetVersion = releaseNotesVersion;
  const selectedNote = releaseNotes.find((r) => r.tag_name === (targetVersion || selectedVersion)) || releaseNotes[0];

  function handleClose() {
    if (isAutoShown && targetVersion) {
      markReleaseNotesShown(targetVersion);
    }
    closeUpdateDialog();
    closeDialog();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('Release Notes')}</span>
            {releaseNotes.length > 1 && (
              <select
                value={selectedVersion || ''}
                onChange={(e) => selectVersion(e.target.value)}
                className="ml-4 text-sm border rounded px-2 py-1 bg-background"
              >
                {releaseNotes.map((note) => (
                  <option key={note.tag_name} value={note.tag_name}>
                    {note.name || note.tag_name} — {formatDate(note.published_at)}
                  </option>
                ))}
              </select>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('View release notes for each version.')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t('Loading release notes…')}</span>
            </div>
          ) : error ? (
            <div className="text-center py-8 text-sm text-destructive">
              <p>{t('Failed to load release notes')}</p>
              <p className="mt-1">{error}</p>
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <span>{selectedNote.tag_name}</span>
                    <span>·</span>
                    <span>{formatDate(selectedNote.published_at)}</span>
                    {selectedNote.prerelease && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        Pre-release
                      </span>
                    )}
                    {selectedNote.draft && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-muted">
                        Draft
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(selectedNote.html_url, '_blank')}
                >
                  <ExternalLink className="size-3.5" />
                  <span className="sr-only">View on GitHub</span>
                </Button>
              </div>

              <Separator />

              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{selectedNote.body || 'No release notes provided.'}</Markdown>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {t('No release notes available.')}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={closeDialog}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}