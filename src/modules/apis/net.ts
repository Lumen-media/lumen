import { invoke } from '@tauri-apps/api/core';
import type { NetAPI, NetRequest, NetResponse, NetError, NetQueryValue } from '../types';

function normalizeQueryValue(v: NetQueryValue | NetQueryValue[]): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined) return [''];
  return [String(v)];
}

export function createNetAPI(moduleId: string): NetAPI {
  return {
    async request<T = unknown>(input: NetRequest): Promise<NetResponse<T>> {
      const normalized: Record<string, unknown> = {};

      normalized.url = input.url;
      if (input.method) normalized.method = input.method;
      if (input.query) {
        normalized.query = Object.fromEntries(
          Object.entries(input.query).map(([k, v]) => [k, normalizeQueryValue(v)]),
        );
      }
      if (input.headers) normalized.headers = input.headers;
      if (input.body) normalized.body = input.body;
      if (input.responseType) normalized.responseType = input.responseType;
      if (input.timeoutMs !== undefined) normalized.timeoutMs = input.timeoutMs;
      if (input.maxBytes !== undefined) normalized.maxBytes = input.maxBytes;
      if (input.followRedirects !== undefined) normalized.followRedirects = input.followRedirects;

      return invoke<NetResponse<T>>('module_net_request', {
        moduleId,
        input: normalized,
      });
    },

    async get<T = unknown>(
      url: string,
      opts?: Omit<NetRequest, 'url' | 'method' | 'body'>,
    ): Promise<T> {
      const response = await this.request<T>({ ...opts, url, method: 'GET' });
      if (!response.ok) {
        const err = new Error(`GET ${url} failed: ${response.status}`) as NetError;
        err.code = 'network_error';
        err.status = response.status;
        err.url = url;
        throw err;
      }
      return response.data;
    },

    async post<T = unknown>(
      url: string,
      body?: NetRequestBody | unknown,
      opts?: Omit<NetRequest, 'url' | 'method' | 'body'>,
    ): Promise<T> {
      let normalizedBody = body;
      if (body !== undefined && !(typeof body === 'object' && body !== null && 'type' in body)) {
        normalizedBody = { type: 'json' as const, value: body };
      }
      const response = await this.request<T>({
        ...opts,
        url,
        method: 'POST',
        body: normalizedBody as never,
      });
      if (!response.ok) {
        const err = new Error(`POST ${url} failed: ${response.status}`) as NetError;
        err.code = 'network_error';
        err.status = response.status;
        err.url = url;
        throw err;
      }
      return response.data;
    },
  };
}
