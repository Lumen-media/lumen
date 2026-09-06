import { useHotkeys } from '@tanstack/react-hotkeys';
import type { Hotkey, UseHotkeyDefinition, UseHotkeyOptions } from '@tanstack/react-hotkeys';
import { useModuleStore } from '@/modules/store';
import { usePlayerStore } from '@/stores/player-store';
import { usePresentationStore } from '@/stores/presentation-store';
import { SHORTCUTS } from './default-shortcuts';
import type { ShortcutGate } from './types';

export function GlobalShortcuts() {
  const presentationActive = usePresentationStore((s) => s.isActive);
  const lyricPath = usePlayerStore((s) => s.currentLyricPath);
  const imagePath = usePlayerStore((s) => s.currentImagePath);
  const presenterViewId = useModuleStore((s) => s.presenterViewId);

  const gates: ShortcutGate = {
    presenter: Boolean(lyricPath || imagePath || presenterViewId || presentationActive),
  };

  const hotkeys: UseHotkeyDefinition[] = [];
  for (const def of SHORTCUTS) {
    if (def.scope !== 'global' || def.keys.length === 0 || !def.action) continue;
    const enabled = typeof def.enabled === 'function' ? def.enabled(gates) : (def.enabled ?? true);
    const options: UseHotkeyOptions = {
      enabled,
      meta: { name: def.name, description: def.description, group: def.group },
    };
    for (const key of def.keys) {
      hotkeys.push({
        hotkey: key as Hotkey,
        callback: () => def.action?.(),
        options,
      });
    }
  }

  useHotkeys(hotkeys);
  return null;
}