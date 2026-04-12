import { readableColor } from 'polished';
import { useEffect } from 'react';
import { ACCENT_PRESETS, useThemeStore } from '@/stores/theme-store';

const DARK_FG = 'oklch(0.21 0.006 285.885)';
const LIGHT_FG = 'oklch(0.985 0 0)';

function getForeground(hex: string): string {
  const readable = readableColor(hex, '#000000', '#ffffff');
  return readable === '#000000' ? DARK_FG : LIGHT_FG;
}

function applyTheme(colorMode: 'dark' | 'light', accentId: string) {
  const root = document.documentElement;

  if (colorMode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const accent = ACCENT_PRESETS.find((p) => p.id === accentId) ?? ACCENT_PRESETS[0];
  const fg = getForeground(accent.hex);

  root.style.setProperty('--primary', accent.oklch);
  root.style.setProperty('--primary-foreground', fg);
  root.style.setProperty('--ring', accent.oklch);
  root.style.setProperty('--sidebar-primary', accent.oklch);
  root.style.setProperty('--sidebar-primary-foreground', fg);
}

export function useTheme() {
  const { colorMode, accentId, setColorMode, setAccentId, init } = useThemeStore();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    applyTheme(colorMode, accentId);
  }, [colorMode, accentId]);

  return { colorMode, accentId, setColorMode, setAccentId };
}
