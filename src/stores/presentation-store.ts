import { emit, listen } from '@tauri-apps/api/event';
import { create } from 'zustand';

export interface PresentationSlide {
  index: number;
  thumbnail: string;
  label: string;
}

export interface PresentationStore {
  filePath: string | null;
  fileName: string | null;
  currentSlide: number;
  totalSlides: number;
  isActive: boolean;
  slides: PresentationSlide[];

  loadPresentation: (filePath: string, options?: { initialSlide?: number }) => Promise<void>;
  setSlide: (index: number) => void;
  nextSlide: () => void;
  prevSlide: () => void;
  clearPresentation: () => void;
  updateFromMediaWindow: (currentSlide: number, totalSlides: number) => void;
  setSlides: (slides: PresentationSlide[]) => void;
}

export const usePresentationStore = create<PresentationStore>((set, get) => {
  const unlisteners: Array<() => void> = [];

  function emitToMedia(event: string, payload: unknown) {
    emit(event, payload).catch(() => {});
  }

  async function setupListeners() {
    const unlistenSlideChanged = await listen<{
      currentSlide: number;
      totalSlides: number;
    }>('presentation:slide-changed', (event) => {
      set({
        currentSlide: event.payload.currentSlide,
        totalSlides: event.payload.totalSlides,
      });
    });

    const unlistenThumbnails = await listen<{
      thumbs: Array<{ index: number; dataUrl: string; label: string }>;
    }>('presentation:thumbnails-ready', (event) => {
      const slides = event.payload.thumbs.map((t) => ({
        index: t.index,
        thumbnail: t.dataUrl,
        label: t.label,
      }));
      set({ slides });
    });

    const unlistenPresenterClosed = await listen('presentation:presenter-closed', () => {
      set({ isActive: false });
    });

    unlisteners.push(unlistenSlideChanged);
    unlisteners.push(unlistenThumbnails);
    unlisteners.push(unlistenPresenterClosed);
  }

  setupListeners();

  return {
    filePath: null,
    fileName: null,
    currentSlide: 0,
    totalSlides: 0,
    isActive: false,
    slides: [],

    loadPresentation: async (filePath: string, options) => {
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      set({
        filePath,
        fileName,
        currentSlide: options?.initialSlide ?? 0,
        totalSlides: 0,
        isActive: true,
        slides: [],
      });

      emitToMedia('presentation:load', { filePath, fileName, initialSlide: options?.initialSlide ?? 0 });
    },

    setSlide: (index: number) => {
      const { totalSlides } = get();
      const clamped = Math.max(0, Math.min(index, totalSlides - 1));
      emitToMedia('presentation:set-slide', { index: clamped });
    },

    nextSlide: () => {
      const { currentSlide, totalSlides } = get();
      if (currentSlide < totalSlides - 1) {
        emitToMedia('presentation:set-slide', { index: currentSlide + 1 });
      }
    },

    prevSlide: () => {
      const { currentSlide } = get();
      if (currentSlide > 0) {
        emitToMedia('presentation:set-slide', { index: currentSlide - 1 });
      }
    },

    clearPresentation: () => {
      emitToMedia('presentation:clear', {});
      set({
        filePath: null,
        fileName: null,
        currentSlide: 0,
        totalSlides: 0,
        isActive: false,
        slides: [],
      });
    },

    updateFromMediaWindow: (currentSlide: number, totalSlides: number) => {
      set({ currentSlide, totalSlides });
    },

    setSlides: (slides: PresentationSlide[]) => {
      set({ slides });
    },
  };
});
