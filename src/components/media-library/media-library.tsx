import { FileText, Film, Plus, Presentation } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MediaItem } from "@/types/media";
import { AddPptxDialog } from "./add-pptx-dialog";
import { AddTextSlideDialog } from "./add-text-slide-dialog";
import { AddVideoDialog } from "./add-video-dialog";
import { MediaList } from "./media-list";

interface MediaLibraryProps {
	onMediaSelect?: (media: MediaItem) => void;
	onMediaEdit?: (media: MediaItem) => void;
	onMediaPresent?: (media: MediaItem) => void;
	selectedMediaId?: string | null;
}

export function MediaLibrary({
	onMediaSelect,
	onMediaEdit,
	onMediaPresent,
	selectedMediaId,
}: MediaLibraryProps) {
	const [showTextDialog, setShowTextDialog] = useState(false);
	const [showVideoDialog, setShowVideoDialog] = useState(false);
	const [showPptxDialog, setShowPptxDialog] = useState(false);

	return (
		<>
			<Card className="w-full h-full flex flex-col">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold">Media Library</h2>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm">
								<Plus className="h-4 w-4 mr-2" />
								Add Media
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => setShowTextDialog(true)}>
								<FileText className="h-4 w-4 mr-2" />
								Text Slide
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setShowVideoDialog(true)}>
								<Film className="h-4 w-4 mr-2" />
								Video
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setShowPptxDialog(true)}>
								<Presentation className="h-4 w-4 mr-2" />
								PowerPoint
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="flex-1 overflow-hidden">
					<MediaList
						onMediaSelect={onMediaSelect}
						onMediaEdit={onMediaEdit}
						onMediaPresent={onMediaPresent}
						selectedMediaId={selectedMediaId}
					/>
				</div>
			</Card>

			<AddTextSlideDialog open={showTextDialog} onOpenChange={setShowTextDialog} />
			<AddVideoDialog open={showVideoDialog} onOpenChange={setShowVideoDialog} />
			<AddPptxDialog open={showPptxDialog} onOpenChange={setShowPptxDialog} />
		</>
	);
}
