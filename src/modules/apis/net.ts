import type { NetAPI } from '../types';

export function createNetAPI(): NetAPI {
  return {
    async get<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
      const res = await fetch(url, { ...opts, method: 'GET' });
      if (!res.ok) throw new Error(`[net] GET ${url} failed: ${res.status}`);
      return res.json() as Promise<T>;
    },

    async post<T = unknown>(url: string, body: unknown, opts?: RequestInit): Promise<T> {
      const res = await fetch(url, {
        ...opts,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`[net] POST ${url} failed: ${res.status}`);
      return res.json() as Promise<T>;
    },
  };
}
