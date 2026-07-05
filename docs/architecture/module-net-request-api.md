# Module Net Request API

## Goal

Give Lumen modules a generic, host-managed HTTP client that works for external APIs without exposing privileged networking directly to module code.

The API must be broad enough for integrations such as YouTube, GitHub, Bible APIs, planning tools, cloud storage metadata, webhooks, and small file endpoints. It should not be tied to any single provider. The Lumen host owns native request execution, permission checks, timeouts, response limits, redirect validation, and future credential handling.

The immediate pressure is the YouTube module, but the contract should be generic platform infrastructure.

## Current State

There is an important split today:

- The Lumen app repo has an internal `NetAPI` in `src/modules/types.ts` and wires `host.net` in `src/modules/apis/net.ts`.
- The published/local `@lumen-media/module-sdk` repo does not currently expose `net` on `LumenHost`.
- The app-side implementation is renderer-backed and currently calls browser `fetch()`.
- The app docs mention `host.net` in `docs/module-api-reference.md`, but the SDK contract needs to catch up before third-party modules can rely on it.

Current app-side shape, with no known module consumers today:

```ts
host.net.get(url, opts)
host.net.post(url, body, opts)
```

Because no module currently consumes `host.net`, this should be treated as a contract redesign instead of a compatibility migration.

## SDK Coordination

This is a cross-repository change. The Lumen app cannot ship the final `host.net` contract alone because modules compile against `@lumen-media/module-sdk`.

Required SDK work in `Lumen-media/module-sdk`:

- Add `NetAPI`, `NetRequest`, `NetRequestBody`, `NetResponse`, `NetError`, and related helper types.
- Add `net: NetAPI` to `LumenHost`.
- Add `permissions.network` to `manifest.schema.json` and manifest TypeScript types.
- Update SDK docs and examples so module authors use `host.net.request()`.
- Release a new SDK version, then update the Lumen app dependency/contract to match.

Required Lumen app work:

- Update the app's internal module host types to match the SDK.
- Implement `host.net.request()` through Rust/Tauri.
- Validate `permissions.network` from installed module manifests.
- Keep app docs aligned with the SDK public contract.
## Decision

Make `host.net.request()` the primary public API. Implement it through a Tauri command backed by Rust HTTP client code.

```txt
module code
  -> host.net.request(input)
  -> Tauri invoke
  -> Rust validates module permissions and URL
  -> Rust builds and executes the HTTP request
  -> Rust normalizes response or error
  -> SDK returns NetResponse to module
```

`host.net.get()` and `host.net.post()` may exist as convenience helpers, but they should be thin SDK wrappers over `request()` and should not define the core contract.

## Design Principles

- Provider-neutral: no YouTube, GitHub, or app-specific concepts in `host.net`.
- Structured: avoid exposing browser `RequestInit` directly because it is not stable across native execution.
- Serializable: every request/response shape must cross the Tauri boundary cleanly.
- Explicit body and response modes: JSON, text, bytes, and common form bodies need clear representation.
- Safe by default: permission checks, denied local networks, size limits, timeouts, and redirect validation are host responsibilities.
- Small-response oriented: `host.net.request()` is for API calls and modest assets, not unbounded downloads or media mirroring.
- Evolvable: large downloads, streaming, secrets, and OAuth can become separate host services later.

## SDK Shape

```ts
export type NetMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
export type NetResponseType = 'json' | 'text' | 'bytes' | 'none';

export type NetQueryValue = string | number | boolean | null | undefined;

export type NetRequestBody =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string; contentType?: string }
  | { type: 'bytes'; valueBase64: string; contentType?: string }
  | { type: 'form'; value: Record<string, NetQueryValue> }
  | {
      type: 'multipart';
      parts: Array<
        | { name: string; type: 'text'; value: string; contentType?: string }
        | {
            name: string;
            type: 'bytes';
            valueBase64: string;
            filename?: string;
            contentType?: string;
          }
      >;
    };

export interface NetRequest {
  url: string;
  method?: NetMethod;
  query?: Record<string, NetQueryValue | NetQueryValue[]>;
  headers?: Record<string, string>;
  body?: NetRequestBody;
  responseType?: NetResponseType;
  timeoutMs?: number;
  maxBytes?: number;
  followRedirects?: boolean;
}

export interface NetResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  redirected: boolean;
  data: T;
}

export interface NetAPI {
  request<T = unknown>(input: NetRequest): Promise<NetResponse<T>>;

  // Optional convenience helpers. These are SDK sugar, not the core contract.
  get?<T = unknown>(url: string, opts?: Omit<NetRequest, 'url' | 'method' | 'body'>): Promise<T>;
  post?<T = unknown>(
    url: string,
    body?: NetRequestBody | unknown,
    opts?: Omit<NetRequest, 'url' | 'method' | 'body'>
  ): Promise<T>;
}
```

