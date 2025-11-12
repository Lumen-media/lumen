import { useCallback, useEffect, useState } from "react";
import {
	type DisplayInfo,
	dualScreenController,
	type PresentationState,
} from "../services/dualScreenController";

export function useDualScreen() {
	const [displays, setDisplays] = useState<DisplayInfo[]>([]);
	const [isMediaWindowOpen, setIsMediaWindowOpen] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadDisplays = useCallback(async () => {
		try {
			const availableDisplays = await dualScreenController.getAvailableDisplays();
			setDisplays(availableDisplays);
		} catch (err) {
			console.error("Failed to load displays:", err);
			setError(err instanceof Error ? err.message : "Failed to load displays");
		}
	}, []);

	const checkMediaWindowStatus = useCallback(async () => {
		try {
			const isOpen = await dualScreenController.isMediaWindowOpen();
			setIsMediaWindowOpen(isOpen);
		} catch (err) {
			console.error("Failed to check media window status:", err);
		}
	}, []);

	useEffect(() => {
		loadDisplays();
	}, [loadDisplays]);

	useEffect(() => {
		checkMediaWindowStatus();
	}, [checkMediaWindowStatus]);

	useEffect(() => {
		const unsubscribe = dualScreenController.subscribeToStateChanges((state) => {
			console.log("Presentation state updated:", state);
		});

		return () => {
			unsubscribe();
		};
	}, []);

	const createMediaWindow = useCallback(async (displayId?: number) => {
		setIsLoading(true);
		setError(null);
		try {
			await dualScreenController.createMediaWindow(displayId);
			setIsMediaWindowOpen(true);
			return true;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to create media window";
			setError(errorMessage);
			console.error("Failed to create media window:", err);
			return false;
		} finally {
			setIsLoading(false);
		}
	}, []);

	const closeMediaWindow = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			await dualScreenController.closeMediaWindow();
			setIsMediaWindowOpen(false);
			return true;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to close media window";
			setError(errorMessage);
			console.error("Failed to close media window:", err);
			return false;
		} finally {
			setIsLoading(false);
		}
	}, []);

	const syncPresentationState = useCallback(async (state: PresentationState) => {
		try {
			await dualScreenController.syncPresentationState(state);
			return true;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to sync presentation state";
			setError(errorMessage);
			console.error("Failed to sync presentation state:", err);
			return false;
		}
	}, []);

	const moveWindowToDisplay = useCallback(async (windowLabel: string, displayId: number) => {
		setIsLoading(true);
		setError(null);
		try {
			await dualScreenController.moveWindowToDisplay(windowLabel, displayId);
			return true;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to move window";
			setError(errorMessage);
			console.error("Failed to move window:", err);
			return false;
		} finally {
			setIsLoading(false);
		}
	}, []);

	return {
		displays,
		isMediaWindowOpen,
		isLoading,
		error,
		createMediaWindow,
		closeMediaWindow,
		syncPresentationState,
		moveWindowToDisplay,
		refreshDisplays: loadDisplays,
		checkMediaWindowStatus,
	};
}
