import { create } from 'zustand';
import { emit, listen } from '@tauri-apps/api/event';
import { loadConfig, saveConfigKey } from '@/services/config';
import {
  deleteProfile as deleteProfileFile,
  listProfiles,
  saveProfile,
  type Profile,
} from '@/services/profile-service';
import { useI18nStore } from '@/lib/i18n';
import { type AccentId, type ColorMode, useThemeStore } from './theme-store';

function buildDefaultProfile(): Profile {
  return {
    id: 'default',
    name: 'Default',
    language: localStorage.getItem('lumen-language') ?? 'en',
    colorMode: 'dark',
    accentId: 'cyan',
    defaultBackground: null,
    createdAt: Date.now(),
  };
}

function applyProfile(profile: Profile, localeOverride?: string) {
  const theme = useThemeStore.getState();
  theme.setColorMode(profile.colorMode as ColorMode);
  theme.setAccentId(profile.accentId as AccentId);
  const lang = localeOverride ?? profile.language ?? localStorage.getItem('lumen-language') ?? 'en';
  useI18nStore.getState().setLocale(lang);
}

function broadcastProfileState(state: { profiles: Profile[]; activeProfileId: string | null }) {
  const active = state.profiles.find((p) => p.id === state.activeProfileId);
  const locale = active?.language ?? localStorage.getItem('lumen-language') ?? 'en';
  emit('profile:changed', { ...state, locale }).catch(() => {});
}

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  init: () => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  createProfile: (name: string) => Promise<void>;
  updateProfile: (
    id: string,
    patch: Partial<Pick<Profile, 'name' | 'language' | 'colorMode' | 'accentId' | 'defaultBackground'>>
  ) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  resetProfile: (id: string) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,

  init: async () => {
    let profiles = await listProfiles();

    if (profiles.length === 0) {
      const def = buildDefaultProfile();
      await saveProfile(def);
      profiles = [def];
    }

    const config = await loadConfig();
    let activeProfileId = config.activeProfileId ?? profiles[0].id;

    if (!profiles.find((p) => p.id === activeProfileId)) {
      activeProfileId = profiles[0].id;
    }

    set({ profiles, activeProfileId });
    const active = profiles.find((p) => p.id === activeProfileId);
    if (active) applyProfile(active);

    listen<{ profiles: Profile[]; activeProfileId: string | null; locale: string }>(
      'profile:changed',
      (event) => {
        const next = event.payload;
        const current = get();
        if (JSON.stringify([current.activeProfileId, current.profiles]) === JSON.stringify([next.activeProfileId, next.profiles])) {
          return;
        }
        set({ profiles: next.profiles, activeProfileId: next.activeProfileId });
        const activeProfile = next.profiles.find((p) => p.id === next.activeProfileId);
        if (activeProfile) applyProfile(activeProfile, next.locale);
      },
    ).catch(() => {});
  },

  setActiveProfile: async (id) => {
    const profile = get().profiles.find((p) => p.id === id);
    if (!profile) return;
    set({ activeProfileId: id });
    await saveConfigKey('activeProfileId', id);
    applyProfile(profile);
    broadcastProfileState(get());
  },

  createProfile: async (name) => {
    const { profiles, activeProfileId } = get();
    const current = profiles.find((p) => p.id === activeProfileId);
    const id = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const newProfile: Profile = {
      id,
      name,
      colorMode: current?.colorMode ?? 'dark',
      accentId: current?.accentId ?? 'cyan',
      defaultBackground: null,
      createdAt: Date.now(),
    };
    await saveProfile(newProfile);
    set((s) => ({ profiles: [...s.profiles, newProfile], activeProfileId: id }));
    await saveConfigKey('activeProfileId', id);
    applyProfile(newProfile);
    broadcastProfileState(get());
  },

  updateProfile: async (id, patch) => {
    const updated = get().profiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
    const updatedProfile = updated.find((p) => p.id === id);
    if (!updatedProfile) return;
    await saveProfile(updatedProfile);
    set({ profiles: updated });
    if (get().activeProfileId === id) applyProfile(updatedProfile);
    broadcastProfileState(get());
  },


  removeProfile: async (id) => {
    const { profiles, activeProfileId } = get();
    if (id === 'default' || profiles.length <= 1) return;
    await deleteProfileFile(id);
    const remaining = profiles.filter((p) => p.id !== id);
    let newActiveId = activeProfileId;
    if (activeProfileId === id) {
      newActiveId = remaining[0].id;
      await saveConfigKey('activeProfileId', newActiveId);
      applyProfile(remaining[0]);
    }
    set({ profiles: remaining, activeProfileId: newActiveId });
    broadcastProfileState(get());
  },

  resetProfile: async (id) => {
    await get().updateProfile(id, {
      colorMode: 'dark',
      accentId: 'cyan',
      defaultBackground: null,
    });
  },
}));
