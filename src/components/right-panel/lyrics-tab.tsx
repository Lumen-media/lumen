import { Plus } from "lucide-react";
import { mockLyrics } from "../../lib/mock-lyrics";
import { Button } from "../ui/button";
import { TabsContent } from "../ui/tabs";

export const LyricsTab = () => {
	return (
		<TabsContent value="lyrics" className="h-full flex flex-col">
			<Button className="w-full">
				<Plus /> Add lyrics
			</Button>

			<div className="flex flex-col gap-3 mt-3 overflow-y-auto flex-grow">
				{mockLyrics.map((lyric) => (
					<Button
						variant="ghost"
						className="justify-between hover:bg-background/30 px-1.5"
						key={lyric.id}
					>
						<p>{lyric.title}</p>
					</Button>
				))}
			</div>
		</TabsContent>
	);
};
