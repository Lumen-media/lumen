import { useState } from "react";
import type { TextSlideMetadata } from "@/types/media";
import { TextSlideViewer } from "../text-slide-viewer";
import { TextSlideEditor } from "./index";

export function TextSlideExample() {
	const [content, setContent] = useState("Welcome to our presentation!");
	const [metadata, setMetadata] = useState<TextSlideMetadata>({
		content: "Welcome to our presentation!",
		fontSize: 48,
		fontColor: "#FFFFFF",
		backgroundColor: "#1E40AF",
		alignment: "center",
	});

	const handleUpdate = (newContent: string, newMetadata: TextSlideMetadata) => {
		setContent(newContent);
		setMetadata(newMetadata);
	};

	return (
		<div className="grid grid-cols-2 gap-4 h-screen p-4">
			<div className="border rounded-lg p-4">
				<h2 className="text-lg font-semibold mb-4">Editor</h2>
				<TextSlideEditor
					mediaId="example-1"
					content={content}
					metadata={metadata}
					onUpdate={handleUpdate}
				/>
			</div>

			<div className="border rounded-lg overflow-hidden">
				<h2 className="text-lg font-semibold p-4 border-b">Viewer (Secondary Screen)</h2>
				<div className="h-[calc(100%-60px)]">
					<TextSlideViewer content={content} metadata={metadata} isControlView={false} />
				</div>
			</div>
		</div>
	);
}
