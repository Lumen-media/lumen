import ReactPlayer from "react-player"; // Keep ReactPlayer import for type inference if needed, but it won't be rendered here
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePlayerStore } from "@/store/playerStore";

export const VideoPlayerModal = () => {
	const { currentVideo, isPlaying, playerRef } = usePlayerStore();

	const handleOpenChange = (open: boolean) => {
		// The modal only controls its visibility, not the player's state
		// The player continues to play in the background
		if (!open) {
			// Optionally, you might want to pause the video when the modal closes
			// if the user expects it to stop playing visually.
			// For now, we'll let it continue playing in the background.
		}
	};

	return (
		<Dialog onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-3xl p-0 border-none bg-transparent">
				{currentVideo && (
					// Render a visual representation of the player in the modal
					// The actual ReactPlayer instance is in __root.tsx
					// This could be an iframe or a simple image/placeholder
					// For now, we'll render ReactPlayer here, but it will be controlled by the global state
					<ReactPlayer
						url={currentVideo.url}
						playing={isPlaying}
						controls={true}
						width="100%"
						height="100%"
						// The ref is set in __root.tsx, so we don't set it here
						// This instance is purely for visual display within the modal
					/>
				)}
			</DialogContent>
		</Dialog>
	);
};
