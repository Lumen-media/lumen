import { create } from 'zustand';
import { type LyricData, lyricService } from '@/services/lyric-service';

const STORAGE_KEY = 'lyric-edit-last-path';

interface LyricEditStore {
  filePath: string | null;
  lyricData: LyricData | null;
  slideIds: string[];
  selectedSlideIndex: number | null;
  isLoading: boolean;
  loadLyric: (filePath: string) => Promise<void>;
  restore: () => Promise<void>;
  selectSlide: (index: number | null) => void;
  clear: () => void;
}

export const useLyricEditStore = create<LyricEditStore>((set, get) => ({
  filePath: null,
  lyricData: null,
  slideIds: [],
  selectedSlideIndex: null,
  isLoading: false,

  loadLyric: async (filePath: string) => {
    if (get().filePath === filePath) return;
    set({ isLoading: true, filePath, selectedSlideIndex: null });
    try {
      const data = await lyricService.load(filePath);
      const slideIds = data.slides.map(() => crypto.randomUUID());
      localStorage.setItem(STORAGE_KEY, filePath);
      set({ lyricData: data, slideIds, isLoading: false });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      set({ filePath: null, lyricData: null, slideIds: [], isLoading: false });
    }
  },

  restore: async () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    await get().loadLyric(saved);
  },

  selectSlide: (index) => set({ selectedSlideIndex: index }),

  clear: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ filePath: null, lyricData: null, slideIds: [], selectedSlideIndex: null });
  },
}));
