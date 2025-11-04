import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = Math.floor(seconds % 60);

	const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
	const formattedSeconds =
		remainingSeconds < 10 ? `0${remainingSeconds}` : `${remainingSeconds}`;

	if (hours > 0) {
		return `${hours}:${formattedMinutes}:${formattedSeconds}`;
	}
	return `${formattedMinutes}:${formattedSeconds}`;
}
