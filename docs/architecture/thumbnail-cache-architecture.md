# Thumbnail Cache — Architecture Design

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         LUMEN (Desktop)                          │
│                                                                   │
│  Frontend (React)                  Rust Backend                  │
│  ┌─────────────────┐               ┌──────────────────────────┐  │
│  │  <img src=path> │◄── path ──────│  get_thumbnail command   │  │
│  │  (thumbnail)    │               │                          │  │
│  └─────────────────┘               │  1. hash(file_path)      │  │
│                                    │  2. check cache dir      │  │
│  ┌─────────────────┐               │  3a. hit  → return path  │  │
│  │  Video / Image  │─── path ─────►│  3b. miss → generate     │  │
│  │  file           │               │       → save to cache    │  │
│  └─────────────────┘               │       → return path      │  │
│                                    └──────────────────────────┘  │
│                                                                   │
│  Cache dir: {app_data}/lumen/cache/thumbs/<hash>.jpg             │
└─────────────────────────────────────────────────────────────────┘
```

**Images (PNG, JPEG, WEBP, etc.):** decoded and resized with the `image` crate — pure Rust, no external dependency.

**Videos (MP4/MOV with H.264):** demuxed with `symphonia`, decoded with `openh264` (already a project dependency) — extracts the first keyframe and produces a JPEG thumbnail.

---

## Rust Modules

```
src-tauri/src/
├── thumbnail/
│   ├── mod.rs        — public command, cache key logic, dispatcher
│   ├── image.rs      — image resizing via `image` crate
│   └── video.rs      — H.264 frame extraction via symphonia + openh264
```

---

## Cache Key

The cache filename is derived from the absolute file path using BLAKE3:

```rust
fn cache_key(path: &Path) -> String {
    let hash = blake3::hash(path.to_string_lossy().as_bytes());
    format!("{}.jpg", hash.to_hex())
}
```

This ensures:
- One cache entry per unique source file path
- No collisions between files with the same name in different directories
- Cache is persistent across app restarts

Cache directory is resolved at runtime via `app.path().app_data_dir()`:

```
{app_data_dir}/lumen/cache/thumbs/
```

---

## Tauri Command

```rust
#[tauri::command]
pub async fn get_thumbnail(
    app: AppHandle,
    path: String,
) -> Result<String, String>
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `path` | `String` | Absolute path to the source file (image or video) |

**Returns:** Absolute path to the cached thumbnail JPEG on success, or an error string.

**Flow:**

1. Resolve cache directory from `app.path().app_data_dir()`
2. Compute cache key from `path`
3. If `{cache_dir}/{key}.jpg` exists → return its path immediately
4. Detect file type by extension:
   - Image (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`) → `image::generate`
   - Video (`.mp4`, `.mov`, `.m4v`) → `video::generate`
   - Other → return error `"unsupported file type"`
5. Save thumbnail JPEG to cache dir
6. Return the cache path

---

## Image Thumbnail Generation

Uses the `image` crate. No external binary required.

```rust
pub fn generate(src: &Path, dest: &Path, size: u32) -> Result<()> {
    let img = image::open(src)?;
    let thumb = img.thumbnail(size, size);
    thumb.save_with_format(dest, ImageFormat::Jpeg)?;
    Ok(())
}
```

`thumbnail(size, size)` preserves aspect ratio and fits within a `size × size` bounding box.

Default thumbnail size: **200 px** on the longest edge.

---

## Video Thumbnail Generation

Uses `symphonia` for MP4 demuxing and `openh264` for H.264 decoding (already present as a project dependency for the streaming encoder).

**Strategy:** seek to the first H.264 keyframe (IDR), decode it, resize with `image` crate, save as JPEG.

```
MP4 file
  └─► symphonia FormatReader   — parse container, locate video track
        └─► H.264 packet (IDR) — first keyframe packet
              └─► openh264 SvcDecoder::decode_no_delay
                    └─► YUV420p frame
                          └─► image crate RGBA conversion + resize
                                └─► JPEG saved to cache
```

**Codec support:** H.264 only. Files using VP9, AV1, or HEVC will return an error. H.264 (AVC) covers the vast majority of MP4/MOV files produced by cameras, phones, and screen recorders.

---

## Crates to Add

| Crate | Version | Purpose |
|-------|---------|---------|
| `image` | `0.25` | Image decoding, resizing, JPEG encoding |
| `symphonia` | `0.5` | Pure-Rust MP4/MOV demuxer |
| `blake3` | `1` | Fast cache key hashing |

`openh264` is already a dependency — no addition needed.

`symphonia` feature flags required:

```toml
[dependencies]
symphonia = { version = "0.5", features = ["mp4", "aac", "h264"] }
```

---

## Frontend Usage

```ts
import { invoke } from "@tauri-apps/api/core";

async function getThumbnail(filePath: string): Promise<string> {
  return await invoke<string>("get_thumbnail", { path: filePath });
}
```

Use the returned path directly as an `<img>` `src` via Tauri's asset protocol:

```tsx
const [thumb, setThumb] = useState<string | null>(null);

useEffect(() => {
  getThumbnail(file.path)
    .then(setThumb)
    .catch(() => setThumb(null));
}, [file.path]);

return thumb ? <img src={convertFileSrc(thumb)} /> : <PlaceholderIcon />;
```

`convertFileSrc` from `@tauri-apps/api/core` converts the native path to a safe Tauri asset URL.

---

## Cache Invalidation

There is no automatic invalidation. The cache is content-addressed by file path, not by file modification time. If a source file is replaced at the same path, the stale thumbnail persists until the cache directory is cleared.

For the current use case (media library files that don't change in place) this is acceptable. If invalidation becomes necessary, the cache key can be extended to include the file's last-modified timestamp:

```rust
fn cache_key(path: &Path, modified: SystemTime) -> String {
    let input = format!("{}:{:?}", path.to_string_lossy(), modified);
    let hash = blake3::hash(input.as_bytes());
    format!("{}.jpg", hash.to_hex())
}
```

---

## Error Handling

All errors are surfaced to the frontend as `Err(String)` from the Tauri command. The frontend should always handle the error case and fall back to a placeholder.

| Scenario | Error message |
|----------|--------------|
| File not found | `"file not found: {path}"` |
| Unsupported extension | `"unsupported file type"` |
| Image decode failure | `"image decode error: {detail}"` |
| Video has no H.264 track | `"no H.264 video track found"` |
| No keyframe in stream | `"no keyframe found in video"` |
| Cache write failure | `"cache write error: {detail}"` |
