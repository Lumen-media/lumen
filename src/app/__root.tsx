import { createRootRoute, Outlet } from "@tanstack/react-router";
import * as React from "react";
import { QuickShortcutsModal } from "@/components/quick-shortcuts-modal";
import { Toaster } from "@/components/ui/sonner";
import { useSingleInstance } from "@/hooks/use-single-instance";

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	useSingleInstance();

	return (
		<React.Fragment>
			<Outlet />
			<Toaster />
			<QuickShortcutsModal />
		</React.Fragment>
	);
}
