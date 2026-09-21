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
import { fileManagementService, type MediaFolder, type MediaType } from '@/services';
import { useDeleteFolderStore } from '@/stores/delete-folder-store';

const MAX_NAME_LENGTH = 40;

function shortenName(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const head = Math.ceil((MAX_NAME_LENGTH - 1) / 2);
  const tail = Math.floor((MAX_NAME_LENGTH - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

interface DeleteFolderAlertProps {
  mediaType: MediaType | null;
  onDelete?: (folder: MediaFolder) => void;
}

export function DeleteFolderAlert({ mediaType, onDelete }: DeleteFolderAlertProps) {
  const { isOpen, folder, closeDeleteDialog } = useDeleteFolderStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useTranslation();
  const displayName = shortenName(folder?.name ?? '');

  const handleConfirmDelete = async () => {
    if (!folder || !mediaType) return;

    setIsDeleting(true);
    try {
      await fileManagementService.deleteFolder(mediaType, folder.folder);
      closeDeleteDialog();
      toast.success(t('{{name}} folder deleted', { name: displayName }));

      if (onDelete) {
        onDelete(folder);
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      toast.error(t('Failed to delete folder'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={closeDeleteDialog}>
      <AlertDialogContent>
        <AlertDialogTitle>{t('Delete folder?')}</AlertDialogTitle>
        <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
          {t(
            'Are you sure you want to delete the folder "{{name}}" and all of its contents? This action cannot be undone.',
            { name: displayName }
          )}
        </AlertDialogDescription>
        <div className="flex gap-3 justify-end">
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? t('Deleting...') : t('Delete')}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
