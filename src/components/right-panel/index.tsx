import { Card } from "../ui/card";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { LyricsTab } from "./lyrics-tab";
import { MediaTab } from "./media-tab";
import { ThemesTab } from "./themes-tab";
import "./styles.css";

export const RightPanel = () => {
	return (
		<Card className="w-full h-full">
			<Tabs defaultValue="media" className="tabs">
				<div className="border-b">
					<TabsList className="flex justify-between w-full gap-3 p-0 h-fit relative">
						<TabsTrigger
							value="media"
							className="tabs__tab after:-bottom-[1px]"
						>
							Media
						</TabsTrigger>
						<TabsTrigger
							value="lyrics"
							className="tabs__tab after:-bottom-[1px]"
						>
							Lyrics
						</TabsTrigger>
						<TabsTrigger
							value="themes"
							className="tabs__tab after:-bottom-[1px]"
						>
							Themes
						</TabsTrigger>
						<div
							className="tabs__indicator h-0.5 bg-primary rounded-full translate-y-[1px] transition-all duration-200 ease-in-out"
							role="presentation"
						/>
					</TabsList>
				</div>
				<MediaTab />
				<LyricsTab />
				<ThemesTab />
			</Tabs>
		</Card>
	);
};
