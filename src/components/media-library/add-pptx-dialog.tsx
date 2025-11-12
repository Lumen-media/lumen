import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Loader2, Presentation, Upload, XCircle } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { useMediaStore } from "@/store/mediaStore";
import type { PptxMetadata } from "@/types/media";

interface AddPptxDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface FileSelectionResult {
	path: string | null;
	error: string | null;
}

interface PptxMetadataResponse {
	slide_count: number;
	file_size: number;
}

interface ConversionResult {
	pdf_bytes: number[];
	slide_count: number;
}

type ConversionStage = "idle" | "extracting" | "converting" | "completed" | "failed";

export function AddPptxDialog({ open, onOpenChange }: AddPptxDialogProps) {
	const addMediaItem = useMediaStore((state) => state.addMediaItem);
	const updatePptxConversionStatus = useMediaStore((state) => state.updatePptxConversionStatus);
	const setPptxPdfBytes = useMediaStore((state) => state.setPptxPdfBytes);

	const [title, setTitle] = useState("");
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [conversionStage, setConversionStage] = useState<ConversionStage>("idle");
	const [conversionProgress, setConversionProgress] = useState(0);
	const [slideCount, setSlideCount] = useState<number | null>(null);
	const [mediaId, setMediaId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const handleSelectFile = async () => {
		try {
			const result = await invoke<FileSelectionResult>("select_pptx_file");

			if (result.error) {
				toast.error("File Selection Error", {
					description: result.error,
				});
				return;
			}

			if (result.path) {
				setSelectedFile(result.path);
				setConversionStage("idle");
				setErrorMessage(null);

				if (!title) {
					const filename = result.path.split(/[\\/]/).pop() || "";
					const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
					setTitle(nameWithoutExt);
				}

				try {
					setConversionStage("extracting");
					setConversionProgress(10);

					const metadata = await invoke<PptxMetadataResponse>("get_pptx_metadata", {
						filePath: result.path,
					});

					setSlideCount(metadata.slide_count);
					setConversionProgress(20);
					setConversionStage("idle");
				} catch (error) {
					console.error("Failed to extract PPTX metadata:", error);
					setConversionStage("idle");
					setSlideCount(null);
				}
			}
		} catch (error) {
			console.error("Failed to select PPTX file:", error);
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

		try {
			const metadata: PptxMetadata = {
				filePath: selectedFile,
				slideCount: slideCount || 0,
				conversionStatus: "converting",
			};

			const id = addMediaItem({
				type: "pptx",
				title: title.trim(),
				metadata,
			});

			setMediaId(id);
			setConversionStage("converting");
			setConversionProgress(30);

			try {
				const result = await invoke<ConversionResult>("convert_pptx_to_pdf", {
					filePath: selectedFile,
				});

				setConversionProgress(90);

				const pdfBytes = new Uint8Array(result.pdf_bytes);

				setPptxPdfBytes(id, pdfBytes);

				setConversionProgress(100);
				setConversionStage("completed");

				toast.success("PPTX converted successfully", {
					description: `${title} is ready to present`,
				});

				setTimeout(() => {
					handleReset();
					onOpenChange(false);
				}, 1500);
			} catch (error) {
				console.error("Conversion failed:", error);
				const errorMsg = error instanceof Error ? error.message : "Unknown conversion error";
				setErrorMessage(errorMsg);
				setConversionStage("failed");
				updatePptxConversionStatus(id, "failed", errorMsg);

				toast.error("Conversion failed", {
					description: errorMsg,
				});
			}
		} catch (error) {
			console.error("Failed to add PPTX:", error);
			toast.error("Failed to add PPTX", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleReset = () => {
		setTitle("");
		setSelectedFile(null);
		setConversionStage("idle");
		setConversionProgress(0);
		setSlideCount(null);
		setMediaId(null);
		setErrorMessage(null);
	};

	const handleCancel = () => {
		if (conversionStage === "converting") {
			return;
		}
		handleReset();
		onOpenChange(false);
	};

	const isConverting = conversionStage === "converting" || conversionStage === "extracting";
	const isCompleted = conversionStage === "completed";
	const isFailed = conversionStage === "failed";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Presentation className="h-5 w-5" />
						Add PowerPoint Presentation
					</DialogTitle>
					<DialogDescription>Import a PPTX file and convert it for presentation.</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="pptx-title">Title *</Label>
							<Input
								id="pptx-title"
								placeholder="Enter presentation title..."
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								disabled={isConverting}
								required
							/>
						</div>

						<div className="grid gap-2">
							<Label>PPTX File *</Label>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									onClick={handleSelectFile}
									disabled={isConverting}
								>
									<Upload className="h-4 w-4 mr-2" />
									{selectedFile ? "Change File" : "Select File"}
								</Button>
							</div>
							{selectedFile && (
								<div className="space-y-1">
									<p className="text-xs text-muted-foreground truncate" title={selectedFile}>
										Selected: {selectedFile.split(/[\\/]/).pop()}
									</p>
									{slideCount !== null && (
										<p className="text-xs text-muted-foreground">
											{slideCount} slide{slideCount !== 1 ? "s" : ""} detected
										</p>
									)}
								</div>
							)}
						</div>

						{(isConverting || isCompleted || isFailed) && (
							<div className="grid gap-3 p-4 border rounded-lg">
								<div className="flex items-center gap-2">
									{isConverting && <Loader2 className="h-4 w-4 animate-spin" />}
									{isCompleted && <CheckCircle2 className="h-4 w-4 text-green-500" />}
									{isFailed && <XCircle className="h-4 w-4 text-red-500" />}
									<span className="text-sm font-medium">
										{conversionStage === "extracting" && "Extracting metadata..."}
										{conversionStage === "converting" && "Converting to PDF..."}
										{conversionStage === "completed" && "Conversion completed!"}
										{conversionStage === "failed" && "Conversion failed"}
									</span>
								</div>

								<Progress value={conversionProgress} className="h-2" />

								{isFailed && errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}
							</div>
						)}
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={handleCancel} disabled={isConverting}>
							{isCompleted ? "Close" : "Cancel"}
						</Button>
						{!isCompleted && !isFailed && (
							<Button type="submit" disabled={!title.trim() || !selectedFile || isConverting}>
								{isConverting ? "Converting..." : "Convert & Add"}
							</Button>
						)}
						{isFailed && (
							<Button type="button" onClick={handleSubmit}>
								Retry
							</Button>
						)}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