### Defaults

- `method`: `GET` when `body` is absent, `POST` when `body` is present.
- `responseType`: `json` when response `Content-Type` looks JSON, otherwise `text`. Modules can set it explicitly.
- `timeoutMs`: 15 seconds.
- `maxBytes`: 10 MB.
- `followRedirects`: `true`, with each redirect revalidated against module permissions.

### Convenience Helpers

If shipped, `get()` and `post()` should:

- Call `request()` internally.
- Throw on non-2xx responses.
- Return `response.data` directly.
- Use the same structured options as `request()`, not browser `RequestInit`.

Example:

```ts
const data = await host.net.get?.<SearchResponse>(
  'https://www.googleapis.com/youtube/v3/search',
  {
    query: {
      part: 'snippet',
      type: 'video',
      q: 'oceans hillsong',
      key: apiKey,
      maxResults: 10,
    },
  }
);
```

## Examples

### JSON GET

```ts
const response = await host.net.request<YoutubeSearchResponse>({
  method: 'GET',
  url: 'https://www.googleapis.com/youtube/v3/search',
  query: {
    part: 'snippet',
    type: 'video',
    q,
    key: apiKey,
    maxResults: 10,
  },
  responseType: 'json',
});

if (!response.ok) {
  throw new Error(`YouTube request failed: ${response.status}`);
}
```

### JSON POST

```ts
await host.net.request({
  method: 'POST',
  url: 'https://api.example.com/webhooks/event',
  headers: { Authorization: `Bearer ${token}` },
  body: {
    type: 'json',
    value: { event: 'started', at: Date.now() },
  },
  responseType: 'json',
});
```

### Form URL Encoded

```ts
await host.net.request<TokenResponse>({
  method: 'POST',
  url: 'https://api.example.com/oauth/token',
  body: {
    type: 'form',
    value: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  },
});
```

### Text Response

```ts
const response = await host.net.request<string>({
  url: 'https://example.com/status.txt',
  responseType: 'text',
});
```

### Bytes Response

```ts
const response = await host.net.request<string>({
  url: 'https://example.com/small-image.png',
  responseType: 'bytes',
  maxBytes: 2_000_000,
});

// response.data is base64 in v1.
const bytesBase64 = response.data;
```

Bytes are represented as base64 in v1 because it crosses the Tauri/JSON bridge predictably. If this becomes too costly, the SDK can add a binary invoke path later.

## Manifest Permissions

The generic request API needs an allowlist. A module should not be able to call arbitrary URLs just because it is installed.

Proposed manifest extension:

```json
{
  "permissions": {
    "network": [
      "https://www.googleapis.com/youtube/v3/*",
      "https://api.github.com/repos/example/*"
    ]
  }
}
```

The Rust side validates every request against the installed module's manifest before making the network call.

Initial matching rules:

- Only `https` by default.
- Exact host match unless the manifest explicitly uses a wildcard host.
- Wildcard hosts should be rare and reviewed carefully, for example `https://*.example.com/*`.
- Path wildcards are allowed only at segment boundaries or as a trailing `*`.
- Query strings are not part of the permission pattern.
- Redirect targets must be revalidated against the same rules.
- Deny localhost, loopback, private IP ranges, link-local IPs, and custom/file schemes by default.
- Resolve DNS before request and reject private network targets even when the URL uses a public-looking hostname.

Future permission UI can show a clear install prompt:

```txt
This module can connect to:
- www.googleapis.com
- api.github.com
```

## Runtime Safeguards

The host should enforce conservative defaults:

- Default timeout: 15 seconds.
- Maximum timeout: 60 seconds.
- Default response size limit: 10 MB.
- Hard maximum response size: 50 MB unless a future permission grants more.
- Maximum redirect count: 5.
- Deny request bodies on `GET` and `HEAD`.
- Deny unsafe request headers controlled by the host/runtime.
- Strip hop-by-hop response headers.
- Normalize errors into typed module-facing errors.
- Log requests by module id without logging secrets or full sensitive query strings.

Headers modules should not set:

- `Host`
- `Content-Length`
- `Connection`
- `Transfer-Encoding`
- `Upgrade`
- `Proxy-*`
- `Sec-*`

The host may reserve or rewrite `User-Agent`.

## Error Model

`request()` should reject only when the request could not be completed or violated host policy. HTTP statuses such as 400, 401, 403, 404, and 500 should resolve as `NetResponse` with `ok: false`.

Proposed error shape:

