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

function initializeTranslationSystem() {
	const checkTauriEnvironment = () => {
		const windowObj = window as any;

		const isTauri = !!(
			windowObj.__TAURI__ ||
			windowObj.__TAURI_INTERNALS__ ||
			window.location.protocol === "tauri:" ||
			navigator.userAgent.includes("Tauri")
		);

		return isTauri;
	};

	const attemptInitialization = (attempt = 1, maxAttempts = 5) => {
		const isTauri = checkTauriEnvironment();

		if (isTauri) {
			import("./lib/translation")
				.then(({ validateSystemConfiguration }) => {
					validateSystemConfiguration().catch(console.error);
				})
				.catch(console.error);
		} else if (attempt < maxAttempts) {
			setTimeout(() => attemptInitialization(attempt + 1, maxAttempts), 1000);
		} else {
			if (typeof window !== "undefined") {
				(window as any).__TRANSLATION_DISABLED__ = true;
			}
		}
	};

	setTimeout(() => attemptInitialization(), 500);
}

createRoot(document.getElementById("root")!).render(<RootWithInitialVideo />);

initializeTranslationSystem();
