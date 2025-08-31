import { Plus } from "lucide-react";
import { mockThemes } from "../../lib/mock-themes";
import { Button } from "../ui/button";
import { TabsContent } from "../ui/tabs";

export const ThemesTab = () => {
	return (
		<TabsContent value="themes">
			<Button className="w-full">
				<Plus /> Add themes
			</Button>

			<div className="flex flex-col gap-3 mt-3 overflow-y-auto flex-grow">
				{mockThemes.map((theme) => (
					<Button
						variant="ghost"
						className="items-center justify-start gap-3 hover:bg-background/30 px-1.5 h-fit"
						key={theme.id}
					>
						<img
							src={theme.imageUrl}
							alt={theme.name}
							className="h-16 aspect-video object-cover rounded-md"
						/>
						<p className="text-ellipsis line-clamp-1">{theme.name}</p>
					</Button>
				))}
			</div>
		</TabsContent>
	);
};
