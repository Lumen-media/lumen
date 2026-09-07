import { detectPlatform, formatForDisplay, validateHotkey } from '@tanstack/react-hotkeys';
import { SHORTCUTS } from './default-shortcuts';

export function isMacPlatform(): boolean {
  return detectPlatform() === 'mac';
}

export function hotkeyDisplayTokens(hotkey: string): string[] {
  const formatted = formatForDisplay(hotkey);
  return formatted.split(isMacPlatform() ? ' ' : '+');
}

export function formatShortcutForDisplay(shortcut: string): string {
  try {
    return validateHotkey(shortcut).valid ? formatForDisplay(shortcut) : shortcut;
  } catch {
    return shortcut;
  }
}

export function menuShortcut(id: string): string | undefined {
  return SHORTCUTS.find((def) => def.id === id)?.keys[0];
}

export function shortcutAction(id: string): (() => void) | undefined {
  return SHORTCUTS.find((def) => def.id === id)?.action;
}