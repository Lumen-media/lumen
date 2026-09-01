# Image Optimization Protocol (`lumen://` / `lumen-thumb://`)

## Overview

Lumen centralizes image loading, optimization and caching in a single Rust
URI scheme handler. Instead of each consumer reading a raw file, decoding and
resizing it itself, every image load in the app flows through one of two custom
schemes registered with the WebView:

| Scheme | Purpose |
|--------|---------|
| `lumen://` | Full / optimized image (re-encoded JPEG) |
| `lumen-thumb://` | Downscaled thumbnail (explicit `w`/`h`) |

The WebView resolves these URLs to the Rust handler, which:

1. Decodes the source (local file or remote URL),
2. Resizes / re-encodes to JPEG,
3. Caches the result on disk,
4. Serves cached entries on subsequent requests with size tolerance,
5. Special-cases Unsplash URLs to use imgix directly (no local re-encode).

A single `<img src>` change can replace the old blob-URL pipeline for any
consumer, and modules receive the optimized URLs from the SDK without needing
their own changes.

```
Frontend (React)                     Rust handler (protocol.rs)
┌───────────────┐                    ┌───────────────────────────────┐
│ <img src=     │                    │ handle_lumen_request          │
│  "lumen-thumb://│                   │  ┌ parse query (src,w,h)      │
│   ?src=...&w=.."│                   │  └ process(...)               │
│  │            │                    │     ├ full  → lumen://        │
│  │  WebView2   │                   │     ├ sized → lumen-thumb://   │
│  └──► scheme ──┼───────► handler ──┼──► src: local path | http URL  │
│               │                    │     ├ cache check (tolerance)  │
│               │                    │     ├ generate JPEG            │
│               │                    │     └ store to disk            │
└───────────────┘                    └───────────────────────────────┘
```

---

## URL Format

Both schemes accept the source as a percent-encoded query param. The `w`/`h`
params only apply to `lumen-thumb://`.

```
lumen://?src=<url-encoded source>
lumen-thumb://?src=<url-encoded source>&w=<width>&h=<height>
```

- `<source>` is an absolute local path (`C:\Users\...\wallpaper.jpg`) or an
  `http(s)` URL (e.g. an Unsplash photo URL).
- For the WebView to load these in `<img>` tags, the `http://` forms also work
  (WebView2 requires the http form for some contexts):

```
http://lumen.localhost/?src=...
http://lumen-thumb.localhost/?src=...&w=...&h=...
```

Both are registered in `src-tauri/src/main.rs`:

```rust
.register_uri_scheme_protocol("lumen", thumbnail::protocol::handle_lumen_request)
.register_uri_scheme_protocol("lumen-thumb", thumbnail::protocol::handle_lumen_request)
```

The handler detects which scheme was hit by checking the URI string for
`lumen-thumb`.

### Examples

```ts
// Full optimized local image
`lumen://?src=${encodeURIComponent('C:\\Users\\me\\Pictures\\bg.jpg')}`

// Thumbnail 200×200 of the same file
`lumen-thumb://?src=${encodeURIComponent('C:\\Users\\me\\Pictures\\bg.jpg')}&w=200&h=200`

// Full remote Unsplash image
`lumen://?src=${encodeURIComponent('https://images.unsplash.com/photo-xxx')}`
```

---

## Cache

Cache root is resolved at runtime from `app_data_dir()`:

```
{app_data_dir}/lumen/cache/
├── thumbs/           — local files, downscaled
├── remote-thumbs/    — remote URLs, downscaled (incl. Unsplash)
└── (remote full re-encodes share remote-thumbs/{hash}_full.jpg)
```

Filename scheme:

```
sized:  {blake3(src)}_{w}x{h}.jpg
full:   {blake3(src)}_full.jpg
```

- Hash is BLAKE3 over the raw source string (path or URL).
- Cache is persistent across app restarts.
- Windows example:
  `C:\Users\<user>\AppData\Roaming\com.lumen.media\lumen\cache\thumbs\`

### Size Tolerance

A cached entry can serve a request up to **50% larger** than requested without
regenerating. A `200x100` request accepts any cached entry with
`200 <= w <= 300` and `100 <= h <= 150`; the smallest-area matching entry wins.

```rust
const TOLERANCE: f64 = 1.5; // 50%
```

This avoids generating near-duplicate sizes while still returning an image at
least as large as requested.

### In-Memory Index

An in-memory `HashMap` (`INDEX`) caches the directory scan per
`{dir}::{hash}` so the handler does not re-read the cache folder on every
request. Entries are inserted lazily on first access and after each
generation.

---

## Behavior by Source Type

### Local file — full (`lumen://`)

