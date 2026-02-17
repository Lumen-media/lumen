import { type FileInfo, type MediaType } from "@/services";
import {
	Music,
	FileText,
	Headphones,
	Video,
	Image as ImageIcon,
	File,
	MoreVertical,
	Trash2,
	FolderOpen,
} from "lucide-react";
import { useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { remove } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";

interface FileListItemProps {
	file: FileInfo;
	mediaType: MediaType;
	onClick?: (file: FileInfo) => void;
	onDelete?: (file: FileInfo) => void;
}

const getMediaIcon = (mediaType: MediaType) => {
	switch (mediaType) {
		case "lyrics":
			return Music;
		case "video":
			return Video;
		case "audio":
			return Headphones;
		case "image":
			return ImageIcon;
		case "text":
			return FileText;
		case "files":
			return File;
		default:
			return File;
	}
};

const formatFileSize = (bytes: number): string => {
	if (bytes === 0) return "0 Bytes";
	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
};

const formatDate = (date: Date): string => {
	return new Date(date).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

export function FileListItem({ file, mediaType, onClick, onDelete }: FileListItemProps) {
	const Icon = getMediaIcon(mediaType);
	const [isDeleting, setIsDeleting] = useState(false);

	const handleClick = () => {
		if (onClick) {
			onClick(file);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleClick();
		}
	};

	const handleOpenFolder = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			const folderPath = file.path.substring(0, file.path.lastIndexOf("\\"));
			await invoke("open_folder", { path: folderPath });
		} catch (error) {
			console.error("Failed to open folder:", error);
			toast.error("Failed to open folder");
		}
	};

	const handleDelete = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsDeleting(true);
		try {
			await remove(file.path);
			toast.success(`${file.name} removed`);
			if (onDelete) {
				onDelete(file);
			}
		} catch (error) {
			console.error("Failed to delete file:", error);
			toast.error("Failed to delete file");
		} finally {
			setIsDeleting(false);
		}
	};

	const fileDescription = `${file.name}, ${formatFileSize(file.size)}, modified ${formatDate(file.modifiedAt)}`;

	return (
		<Button
			variant="ghost"
			className="w-full justify-start hover:bg-primary/15 text-left p-3 h-auto group"
			onClick={handleClick}
			aria-label={fileDescription}
		>
			<div className="flex items-start gap-3 w-full min-w-0">
				<div className="shrink-0 mt-0.5">
					<Icon className="size-5 text-muted-foreground" aria-hidden="true" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="font-medium truncate">{file.name}</p>
					<div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground" aria-hidden="true">
						<span>{formatFileSize(file.size)}</span>
						<span>•</span>
						<span className="truncate">{formatDate(file.modifiedAt)}</span>
					</div>
				</div>
				<div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								aria-label={`Options for ${file.name}`}
								onClick={(e) => e.stopPropagation()}
							>
								<MoreVertical className="h-4 w-4" aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={handleOpenFolder} aria-label="Open folder">
								<FolderOpen className="h-4 w-4 mr-2" aria-hidden="true" />
								Open folder
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={handleDelete}
								disabled={isDeleting}
								className="text-destructive focus:text-destructive"
								aria-label="Delete file"
							>
								<Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
								{isDeleting ? "Deleting..." : "Delete"}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</Button>
	);
}
