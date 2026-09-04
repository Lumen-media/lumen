import { remove } from '@tauri-apps/plugin-fs';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/lib/i18n';
import { mediaDbService } from '@/services/media-db-service';
import { useDeleteFileStore } from '@/stores/delete-file-store';

const MAX_NAME_LENGTH = 40;

function shortenName(name?: string): string {
  if (!name) return '';
  if (name.length <= MAX_NAME_LENGTH) return name;
  const head = Math.ceil((MAX_NAME_LENGTH - 1) / 2);
  const tail = Math.floor((MAX_NAME_LENGTH - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

interface DeleteFileAlertProps {
  onDelete?: (filePath: string) => void;
}

export function DeleteFileAlert({ onDelete }: DeleteFileAlertProps) {
  const { isOpen, file, closeDeleteDialog } = useDeleteFileStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useTranslation();
  const isUrlMedia = file?.extension === 'url' || Boolean(file?.originalUrl);
  const isLocalDownload =
    file?.downloadStatus === 'downloaded' && Boolean(file?.path) && !file.path.startsWith('http');
  const displayName = shortenName(file?.name);

  const handleConfirmDelete = async () => {
    if (!file) return;

    setIsDeleting(true);
    try {
      const isLocalDownload = file.downloadStatus === 'downloaded' && !file.path.startsWith('http');
      if (isLocalDownload) {
        try {
          await remove(file.path);
        } catch (e) {
          console.error('Failed to remove file on disk:', e);
        }
      }
      await mediaDbService.deleteFile(file.path);
      closeDeleteDialog();
      toast.success(t('{{name}} removed', { name: displayName }));

      if (onDelete) {
        onDelete(file.path);
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast.error(t('Failed to delete file'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={closeDeleteDialog}>
      <AlertDialogContent>
        <AlertDialogTitle>
          {isLocalDownload || !isUrlMedia ? t('Delete file?') : t('Remove media?')}
        </AlertDialogTitle>
        <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
          {isLocalDownload
            ? t('Are you sure you want to delete the downloaded file for "{{name}}"? This action cannot be undone.', {
                name: displayName,
              })
            : isUrlMedia
              ? t(
                  'Remove "{{name}}" from the library? The YouTube video itself will not be deleted.',
                  { name: displayName }
                )
              : t('Are you sure you want to delete "{{name}}"? This action cannot be undone.', {
                  name: displayName,
                })}
        </AlertDialogDescription>
        <div className="flex gap-3 justify-end">
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting
              ? t('Deleting...')
              : isLocalDownload || !isUrlMedia
                ? t('Delete')
                : t('Remove')}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
