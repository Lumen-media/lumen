import { type FileInfo, type MediaType } from "@/services";
import {
	Music,
	FileText,
	Headphones,
	Video,
	Image as ImageIcon,
	File,
} from "lucide-react";

interface FileListItemProps {
	file: FileInfo;
	mediaType: MediaType;
	onClick?: (file: FileInfo) => void;
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

export function FileListItem({ file, mediaType, onClick }: FileListItemProps) {
	const Icon = getMediaIcon(mediaType);

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

	const fileDescription = `${file.name}, ${formatFileSize(file.size)}, modified ${formatDate(file.modifiedAt)}`;

	return (
		<div
			className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			role="listitem"
			tabIndex={0}
			aria-label={fileDescription}
		>
			<div className="flex items-start gap-3">
				<div className="shrink-0 mt-0.5">
					<Icon className="size-5 text-muted-foreground" aria-hidden="true" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="font-medium truncate">{file.name}</p>
					<div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground" aria-hidden="true">
						<span>{formatFileSize(file.size)}</span>
						<span>•</span>
						<span>{formatDate(file.modifiedAt)}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
