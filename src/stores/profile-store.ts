import { create } from 'zustand';
import { loadConfig, saveConfigKey } from '@/services/config';
import {
  deleteProfile as deleteProfileFile,
  listProfiles,
  saveProfile,
  type Profile,
} from '@/services/profile-service';
import { type AccentId, type ColorMode, useThemeStore } from './theme-store';

function buildDefaultProfile(): Profile {
  return {
    id: 'default',
    name: 'Default',
    colorMode: 'dark',
    accentId: 'cyan',
    defaultBackground: null,
    createdAt: Date.now(),
  };
}

function applyProfile(profile: Profile) {
  const store = useThemeStore.getState();
  store.setColorMode(profile.colorMode as ColorMode);
  store.setAccentId(profile.accentId as AccentId);
}

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  init: () => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  createProfile: (name: string) => Promise<void>;
  updateProfile: (
    id: string,
    patch: Partial<Pick<Profile, 'name' | 'colorMode' | 'accentId' | 'defaultBackground'>>
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
  },

  setActiveProfile: async (id) => {
    const profile = get().profiles.find((p) => p.id === id);
    if (!profile) return;
    set({ activeProfileId: id });
    await saveConfigKey('activeProfileId', id);
    applyProfile(profile);
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
  },

  updateProfile: async (id, patch) => {
    const updated = get().profiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
    const updatedProfile = updated.find((p) => p.id === id);
    if (!updatedProfile) return;
    await saveProfile(updatedProfile);
    set({ profiles: updated });
    if (get().activeProfileId === id) applyProfile(updatedProfile);
  },

  removeProfile: async (id) => {
    const { profiles, activeProfileId } = get();
    if (profiles.length <= 1) return;
    await deleteProfileFile(id);
    const remaining = profiles.filter((p) => p.id !== id);
    let newActiveId = activeProfileId;
    if (activeProfileId === id) {
      newActiveId = remaining[0].id;
      await saveConfigKey('activeProfileId', newActiveId);
      applyProfile(remaining[0]);
    }
    set({ profiles: remaining, activeProfileId: newActiveId });
  },

  resetProfile: async (id) => {
    await get().updateProfile(id, {
      colorMode: 'dark',
      accentId: 'cyan',
      defaultBackground: null,
    });
  },
}));
