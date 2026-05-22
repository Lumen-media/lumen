# Thumbnail Cache — Architecture Design

## Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                           LUMEN (Desktop)                             │
│                                                                        │
│  Frontend (React)                    Rust Backend                     │
│  ┌──────────────────┐                ┌────────────────────────────┐   │
│  │  ThumbnailService│◄── blob URL ───│  get_thumbnail command     │   │
│  │  (in-memory map) │                │                            │   │
│  └──────────────────┘                │  1. check own cache        │   │
│         │                            │     → hit: return path     │   │
│         ▼                            │                            │   │
│  <img src={blobUrl} />               │  2. try OS thumbnail       │   │
│                                      │     Win: Shell API (STA)   │   │
│  ┌──────────────────┐                │     Linux: Freedesktop     │   │
│  │  Video / Image   │─── path ──────►│     macOS: skip            │   │
│  │  file            │                │     → hit: save + return   │   │
│  └──────────────────┘                │                            │   │
│                                      │  3. generate (fallback)    │   │
│                                      │     image → image_thumb    │   │
│                                      │     video → video_thumb    │   │
│                                      │     → save + return        │   │
│                                      └────────────────────────────┘   │
│                                                                        │
│  Cache dir: {app_data}/lumen/cache/thumbs/{blake3}_{size}.jpg         │
└──────────────────────────────────────────────────────────────────────┘
```

**Images (PNG, JPEG, WEBP, etc.):** decoded and resized with the `image` crate — pure Rust, no external dependency.

**Videos (MP4/MOV with H.264):** OS thumbnail attempted first; fallback uses `symphonia` for MP4 demuxing and `openh264` for H.264 decoding.

---

## Rust Modules

```
src-tauri/src/
├── thumbnail/
│   ├── mod.rs          — public command, cache key logic, dispatcher
│   ├── os_thumb.rs     — OS-native thumbnail retrieval (per-platform)
│   ├── image_thumb.rs  — image resizing via `image` crate
│   └── video_thumb.rs  — H.264 frame extraction via symphonia + openh264
```

---

## Cache Key

The cache filename is derived from the absolute file path using BLAKE3, with the requested size embedded so multiple resolutions coexist:

```rust
let key = blake3::hash(path.as_bytes()).to_hex();
let dest = cache_dir.join(format!("{key}_{size}.jpg"));
```

This ensures:
- One cache entry per unique `(path, size)` combination
- No collisions between files with the same name in different directories
- Cache is persistent across app restarts

Cache directory is resolved at runtime via `app.path().app_data_dir()`:

```
{app_data_dir}/lumen/cache/thumbs/
```

On Windows this expands to:

```
C:\Users\<user>\AppData\Roaming\com.lumen.media\lumen\cache\thumbs\
```

---

## Tauri Command

```rust
#[tauri::command]
pub async fn get_thumbnail(
    app: AppHandle,
    path: String,
    size: Option<u32>,
) -> Result<String, String>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `path` | `String` | Absolute path to the source file (image or video) |
| `size` | `Option<u32>` | Max edge length in pixels. Defaults to `200` |

**Returns:** Absolute path to the cached thumbnail JPEG on success, or an error string.

**Flow:**

