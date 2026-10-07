import { create } from 'zustand';

const ONBOARDING_COMPLETED_KEY = 'lumen-onboarding-completed';

export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
}

interface OnboardingState {
  open: boolean;
  completed: boolean;
  show: () => void;
  complete: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  open: false,
  completed: isOnboardingCompleted(),

  show: () => set({ open: true }),

  complete: () => {
    try {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    } catch {
      /* storage full or unavailable */
    }
    set({ completed: true, open: false });
  },

  reset: () => {
    try {
      localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    } catch {
      /* storage full or unavailable */
    }
    set({ completed: false, open: false });
  },
}));
