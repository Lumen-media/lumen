import { Copy, Edit, MoreVertical, Play, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMediaStore } from "@/store/mediaStore";
import type { MediaItem } from "@/types/media";

interface MediaItemActionsProps {
	media: MediaItem;
	onEdit?: (media: MediaItem) => void;
	onPresent?: (media: MediaItem) => void;
}

export function MediaItemActions({ media, onEdit, onPresent }: MediaItemActionsProps) {
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
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" className="h-8 w-8">
						<MoreVertical className="h-4 w-4" />
						<span className="sr-only">Open menu</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={handlePresent}>
						<Play className="h-4 w-4 mr-2" />
						Present
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleEdit}>
						<Edit className="h-4 w-4 mr-2" />
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleDuplicate}>
						<Copy className="h-4 w-4 mr-2" />
						Duplicate
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setShowDeleteDialog(true)}
						className="text-red-600 focus:text-red-600"
					>
						<Trash2 className="h-4 w-4 mr-2" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

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
