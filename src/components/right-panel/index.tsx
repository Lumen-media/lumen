import { useEffect, useRef, useState } from "react";
import { Card } from "../ui/card";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { LyricsTab } from "./lyrics-tab";
import { MediaTab } from "./media-tab";
import { ThemesTab } from "./themes-tab";
import "./styles.css";
import { cn } from "@/lib/utils";

const tabs = ["media", "lyrics", "themes"];

type RightPanelProps = {
	className?: string;
};

export const RightPanel = (props: RightPanelProps) => {
	const [activeTab, setActiveTab] = useState("media");
	const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
	const tabsRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const activeIndex = tabs.indexOf(activeTab);
		if (activeIndex !== -1 && tabsRef.current) {
			const tabElements = tabsRef.current.querySelectorAll("[data-tab-trigger]");
			const activeElement = tabElements[activeIndex] as HTMLElement;

			if (activeElement) {
				const tabsRect = tabsRef.current.getBoundingClientRect();
				const elementRect = activeElement.getBoundingClientRect();

				setIndicatorStyle({
					left: elementRect.left - tabsRect.left,
					width: elementRect.width,
				});
			}
		}
	}, [activeTab]);

	return (
		<Card className={cn("w-full h-full", props.className)}>
			<Tabs defaultValue="media" className="tabs" onValueChange={(value) => setActiveTab(value)}>
				<div className="border-b">
					<TabsList className="flex justify-between w-full gap-3 p-0 h-fit relative" ref={tabsRef}>
						{tabs.map((tab) => (
							<TabsTrigger
								key={tab}
								value={tab}
								className={`tab after:-bottom-[1px] ${activeTab === tab ? "text-primary" : ""}`}
								data-tab-trigger
							>
								{tab}
							</TabsTrigger>
						))}

						<div
							className="absolute bottom-0 h-0.5 bg-primary rounded-full transition-all duration-300 ease-out translate-y-[1px]"
							role="presentation"
							style={{
								left: `${indicatorStyle.left}px`,
								width: `${indicatorStyle.width}px`,
							}}
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
