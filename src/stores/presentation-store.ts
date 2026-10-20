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
  isBlackout: boolean;
  isWallpaper: boolean;

  loadPresentation: (filePath: string, options?: { initialSlide?: number }) => Promise<void>;
  setSlide: (index: number) => void;
  nextSlide: () => void;
  prevSlide: () => void;
  setBlackout: (on: boolean) => void;
  setWallpaper: (on: boolean) => void;
  clearPresentation: () => void;
  updateFromMediaWindow: (currentSlide: number, totalSlides: number) => void;
  setSlides: (slides: PresentationSlide[]) => void;
}

interface PresenterDisplayState {
  wallpaper: boolean;
  hideLyrics: boolean;
  blackout: boolean;
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

    const unlistenDisplayState = await listen<PresenterDisplayState>(
      'presenter:display-state',
      (event) => {
        set({
          isBlackout: event.payload.blackout,
          isWallpaper: event.payload.wallpaper,
        });
      }
    );

    const unlistenRemoteNext = await listen('remote-slide-next', () => {
      const { currentSlide, totalSlides } = get();
      if (currentSlide < totalSlides - 1) {
        emitToMedia('presentation:set-slide', { index: currentSlide + 1 });
      }
    });

    const unlistenRemotePrev = await listen('remote-slide-prev', () => {
      const { currentSlide } = get();
      if (currentSlide > 0) {
        emitToMedia('presentation:set-slide', { index: currentSlide - 1 });
      }
    });

    const unlistenRemoteGoto = await listen<{ index: number }>('remote-slide-goto', (event) => {
      get().setSlide(event.payload.index);
    });

    const unlistenRemoteBlackout = await listen<{ on: boolean }>('remote-blackout', (event) => {
      get().setBlackout(event.payload.on);
    });

    const unlistenRemoteWallpaper = await listen<{ on: boolean }>('remote-wallpaper', (event) => {
      get().setWallpaper(event.payload.on);
    });

    unlisteners.push(unlistenSlideChanged);
    unlisteners.push(unlistenThumbnails);
    unlisteners.push(unlistenPresenterClosed);
    unlisteners.push(unlistenDisplayState);
    unlisteners.push(unlistenRemoteNext);
    unlisteners.push(unlistenRemotePrev);
    unlisteners.push(unlistenRemoteGoto);
    unlisteners.push(unlistenRemoteBlackout);
    unlisteners.push(unlistenRemoteWallpaper);
  }

  setupListeners();

  return {
    filePath: null,
    fileName: null,
    currentSlide: 0,
    totalSlides: 0,
    isActive: false,
    slides: [],
    isBlackout: false,
    isWallpaper: false,

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

    setBlackout: (on: boolean) => {
      if (get().isBlackout === on) return;
      emitToMedia('presenter:blackout-toggle', {});
    },

    setWallpaper: (on: boolean) => {
      if (get().isWallpaper === on) return;
      emitToMedia('presenter:wallpaper-toggle', {});
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
        isBlackout: false,
        isWallpaper: false,
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
