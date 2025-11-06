import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import "./i18n";

import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const RootWithInitialVideo = () => {
	return (
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>
	);
};

if (typeof window !== "undefined" && (window as any).__TAURI__) {
	import("./lib/translation")
		.then(({ validateSystemConfiguration }) => {
			validateSystemConfiguration().catch(console.error);
		})
		.catch(console.error);
} else {
	console.log("ℹ️ Running in browser - translation system disabled");
}

createRoot(document.getElementById("root")!).render(<RootWithInitialVideo />);
