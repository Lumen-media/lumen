import {
	Clock,
	Film,
	Folder,
	Home,
	Images,
	LayoutDashboard,
	type LucideIcon,
	Music,
	Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";

interface MenuItem {
	name: string;
	icon: LucideIcon;
	action: () => void;
	id: string;
}

const menuItems: MenuItem[] = [
	{
		id: "home",
		name: "Home",
		icon: Home,
		action: () => console.log("Navegando para Home"),
	},
	{
		id: "presentation",
		name: "Presentation",
		icon: LayoutDashboard,
		action: () => console.log("Opening Presentation"),
	},
	{
		id: "gallery",
		name: "Gallery",
		icon: Images,
		action: () => console.log("Opening Gallery"),
	},
	{
		id: "music",
		name: "Music",
		icon: Music,
		action: () => console.log("Opening Music"),
	},
	{
		id: "videos",
		name: "Videos",
		icon: Film,
		action: () => console.log("Opening Videos"),
	},
	{
		id: "projects",
		name: "Projects",
		icon: Folder,
		action: () => console.log("Opening Projects"),
	},
	{
		id: "recents",
		name: "Recents",
		icon: Clock,
		action: () => console.log("Opening Recents"),
	},
	{
		id: "trash",
		name: "Trash",
		icon: Trash2,
		action: () => console.log("Opening Trash"),
	},
];

export const MediaPanel = () => {
	return (
		<Card className="w-full h-full">
			<header className="flex flex-col">
				<h2>Lumen</h2>
				<p className="text-muted-foreground">C:\Users\User\Lumen</p>
				<Input className="mt-3 bg-background/80 border-0" placeholder="Search..." type="search" />
			</header>

			<div className="flex flex-col gap-1">
				{menuItems.map((item) => {
					const IconComponent = item.icon;
					return (
						<Button key={item.id} className="justify-start" variant="ghost" onClick={item.action}>
							<IconComponent /> {item.name}
						</Button>
					);
				})}
			</div>
		</Card>
	);
};
