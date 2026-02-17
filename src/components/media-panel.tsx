import { Card } from "@/components/ui/card";
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
import { useState, useEffect, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileManagementService, type MediaType, type FileInfo } from "@/services";
import { toast } from "sonner";
import { FileListItem } from "@/components/file-list-item";
import { DeleteFileAlert } from "@/components/delete-file-alert";
import { useAnnounce } from "@/hooks/use-announce";
import { useTranslation } from "react-i18next";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

const mediaItems = [
	{ id: "lyrics" as MediaType, label: "Lyrics", icon: Music },
	{ id: "video" as MediaType, label: "Video", icon: Video },
	{ id: "text" as MediaType, label: "Text", icon: FileText },
	{ id: "audio" as MediaType, label: "Audio", icon: Headphones },
	{ id: "image" as MediaType, label: "Image", icon: ImageIcon },
	{ id: "files" as MediaType, label: "Files", icon: FolderOpen },
];

export function MediaPanel() {
	const { t } = useTranslation();
	const [activeMedia, setActiveMedia] = useState<MediaType | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [files, setFiles] = useState<FileInfo[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [focusedIndex, setFocusedIndex] = useState<number>(-1);
	const announce = useAnnounce();
	const parentRef = useRef<HTMLDivElement>(null);

	const filteredFiles = useMemo(() => {
		if (searchQuery) {
			return files.filter(file =>
				file.name.toLowerCase().includes(searchQuery.toLowerCase())
			);
		}
		return files;
	}, [searchQuery, files]);

	const virtualizer = useVirtualizer({
		count: filteredFiles.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 80,
		overscan: 10,
	});

	useEffect(() => {
		if (activeMedia) {
			loadFiles(activeMedia);
		}
	}, [activeMedia]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!activeMedia || filteredFiles.length === 0) return;

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setFocusedIndex((prev) => 
					prev < filteredFiles.length - 1 ? prev + 1 : prev
				);
				break;
			case "ArrowUp":
				e.preventDefault();
				setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
				break;
			case "Enter":
				e.preventDefault();
				if (focusedIndex >= 0) {
					console.log("File clicked:", filteredFiles[focusedIndex].name);
				}
				break;
			case "Delete":
				e.preventDefault();
				if (focusedIndex >= 0) {
					const fileToDelete = filteredFiles[focusedIndex];
					handleDeleteFile(fileToDelete);
				}
				break;
		}
	};

	const handleDeleteFile = async (file: FileInfo) => {
		try {
			const { remove } = await import("@tauri-apps/plugin-fs");
			await remove(file.path);
			toast.success(`${file.name} removed`);
			if (activeMedia) {
				loadFiles(activeMedia);
			}
		} catch (error) {
			console.error("Failed to delete file:", error);
			toast.error("Failed to delete file");
		}
	};

	const handleFileDeleted = (filePath: string) => {
		setFiles((prevFiles) => prevFiles.filter((file) => file.path !== filePath));
	};

	const loadFiles = async (mediaType: MediaType) => {
		setIsLoading(true);
		setError(null);
		announce('Loading files...');
		
		try {
			const loadedFiles = await fileManagementService.listFiles(mediaType);
			setFiles(loadedFiles);
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
		<>
			<Card className="w-full h-full p-4 flex flex-col gap-4" role="region" aria-label="Media file management panel">
			<div className="flex items-center gap-2">
				<InputGroup>
      				<InputGroupInput
						placeholder={
							activeMedia
								? t(`Search ${currentItem?.label.toLowerCase()}...`)
								: t("Search...")
						}
						aria-label={activeMedia ? `${('Search')} ${currentItem?.label.toLowerCase()} ${t('files')}` : t("Search files")}
						role="searchbox"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
      					<InputGroupAddon>
        					<Search />
      					</InputGroupAddon>
      				{searchQuery && <InputGroupAddon align="inline-end">{filteredFiles.length} {t("results")}</InputGroupAddon>}
    			</InputGroup>

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

					<div className="flex-1 overflow-hidden" role="region" aria-labelledby="media-type-heading" aria-live="polite" aria-busy={isLoading}>
						{isLoading ? (
							<div className="flex items-center justify-center h-32" role="status" aria-label="Loading files">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
								<span className="sr-only">Loading files...</span>
							</div>
						) : error ? (
							<div className="flex flex-col items-center justify-center h-32 gap-3" role="alert" aria-live="assertive">
								<p className="text-destructive text-center">{error}</p>
								<Button onClick={handleRetry} variant="outline" size="sm" aria-label="Retry loading files">
									{t('Retry')}
								</Button>
							</div>
						) : filteredFiles.length === 0 ? (
							<div className="flex items-center justify-center h-32" role="status">
								<p className="text-muted-foreground">
									{searchQuery ? t('No files match your search') : t('No files in this folder')}
								</p>
							</div>
						) : (
							<div
								ref={parentRef}
								className="h-full overflow-auto focus:outline-none"
								onKeyDown={handleKeyDown}
								tabIndex={0}
							>
								<div
									style={{
										height: `${virtualizer.getTotalSize()}px`,
										width: "100%",
										position: "relative",
									}}
								>
									{virtualizer.getVirtualItems().map((virtualItem) => (
										<div
											key={virtualItem.key}
											data-index={virtualItem.index}
											style={{
												position: "absolute",
												top: 0,
												left: 0,
												width: "100%",
												transform: `translateY(${virtualItem.start}px)`,
											}}
										>
											<div className="px-2 py-1">
												<FileListItem
													file={filteredFiles[virtualItem.index]}
													mediaType={activeMedia}
													isFocused={virtualItem.index === focusedIndex}
													onClick={(file) => {
														console.log('File clicked:', file.name);
													}}
												/>
											</div>
										</div>
									))}
								</div>
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
		<DeleteFileAlert onDelete={handleFileDeleted} />
		</>
	);
}
