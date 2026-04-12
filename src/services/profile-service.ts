import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { getProfilesPath } from './app-paths';

export interface Profile {
  id: string;
  name: string;
  colorMode: 'dark' | 'light';
  accentId: string;
  defaultBackground: {
    type: 'theme' | 'image' | 'video';
    src: string;
    name: string;
  } | null;
  createdAt: number;
}

async function ensureDir(): Promise<string> {
  const dir = await getProfilesPath();
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function listProfiles(): Promise<Profile[]> {
  const dir = await ensureDir();
  const entries = await readDir(dir);
  const profiles: Profile[] = [];
  for (const entry of entries) {
    if (!entry.name?.endsWith('.json')) continue;
    try {
      const path = await join(dir, entry.name);
      const raw = await readTextFile(path);
      profiles.push(JSON.parse(raw) as Profile);
    } catch {}
  }
  return profiles.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveProfile(profile: Profile): Promise<void> {
  const dir = await ensureDir();
  const path = await join(dir, `${profile.id}.json`);
  await writeTextFile(path, JSON.stringify(profile, null, 2));
}

export async function deleteProfile(id: string): Promise<void> {
  const dir = await getProfilesPath();
  const path = await join(dir, `${id}.json`);
  if (await exists(path)) {
    await remove(path);
  }
}
