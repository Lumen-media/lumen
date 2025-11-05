import { Plus } from "lucide-react";
import { mockVideos } from "@/lib/mock-media";
import { formatDuration } from "@/lib/utils";
import { Button } from "../ui/button";
import { TabsContent } from "../ui/tabs";

export const MediaTab = () => {
	return (
		<TabsContent value="media">
			<Button className="w-full">
				<Plus /> Add media
			</Button>

			<div className="flex flex-col gap-3 mt-3">
				{mockVideos.map((video) => (
					<Button
						variant="ghost"
						className="justify-between hover:bg-background/30 px-1.5"
						key={video.id}
					>
						<p>{video.name}</p>
						<span className="text-muted-foreground">{formatDuration(video.duration)}</span>
					</Button>
				))}
			</div>
		</TabsContent>
	);
};
