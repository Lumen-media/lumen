import { Toaster } from "@/components/ui/sonner";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import * as React from "react";

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return (
		<React.Fragment>
			<Outlet />
			<Toaster />
		</React.Fragment>
	);
}
