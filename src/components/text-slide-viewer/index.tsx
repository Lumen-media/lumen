import { cn } from "@/lib/utils";
import type { TextSlideMetadata } from "@/types/media";

interface TextSlideViewerProps {
	content: string;
	metadata: TextSlideMetadata;
	isControlView?: boolean;
	className?: string;
}

export function TextSlideViewer({
	content,
	metadata,
	isControlView = false,
	className,
}: TextSlideViewerProps) {
	const fontSize = Math.max(24, metadata.fontSize);

	return (
		<div
			className={cn(
				"w-full h-full flex items-center justify-center",
				isControlView ? "p-8" : "p-12",
				className
			)}
			style={{
				backgroundColor: metadata.backgroundColor,
				color: metadata.fontColor,
			}}
		>
			<div
				className="w-full max-w-7xl break-words whitespace-pre-wrap"
				style={{
					fontSize: `${fontSize}px`,
					textAlign: metadata.alignment,
					lineHeight: 1.4,
				}}
			>
				{content || ""}
			</div>
		</div>
	);
}
