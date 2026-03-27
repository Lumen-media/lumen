import { invoke } from '@tauri-apps/api/core';
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
    invoke<string[]>('get_system_fonts')
      .then((families) => {
        if (families.length > 0) setFonts(families);
      })
      .catch(() => {});
  }, []);

  return { fonts };
}
