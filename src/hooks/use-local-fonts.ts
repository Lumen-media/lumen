import { useCallback, useState } from 'react';

const FALLBACK_FONTS = [
  'Arial',
  'Arial Black',
  'Book Antiqua',
  'Calibri',
  'Cambria',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Franklin Gothic Medium',
  'Garamond',
  'Georgia',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

export function useLocalFonts() {
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS);
  const [loaded, setLoaded] = useState(false);

  const requestFonts = useCallback(async () => {
    if (loaded || !('queryLocalFonts' in window)) return;

    try {
      const localFonts: { family: string }[] = await (
        window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }
      ).queryLocalFonts();

      const families = [...new Set(localFonts.map((f) => f.family))];
      families.sort((a, b) => a.localeCompare(b));
      setFonts(families);
      setLoaded(true);
    } catch {
      // Permission denied — keep fallback
    }
  }, [loaded]);

  return { fonts, requestFonts };
}
