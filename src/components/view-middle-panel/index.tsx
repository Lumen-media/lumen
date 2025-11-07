import { Eye, Maximize2, Monitor, MonitorSmartphone, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PlayerControls } from "../player-controls";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export const ViewMiddlePanel = () => {
	const [activeTab, setActiveTab] = useState("view");
	const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
	const [currentSlide, setCurrentSlide] = useState(0);
	const tabsRef = useRef<HTMLDivElement>(null);

	const tabs = ["display", "fullscreen", "view"];

	const slides = [
		"When the night is cold\nand the lights are low",
		"You know I'm here for you",
		"Through the darkest times",
		"I'll be your light",
		"Chorus",
		"Verse 2",
		"Bridge",
		"Final Chorus",
	];

	const goToSlide = (slideIndex: number) => {
		if (slideIndex >= 0 && slideIndex < slides.length) {
			setCurrentSlide(slideIndex);
		}
	};

	const advanceSlides = (steps: number) => {
		const newIndex = currentSlide + steps;
		goToSlide(newIndex);
	};

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
		<Card className="w-full h-full flex-col">
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-lg font-semibold">Preview</h2>

				<div className="flex items-center gap-4">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Badge className="bg-background p-2 gap-1" variant="outline">
							<ZoomIn className="size-3" /> 100%
						</Badge>

						<Badge className="bg-background p-2 gap-1" variant="outline">
							<MonitorSmartphone className="size-3" /> 16:9
						</Badge>
					</div>

					<Button variant="secondary">
						<Monitor /> Display
					</Button>

					<Button variant="secondary">
						<Maximize2 /> Fullscreen
					</Button>

					<Button>
						<Eye /> View
					</Button>
				</div>
			</div>

			<Card className="flex-1 bg-background flex flex-col p-3 gap-3">
				<Card className="flex-1 flex items-center justify-center p-8 rounded-lg">
					<div className="text-center">
						<h1 className="text-4xl font-bold text-white leading-tight whitespace-pre-line">
							{slides[currentSlide]}
						</h1>
					</div>
				</Card>

				<Card className="grid grid-cols-6 gap-3 p-4 rounded-lg h-[9.375rem]">
					{currentSlide > 0 && (
						<div className="flex flex-col items-center gap-2">
							<Button
								className="w-full aspect-video h-auto bg-slate-800 border border-slate-600 rounded-lg flex items-center justify-center relative overflow-hidden hover:border-slate-500 cursor-pointer transition-colors p-0"
								onClick={() => advanceSlides(-1)}
								variant="ghost"
							>
								<div className="text-xs text-center text-slate-300 leading-tight px-2 whitespace-pre-line">
									{slides[currentSlide - 1]?.substring(0, 30) +
										(slides[currentSlide - 1]?.length > 30 ? "..." : "")}
								</div>
							</Button>
							<span className="text-xs text-slate-400">Prev</span>
						</div>
					)}
					<div className="flex flex-col items-center gap-2">
						<div className="w-full aspect-video bg-slate-800 border-2 border-cyan-400 rounded-lg flex items-center justify-center relative overflow-hidden">
							<div className="text-xs text-center text-white leading-tight px-2 whitespace-pre-line">
								{slides[currentSlide]?.substring(0, 30) +
									(slides[currentSlide]?.length > 30 ? "..." : "")}
							</div>
						</div>
						<span className="text-xs text-cyan-400 font-medium">Current</span>
					</div>
					{currentSlide + 1 < slides.length && (
						<div className="flex flex-col items-center gap-2">
							<Button
								className="w-full aspect-video h-auto bg-slate-800 border border-slate-600 rounded-lg flex items-center justify-center relative overflow-hidden hover:border-slate-500 cursor-pointer transition-colors p-0"
								onClick={() => advanceSlides(1)}
								variant="ghost"
							>
								<div className="text-xs text-center text-slate-300 leading-tight px-2 whitespace-pre-line">
									{slides[currentSlide + 1]?.substring(0, 30) +
										(slides[currentSlide + 1]?.length > 30 ? "..." : "")}
								</div>
							</Button>
							<span className="text-xs text-slate-400">Next</span>
						</div>
					)}
					{currentSlide + 2 < slides.length && (
						<div className="flex flex-col items-center gap-2">
							<Button
								className="w-full aspect-video h-auto bg-slate-800 border border-slate-600 rounded-lg flex items-center justify-center relative overflow-hidden hover:border-slate-500 cursor-pointer transition-colors p-0"
								onClick={() => advanceSlides(2)}
								variant="ghost"
							>
								<div className="text-xs text-center text-slate-300 leading-tight px-2 whitespace-pre-line">
									{slides[currentSlide + 2]?.substring(0, 30) +
										(slides[currentSlide + 2]?.length > 30 ? "..." : "")}
								</div>
							</Button>
							<span className="text-xs text-slate-400">+1</span>
						</div>
					)}
					{currentSlide + 3 < slides.length && (
						<div className="flex flex-col items-center gap-2">
							<Button
								className="w-full aspect-video h-auto bg-slate-800 border border-slate-600 rounded-lg flex items-center justify-center relative overflow-hidden hover:border-slate-500 cursor-pointer transition-colors p-0"
								onClick={() => advanceSlides(3)}
								variant="ghost"
							>
								<div className="text-xs text-center text-slate-300 leading-tight px-2 whitespace-pre-line">
									{slides[currentSlide + 3]?.substring(0, 30) +
										(slides[currentSlide + 3]?.length > 30 ? "..." : "")}
								</div>
							</Button>
							<span className="text-xs text-slate-400">+2</span>
						</div>
					)}
					{currentSlide + 4 < slides.length && (
						<div className="flex flex-col items-center gap-2">
							<Button
								className="w-full aspect-video h-auto bg-slate-800 border border-slate-600 rounded-lg flex items-center justify-center relative overflow-hidden hover:border-slate-500 cursor-pointer transition-colors p-0"
								onClick={() => advanceSlides(4)}
								variant="ghost"
							>
								<div className="text-xs text-center text-slate-300 leading-tight px-2 whitespace-pre-line">
									{slides[currentSlide + 4]?.substring(0, 30) +
										(slides[currentSlide + 4]?.length > 30 ? "..." : "")}
								</div>
							</Button>
							<span className="text-xs text-slate-400">+3</span>
						</div>
					)}
				</Card>
			</Card>

			<PlayerControls />
		</Card>
	);
};