1. Resolve cache directory from `app.path().app_data_dir()`
2. Compute cache key: `blake3(path)_{size}.jpg`
3. If file exists in cache → return its path immediately
4. Try OS thumbnail via `spawn_blocking` → `os_thumb::try_get`
5. If OS returned a result → save to cache, return path
6. Detect file type by extension and generate:
   - Image (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`) → `image_thumb::generate`
   - Video (`.mp4`, `.mov`, `.m4v`) → `video_thumb::generate`
   - Other → return error `"unsupported file type"`
7. Save thumbnail JPEG to cache dir, return path

---

## OS Thumbnail (os_thumb.rs)

Attempted before any Rust-side generation. Implemented per-platform via `#[cfg]` blocks.

### Windows — `IShellItemImageFactory`

Uses the Windows Shell COM API, the same pipeline Explorer uses. Handles any format supported by Windows Media Foundation (MP4, MKV, AVI, HEIC, etc.).

```
CoInitializeEx(COINIT_APARTMENTTHREADED)   — Shell COM requires STA
  → SHCreateItemFromParsingName            — get IShellItemImageFactory
    → GetImage(SIZE, SIIGBF_BIGGERSIZEOK)  — returns HBITMAP (cached or generated)
      → CreateCompatibleDC + GetDIBits     — extract BGRA pixels
        → BGRA → RGBA conversion
          → image::RgbaImage → save JPEG
```

`SIIGBF_BIGGERSIZEOK (0x01)` allows the Shell to return a larger cached size if the exact requested size is not available, and generates the thumbnail if not yet cached.

### Linux — Freedesktop Thumbnail Spec

Reads existing thumbnails from `~/.cache/thumbnails/` without generating new ones. Filename is `md5(file:// URI).png`.

```rust
let subdir = if size <= 128 { "normal" } else { "large" };
let thumb = ~/.cache/thumbnails/{subdir}/{md5(uri)}.png;
```

If the file does not exist in the Freedesktop cache, returns `None` and falls through to Rust-side generation.

### macOS

Not implemented — the QuickLook cache uses a proprietary binary format. Always returns `None`, falling through to Rust-side generation.

---

## Image Thumbnail Generation (image_thumb.rs)

Uses the `image` crate. No external binary required.

```rust
pub fn generate(src: &Path, dest: &Path, size: u32) -> Result<(), String> {
    let img = image::open(src)?;
    let thumb = img.thumbnail(size, size);
    thumb.save_with_format(dest, ImageFormat::Jpeg)?;
    Ok(())
}
```

`thumbnail(size, size)` preserves aspect ratio and fits within a `size × size` bounding box.

---

## Video Thumbnail Generation (video_thumb.rs)

Fallback used when the OS thumbnail is unavailable. Supports H.264 in MP4/MOV containers only.

**Strategy:** extract SPS/PPS from `avcC` codec params, feed to openh264 decoder, read packets until the first decoded YUV frame, resize and save as JPEG.

```
MP4 file
  └─► symphonia FormatReader     — parse container
        └─► video track          — identified by sample_rate.is_none()
              └─► extra_data     — parse avcC box → SPS/PPS Annex B
                    └─► decoder.decode(sps_pps)
                          └─► H.264 packets (AVCC)
                                └─► avcc_to_annexb()
                                      └─► openh264 Decoder::decode()
                                            └─► YUVSource → write_rgb8
                                                  └─► image resize + JPEG
```

**Track identification:** audio tracks carry `sample_rate`; video tracks do not. The first track with `codec != CODEC_TYPE_NULL && sample_rate.is_none()` is used.

**AVCC → Annex B conversion:** SPS/PPS are stored in `extra_data` (avcC box), not in-stream. They are extracted via `parse_avcc_extra()` and fed to the decoder before packet decoding begins. Each packet's length-prefixed NALUs are converted to start-code-prefixed NALUs.

**Codec support:** H.264 only. The packet loop aborts after 300 packets without a decoded frame.

---

## Crates

| Crate | Scope | Version | Purpose |
|-------|-------|---------|---------|
| `image` | all | `0.25` | Image decode, resize, JPEG encode |
| `symphonia` | all | `0.5` | Pure-Rust MP4/MOV demuxer |
| `blake3` | all | `1` | Cache key hashing |
| `windows` | Windows only | `0.58` | Shell COM API for OS thumbnails |
| `md5` | Linux only | `0.7` | Freedesktop cache key hashing |

`openh264 = "0.9"` is already a project dependency (used by the streaming encoder).

**Cargo.toml:**

```toml
[dependencies]
image = { version = "0.25", default-features = false, features = ["jpeg", "png", "webp", "bmp", "gif", "rayon"] }
symphonia = { version = "0.5", default-features = false, features = ["mp3", "aac", "isomp4", "opt-simd"] }
blake3 = "1"

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_Graphics_Gdi",
    "Win32_System_Com",
    "Win32_UI_Shell",
] }

[target.'cfg(target_os = "linux")'.dependencies]
md5 = "0.7"
```

---

## Frontend Service

`src/services/thumbnail-service.ts` wraps the Tauri command and maintains an in-memory blob URL cache keyed by `filePath:size`.

```ts
class ThumbnailService {
  private cache = new Map<string, string>();

  async getThumbnail(filePath: string, size = 200): Promise<string> {
    const key = `${filePath}:${size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const cachePath = await invoke<string>('get_thumbnail', { path: filePath, size });
    const bytes = await readFile(cachePath);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));

    this.cache.set(key, blobUrl);
    return blobUrl;
  }
}

export const thumbnailService = new ThumbnailService();
```

The service follows the project's standard blob URL pattern — `readFile` + `URL.createObjectURL` — consistent with how all local media files are displayed.

---

## Consumers

| Component | Size | Purpose |
|-----------|------|---------|
| `lyric-background-modal.tsx` — `MediaThumbnail` | `200` | Media library grid (images + videos) |
| `lyric-modal.tsx` — `SlidePreview` | `800` | Slide background preview |
| `app/_layout/edit.tsx` — `SequenceThumbnail` | `200` | Horizontal slide strip |
| `components/ui/videoplayer.tsx` | `200` | Metadata thumbnail sent over WebSocket |
| `components/file-list-item.tsx` — `FileThumbnail` | `200` | Media panel file list (video + image types only) |

For `file-list-item.tsx`, thumbnail is only attempted for `video` and `image` media types. All other types (`lyrics`, `audio`, `text`, `files`) continue to display their Lucide icon.

---

## Cache Invalidation

There is no automatic invalidation. The cache is content-addressed by file path and size, not by file modification time. If a source file is replaced at the same path, the stale thumbnail persists until the cache directory is cleared.

For the current use case (media library files that do not change in place) this is acceptable.

---

## Error Handling

All errors are surfaced to the frontend as `Err(String)` from the Tauri command. The frontend should always handle the error case and fall back to a placeholder icon.

| Scenario | Behavior |
|----------|----------|
| File not found | `Err("file not found: {path}")` |
| Unsupported extension | `Err("unsupported file type")` |
| OS thumbnail unavailable | Falls through to Rust generation silently |
| Image decode failure | `Err("image decode: {detail}")` |
| Video track not found | `Err("no video track found")` |
| No decodable frame in 300 packets | `Err("no decodable video frame found after 300 packets")` |
| Cache write failure | `Err("save thumbnail: {detail}")` |