| Extension | Behavior |
|-----------|----------|
| Image (`png`, `jpg`, `jpeg`, `webp`, `bmp`, `gif`) | Decode + re-encode JPEG quality 88, cached as `{hash}_full.jpg` |
| Video (`mp4`, `mov`, `m4v`, `webm`, `avi`, `mkv`) | Pass-through raw bytes, `Content-Type` from extension |
| Other | `415 Unsupported Media Type` |

### Local file — sized (`lumen-thumb://`)

| Extension | Behavior |
|-----------|----------|
| Image | Decode + `thumbnail(w, h)` + JPEG quality 82 |
| Video | First decodable frame via `video_thumb::generate_box` |
| Other | `415 Unsupported Media Type` |

### Remote URL — full (`lumen://`)

- **Unsplash:** uses the imgix params (`w`, `h`, `q`, `fit`, `fm`, `auto`) to
  fetch an exact-size image from Unsplash directly — **no local re-encode**.
  The result is cached (`{hash}_full.jpg`) so it works offline later.
- **Other:** fetch, try to decode as image → re-encode JPEG quality 88; if it
  is not an image (e.g. video), pass raw bytes through with a mime guessed
  from the URL.

### Remote URL — sized (`lumen-thumb://`)

- **Unsplash:** builds an imgix URL with the exact `w`/`h`, fetches and caches
  it under the normal `{hash}_{w}x{h}.jpg` key (usable offline).
- **Other:** fetch + decode + `thumbnail(w, h)` + JPEG quality 82.

---

## Unsplash Special Case

Unsplash image URLs are served by an imgix CDN that can resize on the fly via
query params. Instead of downloading the full image and re-encoding it locally,
the handler appends imgix params and lets Unsplash return the exact size:

```rust
unsplash_optimized(src, Some(w), Some(h))  // w, h, q=80, fit=crop, fm=jpg, auto=format
```

Existing params on the source URL (e.g. `ixid`, `ixlib`) are preserved. The
bytes returned by Unsplash are written straight to the cache (no decode/encode
round-trip), so once fetched they remain available offline.

---

## Mime Handling

Every `200` response includes:

```
Content-Type: <mime>                (image/jpeg for sized/re-encoded)
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=31536000, immutable
```

The `Cache-Control: immutable` reflects that cache keys are content-addressed
by source, so a URL always maps to the same bytes.

---

## Frontend Usage

The frontend never builds these URLs manually except through the SDK helper.
In the themes SDK (`src/modules/apis/domain.ts`) a small helper produces the
URLs when a background is a local file:

```ts
function optimizedBgUrl(src: string, opts: { w?: number; h?: number } = {}): string {
  const query = new URLSearchParams({ src });
  if (opts.w) query.set('w', String(opts.w));
  if (opts.h) query.set('h', String(opts.h));
  const scheme = opts.w || opts.h ? 'lumen-thumb' : 'lumen';
  return `${scheme}://opt?${query.toString()}`;
}
```

`defaultBackground()` returns `lumen://…` (full), and
`onDefaultBackgroundChange()` returns `lumen://…` for `src` plus
`lumen-thumb://…?w=200&h=200` for `thumb`. Modules (e.g. bible) that render
`bg.src` / `bg.thumb` in `<img>` tags automatically use the optimized pipeline
with zero module changes.

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Missing `src` param | `400 Bad Request` |
| Local file does not exist | `404 file not found` |
| Unsupported extension | `415 Unsupported Media Type` |
| Image decode failure | `400 image decode: …` |
| Upstream fetch failure | `502 fetch …` |
| Cache I/O failure | `500` |

The frontend should handle non-`200` responses (broken image) and fall back to
a placeholder.

---

## Relationship to the Legacy Thumbnail System

The previous system (`thumbnail-cache-architecture.md`) used a Tauri command
`get_thumbnail` plus `thumbnail-service.ts` which read a cached JPEG and
converted it to a blob URL for `<img>` tags. That pipeline still exists and is
used by consumers that have not migrated yet. The `lumen://` protocol is the
centralized replacement: no blob URLs, no per-consumer resizing, size
tolerance, remote + Unsplash support, all in Rust.

Migration target consumers (may still use the old service):

| Component | Thumb size | Status |
|-----------|-----------|--------|
| `lyric-background-modal.tsx` — `MediaThumbnail` | 200 | not migrated |
| `lyric-modal.tsx` — `SlidePreview` | 800 | not migrated |
| `app/_layout/edit.tsx` — `SequenceThumbnail` | 200 | not migrated |
| `components/file-list-item.tsx` — `FileThumbnail` | 200 | not migrated |
| `components/chat-panel.tsx`, `aside-panel.tsx`, `presenter-controls.tsx` | various | not migrated |
| bible module (`PreviewPane`, `SlidePreview`) | — | migrated via SDK (auto) |