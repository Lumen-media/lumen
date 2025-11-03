import { createFileRoute } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import ReactPlayer from "react-player";

export const Route = createFileRoute("/video/")({
	component: RouteComponent,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			url: search.url as string,
		};
	},
});

function RouteComponent() {
	const { url: initialUrl } = Route.useSearch();
	const [videoUrl, setVideoUrl] = useState(initialUrl || "");

	useEffect(() => {
		const unlisten = listen("video-url-update", (event) => {
			setVideoUrl(event.payload as string);
		});

		return () => {
			unlisten.then((f) => f());
		};
	}, []);

	return (
		<div className="h-dvh w-dvw bg-black flex items-center justify-center">
			{videoUrl ? (
				<ReactPlayer
					url={videoUrl}
					playing={true}
					controls={true}
					width="100%"
					height="100%"
				/>
			) : (
				<p className="text-white">No video URL provided.</p>
			)}
		</div>
	);
}
