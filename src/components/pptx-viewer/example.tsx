import { useState } from "react";
import { useCurrentMedia, useCurrentSlideIndex, useMediaStore } from "@/store/mediaStore";
import type { PptxMetadata } from "@/types/media";
import { PptxViewer } from "./index";

export function PptxControlExample() {
	const currentMedia = useCurrentMedia();
	const currentSlide = useCurrentSlideIndex();
	const goToSlide = useMediaStore((state) => state.goToSlide);

	if (!currentMedia || currentMedia.type !== "pptx") {
		return (
			<div className="flex items-center justify-center h-full">
				<p>No PPTX presentation selected</p>
			</div>
		);
	}

	const metadata = currentMedia.metadata as PptxMetadata;

	return (
		<div className="w-full h-full">
			<PptxViewer
				mediaId={currentMedia.id}
				metadata={metadata}
				currentSlide={currentSlide}
				onSlideChange={goToSlide}
				isControlView={true}
			/>
		</div>
	);
}

export function PptxDisplayExample() {
	const currentMedia = useCurrentMedia();
	const currentSlide = useCurrentSlideIndex();
	const goToSlide = useMediaStore((state) => state.goToSlide);

	if (!currentMedia || currentMedia.type !== "pptx") {
		return (
			<div className="flex items-center justify-center h-screen bg-black text-white">
				<p>No presentation to display</p>
			</div>
		);
	}

	const metadata = currentMedia.metadata as PptxMetadata;

	return (
		<PptxViewer
			mediaId={currentMedia.id}
			metadata={metadata}
			currentSlide={currentSlide}
			onSlideChange={goToSlide}
			isControlView={false}
			className="w-screen h-screen"
		/>
	);
}

export function PptxStandaloneExample() {
	const [currentSlide, setCurrentSlide] = useState(0);
	const mediaItem = useMediaStore((state) => state.mediaItems.find((item) => item.type === "pptx"));

	if (!mediaItem || mediaItem.type !== "pptx") {
		return <div>No PPTX available</div>;
	}

	const metadata = mediaItem.metadata as PptxMetadata;

	return (
		<div className="w-full h-[600px]">
			<PptxViewer
				mediaId={mediaItem.id}
				metadata={metadata}
				currentSlide={currentSlide}
				onSlideChange={setCurrentSlide}
				isControlView={true}
			/>
		</div>
	);
}

export function MediaRoutePptxExample() {
	const currentMedia = useCurrentMedia();
	const currentSlide = useCurrentSlideIndex();
	const goToSlide = useMediaStore((state) => state.goToSlide);
	const isPresenting = useMediaStore((state) => state.isPresenting);

	if (!isPresenting || !currentMedia) {
		return (
			<div className="flex items-center justify-center h-screen bg-black text-white">
				<p>No active presentation</p>
			</div>
		);
	}

	if (currentMedia.type === "pptx") {
		const metadata = currentMedia.metadata as PptxMetadata;

		return (
			<PptxViewer
				mediaId={currentMedia.id}
				metadata={metadata}
				currentSlide={currentSlide}
				onSlideChange={goToSlide}
				isControlView={false}
				className="w-screen h-screen"
			/>
		);
	}

	return null;
}
