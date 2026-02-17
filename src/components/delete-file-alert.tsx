import { useState } from 'react';
import { remove } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDeleteFileStore } from '@/stores/delete-file-store';

interface DeleteFileAlertProps {
	onDelete?: (filePath: string) => void;
}

export function DeleteFileAlert({ onDelete }: DeleteFileAlertProps) {
	const { isOpen, file, closeDeleteDialog } = useDeleteFileStore();
	const [isDeleting, setIsDeleting] = useState(false);

	const handleConfirmDelete = async () => {
		if (!file) return;

		setIsDeleting(true);
		try {
			await remove(file.path);
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
				<AlertDialogTitle>Delete file?</AlertDialogTitle>
				<AlertDialogDescription>
					Are you sure you want to delete "{file?.name}"? This action cannot be undone.
				</AlertDialogDescription>
				<div className="flex gap-3 justify-end">
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirmDelete}
						disabled={isDeleting}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{isDeleting ? 'Deleting...' : 'Delete'}
					</AlertDialogAction>
				</div>
			</AlertDialogContent>
		</AlertDialog>
	);
}
