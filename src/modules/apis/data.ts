import { ipc } from '@/lib/ipc';
import type { DataAPI, DataJsonAPI, Migration, SqliteHandle } from '../types';

function createJsonAPI(moduleId: string): DataJsonAPI {
  return {
    async load() {
      return ipc('module_data_json_load', { moduleId });
    },

    async save(value) {
      await ipc('module_data_json_save', { moduleId, value });
    },

    async get<T = unknown>(key: string, fallback?: T): Promise<T> {
      const data = (await ipc('module_data_json_load', { moduleId })) as Record<
        string,
        unknown
      > | null;
      const val = data?.[key];
      return (val !== undefined ? val : fallback) as T;
    },

    async set<T>(key: string, value: T) {
      await ipc('module_data_json_set', { moduleId, key, value });
    },

    async delete(key: string) {
      await ipc('module_data_json_delete', { moduleId, key });
    },
  };
}

function createSqliteHandle(moduleId: string): SqliteHandle {
  return {
    async exec(sql, params = []) {
      await ipc('module_data_sqlite_exec', { moduleId, sql, params });
    },

    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      return (await ipc('module_data_sqlite_query', { moduleId, sql, params })) as T[];
    },

    async migrate(versions: Migration[]) {
      await ipc('module_data_sqlite_migrate', { moduleId, versions });
    },
  };
}

/**
 * Module-private persistence.
 *
 * Both the JSON document and the SQLite database live under this module's
 * sandbox directory, so a module cannot read another module's data.
 */
export function createDataAPI(moduleId: string): DataAPI {
  let sqliteHandle: SqliteHandle | undefined;

  return {
    json: createJsonAPI(moduleId),

    async sqlite(): Promise<SqliteHandle> {
      if (!sqliteHandle) {
        await ipc('module_data_sqlite_open', { moduleId });
        sqliteHandle = createSqliteHandle(moduleId);
      }
      return sqliteHandle;
    },
  };
}
