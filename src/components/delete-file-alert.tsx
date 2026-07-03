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
import { mediaDbService } from '@/services/media-db-service';
import { useDeleteFileStore } from '@/stores/delete-file-store';

interface DeleteFileAlertProps {
  onDelete?: (filePath: string) => void;
}

export function DeleteFileAlert({ onDelete }: DeleteFileAlertProps) {
  const { isOpen, file, closeDeleteDialog } = useDeleteFileStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const isUrlMedia = file?.extension === 'url' || Boolean(file?.originalUrl);

  const handleConfirmDelete = async () => {
    if (!file) return;

    setIsDeleting(true);
    try {
      if (file.extension === 'url' || Boolean(file.originalUrl)) {
        await mediaDbService.deleteFile(file.path);
      } else {
        await remove(file.path);
      }
      closeDeleteDialog();
      toast.success(`${file.name} removed`);

      if (onDelete) {
        onDelete(file.path);
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast.error('Failed to delete file');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={closeDeleteDialog}>
      <AlertDialogContent>
        <AlertDialogTitle>{isUrlMedia ? 'Remove media?' : 'Delete file?'}</AlertDialogTitle>
        <AlertDialogDescription>
          {isUrlMedia
            ? `Remove "${file?.name}" from the library? The YouTube video itself will not be deleted.`
            : `Are you sure you want to delete "${file?.name}"? This action cannot be undone.`}
        </AlertDialogDescription>
        <div className="flex gap-3 justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : isUrlMedia ? 'Remove' : 'Delete'}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
