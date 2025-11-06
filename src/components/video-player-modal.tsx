import ReactPlayer from "react-player"; // Keep ReactPlayer import for type inference if needed, but it won't be rendered here
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePlayerStore } from "@/store/playerStore";

export const VideoPlayerModal = () => {
	const { currentVideo, isPlaying, playerRef } = usePlayerStore();

	const handleOpenChange = (open: boolean) => {
		if (!open) {}
	};

	return (
		<Dialog onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-3xl p-0 border-none bg-transparent">
				{currentVideo && (
					<ReactPlayer
						url={currentVideo.url}
						playing={isPlaying}
						controls={true}
						width="100%"
						height="100%"
					/>
				)}
			</DialogContent>
		</Dialog>
	);
};
