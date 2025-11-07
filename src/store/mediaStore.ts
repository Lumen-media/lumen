/**
 * Media Store - Zustand state management for media items and presentation control
 *
 * This store manages:
 * - Media items (text slides, videos, PPTX presentations)
 * - Presentation state (current media, slide index, presenting status)
 * - Presentation controls (start, stop, navigation)
 * - PPTX conversion state tracking
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { MediaItem, MediaType, PptxMetadata } from "../types/media";
import type { VideoState } from "../types/presentation";

interface MediaStoreState {
	mediaItems: MediaItem[];

	currentMediaId: string | null;
	currentSlideIndex: number;
	isPresenting: boolean;
	secondaryWindowId: string | null;
	videoState: VideoState | null;

	addMediaItem: (item: Omit<MediaItem, "id" | "createdAt" | "updatedAt">) => string;
	updateMediaItem: (id: string, updates: Partial<Omit<MediaItem, "id" | "createdAt">>) => void;
	deleteMediaItem: (id: string) => void;
	getMediaItemsByType: (type: MediaType) => MediaItem[];
	getMediaItemById: (id: string) => MediaItem | undefined;

	startPresentation: (mediaId: string, displayId?: number) => void;
	stopPresentation: () => void;
	nextSlide: () => void;
	previousSlide: () => void;
	goToSlide: (index: number) => void;
	setSecondaryWindowId: (windowId: string | null) => void;

	updateVideoState: (state: Partial<VideoState>) => void;

	updatePptxConversionStatus: (
		mediaId: string,
		status: PptxMetadata["conversionStatus"],
		error?: string
	) => void;
	setPptxPdfBytes: (mediaId: string, pdfBytes: Uint8Array) => void;
}

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const useMediaStore = create<MediaStoreState>()(
	devtools(
		persist(
			(set, get) => ({
				mediaItems: [],
				currentMediaId: null,
				currentSlideIndex: 0,
				isPresenting: false,
				secondaryWindowId: null,
				videoState: null,

				addMediaItem: (item) => {
					const id = generateId();
					const now = new Date();

					const newItem: MediaItem = {
						...item,
						id,
						createdAt: now,
						updatedAt: now,
					};

					set((state) => ({
						mediaItems: [...state.mediaItems, newItem],
					}));

					return id;
				},

				updateMediaItem: (id, updates) => {
					set((state) => ({
						mediaItems: state.mediaItems.map((item) =>
							item.id === id
								? {
										...item,
										...updates,
										updatedAt: new Date(),
									}
								: item
						),
					}));
				},

				deleteMediaItem: (id) => {
					set((state) => {
						const shouldStopPresentation = state.currentMediaId === id && state.isPresenting;

						return {
							mediaItems: state.mediaItems.filter((item) => item.id !== id),
							...(shouldStopPresentation && {
								currentMediaId: null,
								isPresenting: false,
								currentSlideIndex: 0,
								videoState: null,
							}),
						};
					});
				},

				getMediaItemsByType: (type) => {
					return get().mediaItems.filter((item) => item.type === type);
				},

				getMediaItemById: (id) => {
					return get().mediaItems.find((item) => item.id === id);
				},

				startPresentation: (mediaId, _displayId) => {
					const mediaItem = get().getMediaItemById(mediaId);

					if (!mediaItem) {
						console.error(`Media item with id ${mediaId} not found`);
						return;
					}

					set({
						currentMediaId: mediaId,
						isPresenting: true,
						currentSlideIndex: 0,
						videoState:
							mediaItem.type === "video"
								? {
										playing: false,
										currentTime: 0,
										duration: 0,
										volume: 1,
										muted: false,
										playbackRate: 1,
									}
								: null,
					});
				},

				stopPresentation: () => {
					set({
						currentMediaId: null,
						isPresenting: false,
						currentSlideIndex: 0,
						secondaryWindowId: null,
						videoState: null,
					});
				},

				nextSlide: () => {
					const { currentMediaId, currentSlideIndex } = get();

					if (!currentMediaId) return;

					const mediaItem = get().getMediaItemById(currentMediaId);

					if (!mediaItem || mediaItem.type !== "pptx") return;

					const pptxMetadata = mediaItem.metadata as PptxMetadata;
					const maxSlideIndex = pptxMetadata.slideCount - 1;

					if (currentSlideIndex < maxSlideIndex) {
						set({ currentSlideIndex: currentSlideIndex + 1 });
					}
				},

				previousSlide: () => {
					const { currentSlideIndex } = get();

					if (currentSlideIndex > 0) {
						set({ currentSlideIndex: currentSlideIndex - 1 });
					}
				},

				goToSlide: (index) => {
					const { currentMediaId } = get();

					if (!currentMediaId) return;

					const mediaItem = get().getMediaItemById(currentMediaId);

					if (!mediaItem || mediaItem.type !== "pptx") return;

					const pptxMetadata = mediaItem.metadata as PptxMetadata;
					const maxSlideIndex = pptxMetadata.slideCount - 1;

					const clampedIndex = Math.max(0, Math.min(index, maxSlideIndex));

					set({ currentSlideIndex: clampedIndex });
				},

				setSecondaryWindowId: (windowId) => {
					set({ secondaryWindowId: windowId });
				},

				updateVideoState: (state) => {
					set((prevState) => ({
						videoState: prevState.videoState ? { ...prevState.videoState, ...state } : null,
					}));
				},

				updatePptxConversionStatus: (mediaId, status, error) => {
					set((state) => ({
						mediaItems: state.mediaItems.map((item) => {
							if (item.id === mediaId && item.type === "pptx") {
								const pptxMetadata = item.metadata as PptxMetadata;
								return {
									...item,
									metadata: {
										...pptxMetadata,
										conversionStatus: status,
										conversionError: error,
									},
									updatedAt: new Date(),
								};
							}
							return item;
						}),
					}));
				},

				setPptxPdfBytes: (mediaId, pdfBytes) => {
					set((state) => ({
						mediaItems: state.mediaItems.map((item) => {
							if (item.id === mediaId && item.type === "pptx") {
								const pptxMetadata = item.metadata as PptxMetadata;
								return {
									...item,
									metadata: {
										...pptxMetadata,
										pdfBytes,
										conversionStatus: "completed" as const,
									},
									updatedAt: new Date(),
								};
							}
							return item;
						}),
					}));
				},
			}),
			{
				name: "media-store",
				partialize: (state) => ({
					mediaItems: state.mediaItems.map((item) => {
						if (item.type === "pptx") {
							const { pdfBytes, ...rest } = item.metadata as PptxMetadata;
							return {
								...item,
								metadata: rest,
							};
						}
						return item;
					}),
				}),
			}
		),
		{
			name: "MediaStore",
		}
	)
);

export const useCurrentMedia = () => {
	const currentMediaId = useMediaStore((state) => state.currentMediaId);
	const getMediaItemById = useMediaStore((state) => state.getMediaItemById);
	return currentMediaId ? getMediaItemById(currentMediaId) : null;
};

export const useIsPresenting = () => useMediaStore((state) => state.isPresenting);

export const useCurrentSlideIndex = () => useMediaStore((state) => state.currentSlideIndex);

export const useVideoState = () => useMediaStore((state) => state.videoState);

export const useMediaItems = () => useMediaStore((state) => state.mediaItems);

export const useMediaItemsByType = (type: MediaType) => {
	return useMediaStore((state) => state.getMediaItemsByType(type));
};
