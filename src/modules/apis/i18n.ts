import type { I18nAPI } from '../types';

/** Translation lookup against the active profile's locale. */
export function createI18nAPI(): I18nAPI {
  return {
    t(key, params) {
      if (!params) return key;
      return key.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? `{{${k}}}`);
    },
    locale() {
      return navigator.language;
    },
  };
}
