import type React from "react";
import { useState } from "react";
import { Card } from "../ui/card";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { LyricsTab } from "./lyrics-tab";
import { MediaTab } from "./media-tab";
import { ThemesTab } from "./themes-tab";
import "./styles.css";

const tabs = ["media", "lyrics", "themes"];

export const RightPanel = () => {
	const [activeTab, setActiveTab] = useState("media");

	return (
		<Card className="w-full h-full">
			<Tabs
				defaultValue="media"
				className="tabs"
				onValueChange={(value) => setActiveTab(value)}
			>
				<div className="border-b">
					<TabsList className="flex justify-between w-full gap-3 p-0 h-fit relative">
						{tabs.map((tab) => (
							<TabsTrigger
								key={tab}
								value={tab}
								className="tab after:-bottom-[1px]"
							>
								{tab}
							</TabsTrigger>
						))}

						<div
							className="indicator absolute w-full h-0.5 bg-primary rounded-full bottom-0 left-0 translate-y-[1px] transition-all duration-300 ease-in-out"
							role="presentation"
							style={
								{
									"--scaleX": 1 / tabs.length,
									"--translateX": `${tabs.indexOf(activeTab) * (100 / tabs.length)}%`,
								} as React.CSSProperties
							}
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
