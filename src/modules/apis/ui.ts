import { readFile } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import { useModuleStore } from '../store';
import type { SelectedBackground, UIAPI } from '../types';

type BgPickerOpener = (onSelect: (bg: SelectedBackground) => void) => void;
let _bgPickerOpener: BgPickerOpener | null = null;

export function setBackgroundPickerOpener(fn: BgPickerOpener) {
  _bgPickerOpener = fn;
}

export function createUIAPI(openCommandPaletteFn: (prefilter?: string) => void): UIAPI {
  return {
    notify({ title, message, level = 'info', ...rest }) {
      const opts = { description: title, ...rest };
      switch (level) {
        case 'error': toast.error(message, opts); break;
        case 'warn': toast.warning(message, opts); break;
        case 'success': toast.success(message, opts); break;
        case 'loading': toast.loading(message, opts); break;
        case 'custom': toast(message, opts); break;
        default: toast.info(message, opts);
      }
    },

    async confirm({ title, message, danger: _danger }) {
      return new Promise<boolean>((resolve) => {
        if (window.confirm(`${title}\n\n${message}`)) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    },

    async prompt({ title, placeholder, initial }) {
      const result = window.prompt(`${title}`, initial ?? '');
      if (result === null) return null;
      return result || (placeholder ? null : result);
    },

    openCommandPalette(prefilter?: string) {
      openCommandPaletteFn(prefilter);
    },

    openDialog(panelId: string) {
      useModuleStore.getState().openDialog(panelId);
    },

    openBackgroundPicker(onSelect) {
      if (!_bgPickerOpener) return;
      _bgPickerOpener((bg) => {
        const src = bg.src ?? '';
        const isFilePath = src && !src.startsWith('blob:') && !src.startsWith('http') && !src.startsWith('data:');
        if (!isFilePath) { onSelect(bg); return; }
        readFile(src)
          .then((bytes) => URL.createObjectURL(new Blob([bytes])))
          .then((blobUrl) => onSelect({ ...bg, src: blobUrl }))
          .catch(() => onSelect(bg));
      });
    },
  };
}
