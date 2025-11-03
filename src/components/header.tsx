import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
} from "./ui/navigation-menu";

export const Header = () => {
	const pages = [
		{ name: "Edit", href: "/edit" },
		{ name: "View", href: "/view" },
		{ name: "Presentation", href: "/" },
		{ name: "Live", href: "/live" },
		{ name: "Settings", href: "/settings" },
	];

	const openVideoWindow = async () => {
		const testVideoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
		try {
			await invoke("open_video_window", { videoUrl: testVideoUrl });
		} catch (error) {
			console.error("Error opening video window:", error);
		}
	};

	return (
		<Card className="flex-row justify-between gap-3">
			<div className="flex items-center gap-3 font-bold w-1/3">
				<img className="size-8" src="/logo.png" alt="Lumen logo" />{" "}
				<h3>Lumen</h3>
			</div>

			<div className="pages relative flex items-center justify-center gap-1 w-fit">
				<NavigationMenu>
					<NavigationMenuList className="gap-3.5">
						{pages.map((page) => (
							<NavigationMenuItem key={page.name}>
								<NavigationMenuLink href={page.href}>
									{page.name}
								</NavigationMenuLink>
							</NavigationMenuItem>
						))}
					</NavigationMenuList>
				</NavigationMenu>
			</div>

			<div className="flex items-center justify-center w-1/3">
				<Button onClick={openVideoWindow}>Open Video Window</Button>
			</div>
		</Card>
	);
};
