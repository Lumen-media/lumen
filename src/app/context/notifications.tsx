"use client";

import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";

const useNotification = () => {
	const checkPermission = async () => {
		const permission = await isPermissionGranted();
		return permission;
	};

	const request = async () => {
		const permission = await requestPermission();
		return permission;
	};

	return { checkPermission, request };
};

export { useNotification };
