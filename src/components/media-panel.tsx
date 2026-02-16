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
import { useState } from "react";

type MediaType = "lyrics" | "video" | "text" | "audio" | "image" | "files";

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

	const handleBack = () => {
		setActiveMedia(null);
	};

	const currentItem = mediaItems.find((item) => item.id === activeMedia);

	return (
		<Card className="w-full h-full p-4 flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
					<Input
						placeholder={
							activeMedia
								? `Search ${currentItem?.label.toLowerCase()}...`
								: "Search..."
						}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9"
					/>
				</div>

				{activeMedia && (
					<Button
						size="icon"
						className="shrink-0 rounded-full"
						onClick={() => {
							// Funcionalidade futura
						}}
					>
						<Plus className="size-5" />
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
						>
							<ArrowLeft className="size-5" />
						</Button>
						<div className="flex items-center gap-2">
							<currentItem.icon className="size-5" />
							<h2 className="font-semibold text-lg">{currentItem.label}</h2>
						</div>
					</div>

					<div className="flex-1 overflow-auto">
						{activeMedia === "lyrics" && (
							<div>
								<p className="text-muted-foreground">Lyrics content here</p>
							</div>
						)}
						{activeMedia === "video" && (
							<div>
								<p className="text-muted-foreground">Video content here</p>
							</div>
						)}
						{activeMedia === "text" && (
							<div>
								<p className="text-muted-foreground">Text content here</p>
							</div>
						)}
						{activeMedia === "audio" && (
							<div>
								<p className="text-muted-foreground">Audio content here</p>
							</div>
						)}
						{activeMedia === "image" && (
							<div>
								<p className="text-muted-foreground">Image content here</p>
							</div>
						)}
						{activeMedia === "files" && (
							<div>
								<p className="text-muted-foreground">Files content here</p>
							</div>
						)}
					</div>
				</>
			) : (
				<nav className="flex flex-col gap-1">
					{mediaItems.map((item) => {
						const Icon = item.icon;

						return (
							<Button
								key={item.id}
								onClick={() => setActiveMedia(item.id)}
								className="justify-start hover:bg-primary/15"
								type="button"
								variant='ghost'
							>
								<Icon className="size-5 shrink-0" />
								<span className="font-medium">{item.label}</span>
							</Button>
						);
					})}
				</nav>
			)}
		</Card>
	);
}
