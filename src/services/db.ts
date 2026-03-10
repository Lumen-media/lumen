import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('player-state.json');
  }
  return store;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const s = await getStore();
  await s.set(key, value);
}

export async function getSetting(key: string): Promise<string | null> {
  const s = await getStore();
  return (await s.get<string>(key)) ?? null;
}
