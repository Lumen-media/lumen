import { useHotkeys } from '@tanstack/react-hotkeys';
import type { Hotkey, UseHotkeyDefinition, UseHotkeyOptions } from '@tanstack/react-hotkeys';
import { SHORTCUTS } from './default-shortcuts';
import type { ShortcutGate, ShortcutScope } from './types';

const EMPTY_GATES: ShortcutGate = { presenter: false };

export type ScopedShortcutActions = Record<string, () => void>;
export type ScopedShortcutOptions = Record<
  string,
  Pick<UseHotkeyOptions, 'enabled' | 'ignoreInputs' | 'preventDefault' | 'requireReset'>
>;

export function useScopedShortcuts(
  scope: ShortcutScope,
  actions?: ScopedShortcutActions,
  options?: ScopedShortcutOptions,
  gates?: ShortcutGate,
): void {
  const hotkeys: UseHotkeyDefinition[] = [];
  for (const def of SHORTCUTS) {
    if (def.scope !== scope || def.keys.length === 0) continue;
    const action = actions?.[def.id] ?? def.action;
    if (!action) continue;
    const enabled =
      typeof def.enabled === 'function' ? def.enabled(gates ?? EMPTY_GATES) : (def.enabled ?? true);
    const entryOptions: UseHotkeyOptions = {
      conflictBehavior: 'allow',
      enabled,
      meta: { name: def.name, description: def.description, group: def.group },
      ...options?.[def.id],
    };
    for (const key of def.keys) {
      hotkeys.push({
        hotkey: key as Hotkey,
        callback: () => action(),
        options: entryOptions,
      });
    }
  }
  useHotkeys(hotkeys);
}