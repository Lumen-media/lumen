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
    notify({ title, message, level = 'info' }) {
      if (level === 'error') {
        toast.error(message, { description: title });
      } else if (level === 'warn') {
        toast.warning(message, { description: title });
      } else {
        toast.info(message, { description: title });
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
      _bgPickerOpener?.(onSelect);
    },
  };
}
