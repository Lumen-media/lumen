'use client';

import { Loader2, ExternalLink } from 'lucide-react';
import { Markdown } from '@tanstack/markdown/react';
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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
    fetchReleaseNotes,
    selectVersion,
    closeDialog,
  } = useReleaseNotesStore();

  const { showReleaseNotes, releaseNotesVersion, markReleaseNotesShown, closeDialog: closeUpdateDialog } = useAppUpdateStore();
  const { dialogOpen: manualOpen } = useReleaseNotesStore();

  const isAutoShown = showReleaseNotes;
  const shouldOpen = isAutoShown || manualOpen;
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
    <Dialog open={shouldOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="w-[640px] sm:w-[768px] max-w-[90vw] max-h-[75vh]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{t('Release Notes')}</span>
            {releaseNotes.length > 1 && (
              <Select value={selectedVersion || ''} onValueChange={(value) => selectVersion(value || '')}>
                <SelectTrigger className="w-[200px]">
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

        <ScrollArea className="flex-1 max-h-[55vh]">
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

              <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-8 prose-headings:mb-4 prose-headings:border-b prose-headings:pb-2 prose-headings:text-lg prose-p:my-5 prose-ul:my-5 prose-ol:my-5 prose-blockquote:my-5 prose-li:my-2 prose-blockquote:pl-4 prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:text-muted-foreground prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-a:no-underline prose-a:text-primary hover:prose-a:underline prose-img:rounded-lg prose-img:shadow-md">
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