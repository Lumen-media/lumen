import { invoke } from "@tauri-apps/api/core";
import { Film, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMediaStore } from "@/store/mediaStore";
import type { VideoMetadata } from "@/types/media";

interface AddVideoDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface FileSelectionResult {
	path: string | null;
	error: string | null;
}

export function AddVideoDialog({ open, onOpenChange }: AddVideoDialogProps) {
	const addMediaItem = useMediaStore((state) => state.addMediaItem);
	const [title, setTitle] = useState("");
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleSelectFile = async () => {
		try {
			const result = await invoke<FileSelectionResult>("select_video_file");

			if (result.error) {
				toast.error("File Selection Error", {
					description: result.error,
				});
				return;
			}

			if (result.path) {
				setSelectedFile(result.path);

				if (!title) {
					const filename = result.path.split(/[\\/]/).pop() || "";
					const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
					setTitle(nameWithoutExt);
				}
			}
		} catch (error) {
			console.error("Failed to select video file:", error);
			toast.error("Failed to select file", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!title.trim() || !selectedFile) {
			return;
		}

		setIsSubmitting(true);

		try {
			const format = selectedFile.split(".").pop()?.toLowerCase() || "unknown";

			const metadata: VideoMetadata = {
				filePath: selectedFile,
				duration: 0,
				format,
			};

			addMediaItem({
				type: "video",
				title: title.trim(),
				metadata,
			});

			toast.success("Video added successfully", {
				description: `${title} has been added to your media library`,
			});

			setTitle("");
			setSelectedFile(null);
			onOpenChange(false);
		} catch (error) {
			console.error("Failed to add video:", error);
			toast.error("Failed to add video", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleCancel = () => {
		setTitle("");
		setSelectedFile(null);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Film className="h-5 w-5" />
						Add Video
					</DialogTitle>
					<DialogDescription>Import a video file to your media library.</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="video-title">Title *</Label>
							<Input
								id="video-title"
								placeholder="Enter video title..."
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								required
							/>
						</div>

						<div className="grid gap-2">
							<Label>Video File *</Label>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									onClick={handleSelectFile}
								>
									<Upload className="h-4 w-4 mr-2" />
									{selectedFile ? "Change File" : "Select File"}
								</Button>
							</div>
							{selectedFile && (
								<p className="text-xs text-muted-foreground truncate" title={selectedFile}>
									Selected: {selectedFile.split(/[\\/]/).pop()}
								</p>
							)}
							<p className="text-xs text-muted-foreground">
								Supported formats: MP4, AVI, MOV, WebM
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button type="submit" disabled={!title.trim() || !selectedFile || isSubmitting}>
							{isSubmitting ? "Adding..." : "Add Video"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
