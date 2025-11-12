import { FileText, Film, Presentation, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMediaStore } from "@/store/mediaStore";
import type { MediaItem, MediaType } from "@/types/media";
import { MediaItemActions } from "./media-item-actions";
import { MediaItemContextMenu } from "./media-item-context-menu";

interface MediaListProps {
	onMediaSelect?: (media: MediaItem) => void;
	onMediaEdit?: (media: MediaItem) => void;
	onMediaPresent?: (media: MediaItem) => void;
	selectedMediaId?: string | null;
}

const mediaTypeIcons = {
	text: FileText,
	video: Film,
	pptx: Presentation,
};

const mediaTypeLabels = {
	text: "Text Slide",
	video: "Video",
	pptx: "PowerPoint",
};

const mediaTypeBadgeColors = {
	text: "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
	video: "bg-purple-500/10 text-purple-500 hover:bg-purple-500/20",
	pptx: "bg-orange-500/10 text-orange-500 hover:bg-orange-500/20",
};

export function MediaList({
	onMediaSelect,
	onMediaEdit,
	onMediaPresent,
	selectedMediaId,
}: MediaListProps) {
	const mediaItems = useMediaStore((state) => state.mediaItems);
	const [searchQuery, setSearchQuery] = useState("");
	const [filterType, setFilterType] = useState<MediaType | "all">("all");

	const filteredMedia = useMemo(() => {
		return mediaItems.filter((item) => {
			const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesType = filterType === "all" || item.type === filterType;
			return matchesSearch && matchesType;
		});
	}, [mediaItems, searchQuery, filterType]);

	const formatDate = (date: Date) => {
		return new Date(date).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	};

	const getMediaThumbnail = (item: MediaItem) => {
		if (item.type === "video" && "thumbnail" in item.metadata && item.metadata.thumbnail) {
			return item.metadata.thumbnail;
		}
		return null;
	};

	const getMediaMetadataText = (item: MediaItem) => {
		switch (item.type) {
			case "text":
				return "content" in item.metadata
					? item.metadata.content.substring(0, 50) +
							(item.metadata.content.length > 50 ? "..." : "")
					: "";
			case "video":
				return "duration" in item.metadata
					? `${Math.floor(item.metadata.duration / 60)}:${String(Math.floor(item.metadata.duration % 60)).padStart(2, "0")}`
					: "";
			case "pptx":
				return "slideCount" in item.metadata ? `${item.metadata.slideCount} slides` : "";
			default:
				return "";
		}
	};

	return (
		<div className="flex flex-col h-full gap-3">
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					placeholder="Search media..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="pl-9"
				/>
			</div>

			<div className="flex gap-2 flex-wrap">
				<Button
					variant={filterType === "all" ? "default" : "outline"}
					size="sm"
					onClick={() => setFilterType("all")}
				>
					All ({mediaItems.length})
				</Button>
				<Button
					variant={filterType === "text" ? "default" : "outline"}
					size="sm"
					onClick={() => setFilterType("text")}
				>
					<FileText className="h-4 w-4" />
					Text ({mediaItems.filter((m) => m.type === "text").length})
				</Button>
				<Button
					variant={filterType === "video" ? "default" : "outline"}
					size="sm"
					onClick={() => setFilterType("video")}
				>
					<Film className="h-4 w-4" />
					Video ({mediaItems.filter((m) => m.type === "video").length})
				</Button>
				<Button
					variant={filterType === "pptx" ? "default" : "outline"}
					size="sm"
					onClick={() => setFilterType("pptx")}
				>
					<Presentation className="h-4 w-4" />
					PPTX ({mediaItems.filter((m) => m.type === "pptx").length})
				</Button>
			</div>

			{/* Media List */}
			<div className="flex-1 overflow-y-auto">
				<div className="flex flex-col gap-2">
					{filteredMedia.length === 0 ? (
						<Card className="p-8 text-center">
							<p className="text-muted-foreground">
								{searchQuery || filterType !== "all" ? "No media found" : "No media items yet"}
							</p>
							<p className="text-sm text-muted-foreground mt-2">
								{searchQuery || filterType !== "all"
									? "Try adjusting your search or filters"
									: "Add your first media item to get started"}
							</p>
						</Card>
					) : (
						filteredMedia.map((item) => {
							const Icon = mediaTypeIcons[item.type];
							const thumbnail = getMediaThumbnail(item);
							const isSelected = selectedMediaId === item.id;

							return (
								<MediaItemContextMenu
									key={item.id}
									media={item}
									onEdit={onMediaEdit}
									onPresent={onMediaPresent}
								>
									<Card
										className={cn(
											"p-3 cursor-pointer hover:bg-accent/50 transition-colors",
											isSelected && "ring-2 ring-primary bg-accent"
										)}
										onClick={() => onMediaSelect?.(item)}
									>
										<div className="flex gap-3">
											<div className="flex-shrink-0">
												{thumbnail ? (
													<img
														src={thumbnail}
														alt={item.title}
														className="w-16 h-16 object-cover rounded"
													/>
												) : (
													<div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
														<Icon className="h-8 w-8 text-muted-foreground" />
													</div>
												)}
											</div>

											<div className="flex-1 min-w-0">
												<div className="flex items-start justify-between gap-2">
													<h4 className="font-medium truncate">{item.title}</h4>
													<div className="flex items-center gap-1">
														<Badge className={cn("flex-shrink-0", mediaTypeBadgeColors[item.type])}>
															{mediaTypeLabels[item.type]}
														</Badge>
														<MediaItemActions
															media={item}
															onEdit={onMediaEdit}
															onPresent={onMediaPresent}
														/>
													</div>
												</div>

												<p className="text-sm text-muted-foreground truncate mt-1">
													{getMediaMetadataText(item)}
												</p>

												<div className="flex items-center gap-2 mt-2">
													<span className="text-xs text-muted-foreground">
														{formatDate(item.createdAt)}
													</span>
													{item.type === "pptx" && "conversionStatus" in item.metadata && (
														<Badge
															variant="outline"
															className={cn(
																"text-xs",
																item.metadata.conversionStatus === "completed" &&
																	"border-green-500 text-green-500",
																item.metadata.conversionStatus === "converting" &&
																	"border-yellow-500 text-yellow-500",
																item.metadata.conversionStatus === "failed" &&
																	"border-red-500 text-red-500",
																item.metadata.conversionStatus === "pending" &&
																	"border-gray-500 text-gray-500"
															)}
														>
															{item.metadata.conversionStatus}
														</Badge>
													)}
												</div>
											</div>
										</div>
									</Card>
								</MediaItemContextMenu>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