```ts
export type NetErrorCode =
  | 'permission_denied'
  | 'invalid_url'
  | 'blocked_url'
  | 'timeout'
  | 'network_error'
  | 'response_too_large'
  | 'invalid_response'
  | 'unsupported_body'
  | 'unsupported_response_type';

export interface NetError extends Error {
  code: NetErrorCode;
  status?: number;
  url?: string;
}
```

This keeps provider errors visible to modules while keeping host policy failures explicit.

## Rust Implementation Sketch

Add a Tauri command such as:

```rust
#[tauri::command]
async fn module_net_request(
    module_id: String,
    input: ModuleNetRequest,
    runtime: tauri::State<'_, ModuleRuntime>,
) -> Result<ModuleNetResponse, ModuleNetError> {
    runtime.assert_network_allowed(&module_id, &input.url)?;
    runtime.net_client().request(module_id, input).await
}
```

Implementation pieces:

- `ModuleNetRequest`, `ModuleNetRequestBody`, and `ModuleNetResponse` serde structs.
- URL parser and permission matcher.
- DNS/private-network guard.
- Shared `reqwest::Client`.
- Redirect policy that validates each hop.
- Body encoder for JSON, text, bytes, form, and multipart.
- Response parser for JSON, text, bytes, and none.
- Size-limited response body read.
- Error mapping that does not leak native internals unnecessarily.

## Non-Goals For V1

These should not be forced into generic `host.net.request()` initially:

- Long-running downloads to disk.
- Streaming request or response bodies.
- WebSockets or SSE.
- OAuth browser flows.
- Secret storage.
- Cookie jar/session persistence.
- Automatic provider-specific pagination or retry logic.

Future services can cover these separately:

```ts
host.downloads.downloadFile(...)
host.secrets.get(...)
host.auth.oauth(...)
host.net.stream?(...)
```

## Credential Handling

This API does not solve secrets by itself.

For the first YouTube module version, the user can provide their own Google API key inside the module's settings UI. The module stores that preference using `host.data.json`.

Longer term, Lumen should consider:

```ts
host.secrets.get(key)
host.secrets.set(key, value)
host.secrets.delete(key)
```

That would let modules store API keys in OS-backed secure storage instead of plain module data. `host.net.request()` should be compatible with either approach: the module can pass the key in query params/headers today, and a future host service can inject secrets later.

## YouTube Module Usage

The YouTube module would declare:

```json
{
  "permissions": {
    "network": [
      "https://www.googleapis.com/youtube/v3/*"
    ]
  }
}
```

Search request:

```ts
const search = await host.net.request<YoutubeSearchResponse>({
  url: 'https://www.googleapis.com/youtube/v3/search',
  query: {
    part: 'snippet',
    type: 'video',
    q,
    key: apiKey,
    maxResults: 10,
    safeSearch: 'moderate',
    regionCode: 'BR',
  },
  responseType: 'json',
});
```

Details request:

```ts
const details = await host.net.request<YoutubeVideosResponse>({
  url: 'https://www.googleapis.com/youtube/v3/videos',
  query: {
    part: 'snippet,contentDetails,status,statistics',
    id: videoIds.join(','),
    key: apiKey,
  },
  responseType: 'json',
});
```

The module still owns YouTube-specific normalization. Lumen only owns the generic transport.

## Open Questions

- Should `get()` and `post()` exist in v1, or should the public API force every module through `request()` first?
- Should network permissions be enforced immediately for all modules, or only once third-party install is public?
- Should dev/sideloaded modules get a temporary "allow all network" escape hatch with a clear warning?
- Should response caching be generic in `host.net`, or left to each module through `host.data`?
- Should Lumen expose `host.secrets` before the YouTube module ships, or is `host.data.json` acceptable for the first iteration?
- Should v1 include multipart uploads, or postpone them until a concrete module needs them?

## Implementation Checklist

- [ ] Promote `NetAPI` into `@lumen-media/module-sdk`.
- [ ] Add `permissions.network` to the module manifest schema.
- [ ] Implement Rust `module_net_request` command.
- [ ] Replace renderer `fetch()` implementation with Tauri invoke.
- [ ] Implement structured body encoders for JSON, text, bytes, form, and optionally multipart.
- [ ] Implement response parsers for JSON, text, bytes, and none.
- [ ] Decide whether to ship `get()` and `post()` wrappers or only `request()` in the first public SDK shape.
- [ ] Add URL permission matcher tests.
- [ ] Add blocked localhost/private-network tests.
- [ ] Add response-size and timeout tests.
- [ ] Document module author examples in `module-api-reference.md`.
- [ ] Update the YouTube module manifest to request Google API access.

