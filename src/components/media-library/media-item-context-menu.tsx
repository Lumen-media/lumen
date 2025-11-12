import { Copy, Edit, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useMediaStore } from "@/store/mediaStore";
import type { MediaItem } from "@/types/media";

interface MediaItemContextMenuProps {
	media: MediaItem;
	children: React.ReactNode;
	onEdit?: (media: MediaItem) => void;
	onPresent?: (media: MediaItem) => void;
}

export function MediaItemContextMenu({
	media,
	children,
	onEdit,
	onPresent,
}: MediaItemContextMenuProps) {
	const deleteMediaItem = useMediaStore((state) => state.deleteMediaItem);
	const addMediaItem = useMediaStore((state) => state.addMediaItem);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const handleDelete = async () => {
		setIsDeleting(true);
		try {
			deleteMediaItem(media.id);
			toast.success("Media deleted", {
				description: `${media.title} has been removed from your library`,
			});
			setShowDeleteDialog(false);
		} catch (error) {
			console.error("Failed to delete media:", error);
			toast.error("Failed to delete media", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			setIsDeleting(false);
		}
	};

	const handleDuplicate = () => {
		try {
			const duplicateTitle = `${media.title} (Copy)`;

			addMediaItem({
				type: media.type,
				title: duplicateTitle,
				metadata: { ...media.metadata },
			});

			toast.success("Media duplicated", {
				description: `Created a copy of ${media.title}`,
			});
		} catch (error) {
			console.error("Failed to duplicate media:", error);
			toast.error("Failed to duplicate media", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleEdit = () => {
		onEdit?.(media);
	};

	const handlePresent = () => {
		onPresent?.(media);
	};

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={handlePresent}>
						<Play className="h-4 w-4 mr-2" />
						Present
					</ContextMenuItem>
					<ContextMenuItem onClick={handleEdit}>
						<Edit className="h-4 w-4 mr-2" />
						Edit
					</ContextMenuItem>
					<ContextMenuItem onClick={handleDuplicate}>
						<Copy className="h-4 w-4 mr-2" />
						Duplicate
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						onClick={() => setShowDeleteDialog(true)}
						className="text-red-600 focus:text-red-600"
					>
						<Trash2 className="h-4 w-4 mr-2" />
						Delete
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Media Item</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete "{media.title}"? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							disabled={isDeleting}
							className="bg-red-600 hover:bg-red-700"
						>
							{isDeleting ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
