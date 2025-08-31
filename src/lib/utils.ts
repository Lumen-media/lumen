import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	const formattedSeconds =
		remainingSeconds < 10 ? `0${remainingSeconds}` : `${remainingSeconds}`;
	return `${minutes}:${formattedSeconds}`;
}
