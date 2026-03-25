import { useEffect, useState } from 'react';

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

  useEffect(() => {
    let cancelled = false;

    async function loadFonts() {
      if (!('queryLocalFonts' in window)) return;

      try {
        const localFonts: { family: string }[] = await (
          window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }
        ).queryLocalFonts();
        if (cancelled) return;

        const families = [...new Set(localFonts.map((f) => f.family))];
        families.sort((a, b) => a.localeCompare(b));
        setFonts(families);
      } catch {}
    }

    loadFonts();
    return () => {
      cancelled = true;
    };
  }, []);

  return fonts;
}
