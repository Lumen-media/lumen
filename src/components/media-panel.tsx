import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
	Music,
	FileText,
	Headphones,
	Video,
	Image as ImageIcon,
	FolderOpen,
	Search,
	ArrowLeft,
	Plus,
} from "lucide-react";
import { useState, useEffect } from "react";
import { fileManagementService, type MediaType, type FileInfo } from "@/services";
import { toast } from "sonner";
import { FileListItem } from "@/components/file-list-item";
import { useAnnounce } from "@/hooks/use-announce";

const mediaItems = [
	{ id: "lyrics" as MediaType, label: "Lyrics", icon: Music },
	{ id: "video" as MediaType, label: "Video", icon: Video },
	{ id: "text" as MediaType, label: "Text", icon: FileText },
	{ id: "audio" as MediaType, label: "Audio", icon: Headphones },
	{ id: "image" as MediaType, label: "Image", icon: ImageIcon },
	{ id: "files" as MediaType, label: "Files", icon: FolderOpen },
];

export function MediaPanel() {
	const [activeMedia, setActiveMedia] = useState<MediaType | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [files, setFiles] = useState<FileInfo[]>([]);
	const [filteredFiles, setFilteredFiles] = useState<FileInfo[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const announce = useAnnounce();

	useEffect(() => {
		if (activeMedia) {
			loadFiles(activeMedia);
		}
	}, [activeMedia]);

	useEffect(() => {
		if (searchQuery) {
			const filtered = files.filter(file =>
				file.name.toLowerCase().includes(searchQuery.toLowerCase())
			);
			setFilteredFiles(filtered);
		} else {
			setFilteredFiles(files);
		}
	}, [searchQuery, files]);

	const loadFiles = async (mediaType: MediaType) => {
		setIsLoading(true);
		setError(null);
		announce('Loading files...');
		
		try {
			const loadedFiles = await fileManagementService.listFiles(mediaType);
			setFiles(loadedFiles);
			setFilteredFiles(loadedFiles);
			announce(`Loaded ${loadedFiles.length} file${loadedFiles.length !== 1 ? 's' : ''}`);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to load files';
			setError(errorMessage);
			console.error('Error loading files:', err);
			toast.error('Failed to load files. Click retry to try again.');
			announce('Failed to load files');
		} finally {
			setIsLoading(false);
		}
	};

	const handleRetry = () => {
		if (activeMedia) {
			loadFiles(activeMedia);
		}
	};

	const handleBack = () => {
		setActiveMedia(null);
	};

	const handleAddFiles = async () => {
		if (!activeMedia) return;

		try {
			const selectedPaths = await fileManagementService.openFilePicker(activeMedia);

			if (!selectedPaths || selectedPaths.length === 0) {
				return;
			}

			setIsLoading(true);
			announce(`Uploading ${selectedPaths.length} file${selectedPaths.length !== 1 ? 's' : ''}...`);

			const uploadedFiles = await fileManagementService.uploadFiles(activeMedia, selectedPaths);

			await loadFiles(activeMedia);

			const successMessage = `${uploadedFiles.length} file(s) added successfully`;
			toast.success(successMessage);
			announce(successMessage);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to add files';
			setError(errorMessage);
			console.error('Error adding files:', err);
			
			toast.error(`Failed to add files: ${errorMessage}`);
			announce(`Failed to add files: ${errorMessage}`);
		} finally {
			setIsLoading(false);
		}
	};

	const currentItem = mediaItems.find((item) => item.id === activeMedia);

	return (
		<Card className="w-full h-full p-4 flex flex-col gap-4" role="region" aria-label="Media file management panel">
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
					<Input
						placeholder={
							activeMedia
								? `Search ${currentItem?.label.toLowerCase()}...`
								: "Search..."
						}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9"
						aria-label={activeMedia ? `Search ${currentItem?.label.toLowerCase()} files` : "Search files"}
						role="searchbox"
					/>
				</div>

				{activeMedia && (
					<Button
						size="icon"
						className="shrink-0 rounded-full"
						onClick={handleAddFiles}
						aria-label={`Add files to ${currentItem?.label.toLowerCase()}`}
						disabled={isLoading}
					>
						<Plus className="size-5" aria-hidden="true" />
					</Button>
				)}
			</div>

			{activeMedia && currentItem ? (
				<>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="icon"
							onClick={handleBack}
							className="shrink-0"
							aria-label="Go back to media categories"
						>
							<ArrowLeft className="size-5" aria-hidden="true" />
						</Button>
						<div className="flex items-center gap-2">
							<currentItem.icon className="size-5" aria-hidden="true" />
							<h2 className="font-semibold text-lg" id="media-type-heading">{currentItem.label}</h2>
						</div>
					</div>

					<div className="flex-1 overflow-auto" role="region" aria-labelledby="media-type-heading" aria-live="polite" aria-busy={isLoading}>
						{isLoading ? (
							<div className="flex items-center justify-center h-32" role="status" aria-label="Loading files">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
								<span className="sr-only">Loading files...</span>
							</div>
						) : error ? (
							<div className="flex flex-col items-center justify-center h-32 gap-3" role="alert" aria-live="assertive">
								<p className="text-destructive text-center">{error}</p>
								<Button onClick={handleRetry} variant="outline" size="sm" aria-label="Retry loading files">
									Retry
								</Button>
							</div>
						) : filteredFiles.length === 0 ? (
							<div className="flex items-center justify-center h-32" role="status">
								<p className="text-muted-foreground">
									{searchQuery ? 'No files match your search' : 'No files in this folder'}
								</p>
							</div>
						) : (
							<div className="space-y-2" role="list" aria-label={`${currentItem.label} files`}>
								{filteredFiles.map((file) => (
									<FileListItem
										key={file.path}
										file={file}
										mediaType={activeMedia}
										onClick={(file) => {
											console.log('File clicked:', file.name);
										}}
									/>
								))}
							</div>
						)}
					</div>
				</>
			) : (
				<nav className="flex flex-col gap-1" aria-label="Media categories">
					{mediaItems.map((item) => {
						const Icon = item.icon;

						return (
							<Button
								key={item.id}
								onClick={() => setActiveMedia(item.id)}
								className="justify-start hover:bg-primary/15"
								type="button"
								variant='ghost'
								aria-label={`Open ${item.label} category`}
							>
								<Icon className="size-5 shrink-0" aria-hidden="true" />
								<span className="font-medium">{item.label}</span>
							</Button>
						);
					})}
				</nav>
			)}
		</Card>
	);
}
