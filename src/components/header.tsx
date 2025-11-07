import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card } from "./ui/card";
import { NavigationMenu, NavigationMenuItem, NavigationMenuList } from "./ui/navigation-menu";

export const Header = () => {
	const location = useLocation();
	const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
	const navRef = useRef<HTMLDivElement>(null);

	const pages = [
		{ name: "Edit", href: "/edit" },
		{ name: "View", href: "/view" },
		{ name: "Presentation", href: "/" },
		{ name: "Live", href: "/live" },
		{ name: "Settings", href: "/settings" },
	];

	useEffect(() => {
		const activeIndex = pages.findIndex((page) => page.href === location.pathname);
		if (activeIndex !== -1 && navRef.current) {
			const navItems = navRef.current.querySelectorAll("[data-nav-item]");
			const activeItem = navItems[activeIndex] as HTMLElement;

			if (activeItem) {
				const navRect = navRef.current.getBoundingClientRect();
				const itemRect = activeItem.getBoundingClientRect();

				setIndicatorStyle({
					left: itemRect.left - navRect.left,
					width: itemRect.width,
				});
			}
		}
	}, [location.pathname]);

	return (
		<Card className="flex-row justify-between gap-3">
			<div className="flex items-center gap-3 font-bold w-1/3">
				<img className="size-8" src="/logo.png" alt="Lumen logo" /> <h3>Lumen</h3>
			</div>

			<div className="pages relative flex items-center justify-center gap-1 w-fit" ref={navRef}>
				<NavigationMenu>
					<NavigationMenuList className="gap-3.5">
						{pages.map((page) => (
							<NavigationMenuItem key={page.name}>
								<Link
									to={page.href}
									data-nav-item
									className={`relative ${location.pathname === page.href ? "text-primary" : ""}`}
								>
									{page.name}
								</Link>
							</NavigationMenuItem>
						))}
					</NavigationMenuList>
				</NavigationMenu>

				<div
					className="absolute bottom-0 h-0.5 bg-primary transition-all duration-300 ease-out"
					style={{
						left: `${indicatorStyle.left}px`,
						width: `${indicatorStyle.width}px`,
					}}
				/>
			</div>

			<div className="flex items-center justify-center w-1/3" />
		</Card>
	);
};
