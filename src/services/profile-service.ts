import { invoke } from '@tauri-apps/api/core';

export interface Profile {
  id: string;
  name: string;
  language?: string;
  colorMode: 'dark' | 'light';
  accentId: string;
  defaultBackground: {
    type: 'theme' | 'image' | 'video';
    src: string;
    name: string;
  } | null;
  createdAt: number;
}

export async function listProfiles(): Promise<Profile[]> {
  return invoke<Profile[]>('profile_list');
}

export async function saveProfile(profile: Profile): Promise<void> {
  await invoke('profile_save', { profile });
}

export async function deleteProfile(id: string): Promise<void> {
  await invoke('profile_delete', { id });
}