import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PptxMetadata } from "@/types/media";

/**
 * Configure PDF.js Web Worker
 *
 * PDF.js needs a separate worker thread to process PDFs without blocking the UI.
 * This tells it where to find the worker file.
 *
 * Current: Using unpkg.com CDN (requires internet)
 * Alternative for offline: import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
 *                         pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
 */
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PptxViewerProps {
	mediaId: string;
	metadata: PptxMetadata;
	currentSlide: number;
	onSlideChange: (slideIndex: number) => void;
	isControlView?: boolean;
	className?: string;
}

export function PptxViewer({
	metadata,
	currentSlide,
	onSlideChange,
	isControlView = false,
	className,
}: PptxViewerProps) {
	const [numPages, setNumPages] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pageWidth, setPageWidth] = useState<number>(800);
	const containerRef = useRef<HTMLDivElement>(null);
	const [preloadedPages, setPreloadedPages] = useState<Set<number>>(new Set());

	const pdfDataUrl = useMemo(() => {
		if (!metadata.pdfBytes) return null;
		try {
			return { data: metadata.pdfBytes };
		} catch (err) {
			console.error("Error creating PDF data URL:", err);
			return null;
		}
	}, [metadata.pdfBytes]);

	const onDocumentLoadSuccess = useCallback(
		({ numPages: loadedPages }: { numPages: number }) => {
			setNumPages(loadedPages);
			setLoading(false);
			setError(null);
			const pagesToPreload = new Set([
				currentSlide,
				Math.max(0, currentSlide - 1),
				Math.min(loadedPages - 1, currentSlide + 1),
			]);
			setPreloadedPages(pagesToPreload);
		},
		[currentSlide]
	);

	const onDocumentLoadError = useCallback((err: Error) => {
		console.error("Error loading PDF:", err);
		setError("Failed to load presentation. The file may be corrupted or invalid.");
		setLoading(false);
	}, []);

	const goToNextSlide = useCallback(() => {
		if (numPages && currentSlide < numPages - 1) {
			onSlideChange(currentSlide + 1);
		}
	}, [currentSlide, numPages, onSlideChange]);

	const goToPreviousSlide = useCallback(() => {
		if (currentSlide > 0) {
			onSlideChange(currentSlide - 1);
		}
	}, [currentSlide, onSlideChange]);

	const goToFirstSlide = useCallback(() => {
		onSlideChange(0);
	}, [onSlideChange]);

	const goToLastSlide = useCallback(() => {
		if (numPages) {
			onSlideChange(numPages - 1);
		}
	}, [numPages, onSlideChange]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			switch (e.key) {
				case "ArrowRight":
				case "PageDown":
				case " ":
					e.preventDefault();
					goToNextSlide();
					break;
				case "ArrowLeft":
				case "PageUp":
					e.preventDefault();
					goToPreviousSlide();
					break;
				case "Home":
					e.preventDefault();
					goToFirstSlide();
					break;
				case "End":
					e.preventDefault();
					goToLastSlide();
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [goToNextSlide, goToPreviousSlide, goToFirstSlide, goToLastSlide]);

	useEffect(() => {
		if (!numPages) return;

		const pagesToPreload = new Set([
			currentSlide,
			Math.max(0, currentSlide - 1),
			Math.min(numPages - 1, currentSlide + 1),
		]);

		setPreloadedPages(pagesToPreload);
	}, [currentSlide, numPages]);

	useEffect(() => {
		const updateWidth = () => {
			if (containerRef.current) {
				const containerWidth = containerRef.current.clientWidth;
				const containerHeight = containerRef.current.clientHeight;
				const widthBasedOnContainer = containerWidth * 0.9;
				const widthBasedOnHeight = containerHeight * 0.9 * (16 / 9);
				setPageWidth(Math.min(widthBasedOnContainer, widthBasedOnHeight));
			}
		};

		updateWidth();
		window.addEventListener("resize", updateWidth);
		return () => window.removeEventListener("resize", updateWidth);
	}, []);

	if (!metadata.pdfBytes || !pdfDataUrl) {
		return (
			<div
				className={cn(
					"flex flex-col items-center justify-center w-full h-full bg-gray-900 text-white",
					className
				)}
			>
				<p className="text-xl mb-2">No PDF data available</p>
				<p className="text-sm text-gray-400">
					The presentation may still be converting. Please wait...
				</p>
			</div>
		);
	}

	if (error) {
		return (
			<div
				className={cn(
					"flex flex-col items-center justify-center w-full h-full bg-gray-900 text-white",
					className
				)}
			>
				<p className="text-xl mb-2 text-red-400">Error Loading Presentation</p>
				<p className="text-sm text-gray-400">{error}</p>
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={cn(
				"flex flex-col w-full h-full bg-gray-900",
				isControlView ? "gap-4 p-4" : "",
				className
			)}
		>
			<div className="flex-1 flex items-center justify-center overflow-hidden">
				<Document
					file={pdfDataUrl}
					onLoadSuccess={onDocumentLoadSuccess}
					onLoadError={onDocumentLoadError}
					loading={
						<div className="flex flex-col items-center justify-center gap-2 text-white">
							<Loader2 className="w-8 h-8 animate-spin" />
							<p>Loading presentation...</p>
						</div>
					}
				>
					<Page
						pageNumber={currentSlide + 1}
						width={pageWidth}
						loading={
							<div className="flex items-center justify-center text-white">
								<Loader2 className="w-6 h-6 animate-spin" />
							</div>
						}
						className="shadow-2xl"
					/>

					{Array.from(preloadedPages).map(
						(pageIndex) =>
							pageIndex !== currentSlide && (
								<div key={pageIndex} className="hidden">
									<Page pageNumber={pageIndex + 1} width={pageWidth} />
								</div>
							)
					)}
				</Document>
			</div>

			{isControlView && numPages && (
				<div className="flex items-center justify-between gap-4 px-4 py-2 bg-gray-800 rounded-lg">
					<Button
						variant="outline"
						size="sm"
						onClick={goToPreviousSlide}
						disabled={currentSlide === 0}
						className="gap-2"
					>
						<ChevronLeft className="w-4 h-4" />
						Previous
					</Button>

					<div className="flex items-center gap-4">
						<span className="text-white text-sm">
							Slide {currentSlide + 1} of {numPages}
						</span>

						<input
							type="number"
							min={1}
							max={numPages}
							value={currentSlide + 1}
							onChange={(e) => {
								const value = Number.parseInt(e.target.value, 10);
								if (value >= 1 && value <= numPages) {
									onSlideChange(value - 1);
								}
							}}
							className="w-16 px-2 py-1 text-center bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
						/>
					</div>

					<Button
						variant="outline"
						size="sm"
						onClick={goToNextSlide}
						disabled={currentSlide === numPages - 1}
						className="gap-2"
					>
						Next
						<ChevronRight className="w-4 h-4" />
					</Button>
				</div>
			)}

			{!isControlView && numPages && (
				<div className="absolute bottom-4 right-4 px-3 py-1 bg-black/50 text-white text-sm rounded">
					{currentSlide + 1} / {numPages}
				</div>
			)}
		</div>
	);
}
