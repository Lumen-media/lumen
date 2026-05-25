import { invoke } from '@tauri-apps/api/core';
import type { DataAPI, DataJsonAPI, Migration, SqliteHandle } from '../types';

function createJsonAPI(moduleId: string): DataJsonAPI {
  return {
    async load() {
      return invoke<unknown>('module_data_json_load', { moduleId });
    },

    async save(value) {
      await invoke('module_data_json_save', { moduleId, value });
    },

    async get<T = unknown>(key: string, fallback?: T): Promise<T> {
      const data = await invoke<Record<string, unknown>>('module_data_json_load', { moduleId });
      const val = data?.[key];
      return (val !== undefined ? val : fallback) as T;
    },

    async set<T>(key: string, value: T) {
      await invoke('module_data_json_set', { moduleId, key, value });
    },

    async delete(key: string) {
      await invoke('module_data_json_delete', { moduleId, key });
    },
  };
}

function createSqliteHandle(moduleId: string): SqliteHandle {
  return {
    async exec(sql, params = []) {
      await invoke('module_data_sqlite_exec', { moduleId, sql, params });
    },

    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      return invoke<T[]>('module_data_sqlite_query', { moduleId, sql, params });
    },

    async migrate(versions: Migration[]) {
      await invoke('module_data_sqlite_migrate', { moduleId, versions });
    },
  };
}

export function createDataAPI(moduleId: string): DataAPI {
  let sqliteHandle: SqliteHandle | undefined;

  return {
    json: createJsonAPI(moduleId),

    async sqlite(): Promise<SqliteHandle> {
      if (!sqliteHandle) {
        await invoke('module_data_sqlite_open', { moduleId });
        sqliteHandle = createSqliteHandle(moduleId);
      }
      return sqliteHandle;
    },
  };
}
