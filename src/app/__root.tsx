import { createRootRoute, Outlet } from "@tanstack/react-router";
import * as React from "react";
import { QuickShortcutsModal } from "@/components/quick-shortcuts-modal";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return (
		<React.Fragment>
			<Outlet />
			<Toaster />
			<QuickShortcutsModal />
		</React.Fragment>
	);
}
