import type { Disposable, SettingSpec, SettingsAPI } from '../types';

export function createSettingsAPI(moduleId: string): SettingsAPI {
  const values = new Map<string, unknown>();
  const specs = new Map<string, SettingSpec>();
  const listeners = new Map<string, Set<(v: unknown) => void>>();

  return {
    register<T>(spec: SettingSpec<T>): Disposable {
      specs.set(spec.key, spec as SettingSpec<unknown>);
      if (!values.has(spec.key)) {
        values.set(spec.key, spec.default);
      }
      return {
        dispose() {
          specs.delete(spec.key);
        },
      };
    },

    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },

    set<T>(key: string, value: T) {
      values.set(key, value);
      const handlers = listeners.get(key);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(value);
          } catch (err) {
            console.error(`[settings:${moduleId}] onChange error for key "${key}":`, err);
          }
        }
      }
    },

    onChange<T>(key: string, handler: (value: T) => void): Disposable {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(handler as (v: unknown) => void);
      return {
        dispose() {
          listeners.get(key)?.delete(handler as (v: unknown) => void);
        },
      };
    },
  };
}
