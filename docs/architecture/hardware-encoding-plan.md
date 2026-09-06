# Hardware Encoding & Decoding — Feature Plan

## Overview

Lumen currently encodes and decodes video **entirely on the CPU** (OpenH264) for the paths that run in Rust. This feature adds **GPU-accelerated H.264 encoding** (and, in a later phase, GPU-accelerated decoding) by delegating the codec work to **ffmpeg**, consumed as an **external post-install dependency** — downloaded and managed by the app's existing tool download system, exactly like yt-dlp and Node.

The feature is driven by the existing `hardware_encoding` config toggle, which today is a dead field (stored but never read).

## Current Pipeline

| Path | Where it runs | Encoder/Decoder | Notes |
|---|---|---|---|
| `app_preview` stream | Rust (`app_preview_producer.rs`) | OpenH264 (CPU) | 640×360 @ 2fps. Only wired desktop encode. |
| `preview` / `main` streams | Rust | — | **Not implemented** — `subscribe_stream` returns `capture_not_ready`. |
| Mobile device preview | Rust | RTP passthrough | Devices encode their own H.264; app only relays packets. |
| Video thumbnails | Rust (`video_thumb.rs`) | OpenH264 (CPU) decode | One-shot per file, cached. |
| Live/Preview playback | WebView2 (browser) | Chromium HW decode | Already GPU-accelerated by default. |

## ffmpeg as External Dependency

The app **already treats ffmpeg as a post-install external tool**:

- Downloaded from **BtbN/FFmpeg-Builds** (full GPL build, includes `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf`) into `{app_data_dir}/tools/ffmpeg.exe`.
- Managed by `src-tauri/src/download/dependencies.rs` (`download_dependencies`, `check_dependencies`, `list_dependencies`).
- Reported to the UI through `check_dependencies` (`ffmpeg_installed`, `ffmpeg_version`, `tools_dir`) in the **Downloads** settings section.

**Consequence: no new download infrastructure is required.** The encoder resolves the binary from the existing `DownloadState.tools_dir` and spawns it. If `ffmpeg.exe` is absent, the feature degrades gracefully to the CPU encoder.

## Encoder Architecture

```
desktop_producer ─capture + resize▶ RGB ─▶ H264Encoder trait ─▶ Annex-B ─▶ TrackLocalStaticSample ─▶ RTP
                                          ├─ CPU:  OpenH264        (always available, fallback)
                                          └─ HW:   ffmpeg process  (external dependency)
```

- `trait H264Encoder { fn encode_frame(&mut self, rgb: &[u8]) -> Result<Vec<u8>, String> }` — consumes an RGB frame, returns an Annex-B H.264 access unit.
- `create_encoder(hardware: bool, tools_dir: &Path) -> Result<Box<dyn H264Encoder>, String>` — factory with fallback.
- The existing `app_preview_producer` migrates onto the trait; the new `desktop_producer` uses it for `preview`/`main`.

### ffmpeg HW Encoder

- **Process model:** one long-lived `tokio::process::Command` per producer, mirroring the pattern in `download/downloader.rs` (piped stdout/stderr).
  - stdin: raw frames (`rawvideo`, `rgb24`)
  - stdout: H.264 **Annex-B** (`-f h264`)
  - stderr: parsed for `streaming_debug_log` events (encoder confirm, warnings)
- **Encoder probe** (once, cached): run `ffmpeg -hide_banner -encoders`, select the first available in priority order:
  1. `h264_nvenc` (NVIDIA)
  2. `h264_qsv` (Intel)
  3. `h264_amf` (AMD)
  4. `h264_mf` (Media Foundation — any GPU)
  5. `libx264` (CPU, last resort so the HW path still "works")
- **WebRTC-compatible args** (forced for all variants):
  - `-bf 0` (no B-frames)
  - `-profile:v baseline` (constrained baseline — safest for webrtc-rs/browser)
  - `-g <fps*2>` short GOP; `-pix_fmt yuv420p`
  - low-latency presets where available (`-preset p4`/`-tune zerolatency` per encoder)
- **Frame delimiting:** stdout is a continuous Annex-B stream; NAL start codes are split into access units (one per `Sample`), using the parser pattern already present in `video_thumb.rs` (`avcc_to_annexb`).
- **Lifecycle:** process killed on drop/teardown; backpressure on stdin write; missed frames skipped (`MissedTickBehavior::Skip`).

### Desktop Producer

New pipeline for `preview`/`main`, reusing the `app_preview_producer` capture pattern (`screenshots` crate + nearest-neighbor resize):

- `main_fps` (1/15/24/30/60) and `main_resolution` (720p/1080p/1440p/4K) drive capture rate and target size.
- On-demand: runs only while `main_peers` / `preview_peers` are non-empty.
- Removes the `capture_not_ready` error path.

## Toggle & Fallback Behavior

| `hardware_encoding` | ffmpeg present | Result |
|---|---|---|
| `false` | — | OpenH264 (CPU) |
| `true` | yes, HW encoder found | ffmpeg HW encoder (`nvenc`/`qsv`/`amf`/`mf`) |
| `true` | yes, only CPU (`libx264`) | ffmpeg software encoder |
| `true` | **no** | OpenH264 fallback + UI warning |

The toggle never "lies" silently: every CPU fallback is surfaced through:

- `streaming_debug_log` event (`{ event: "encoder_fallback", payload: { reason, encoder: "openh264" } }`)
- a UI warning in the Live screen ("Hardware encoding unavailable — ffmpeg not installed. Install it in Settings → Downloads.").

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `hardware_encoding` | bool | false | Selects HW encoder; CPU fallback + warning if unavailable |
| `ffmpeg_installed` | bool | — | From `check_dependencies` (existing) |
| `active_encoder` | string | — | New field in `streaming_debug_log`: `nvenc`/`qsv`/`amf`/`mf`/`libx264`/`openh264` |

Persisted at: `{app_base_path}/config/streaming.json`

## UI Changes

### `advanced-section.tsx`

- **Hardware acceleration** → `hardware_encoding` (already connected — becomes functional)
- Show active encoder under the toggle when enabled

### `live.tsx`

- Warning banner when `hardware_encoding = true` but ffmpeg/HW unavailable

### `downloads-section.tsx`

- Unchanged — existing ffmpeg install flow already present

## Phased Roadmap

### Phase 1 — Encoder Abstraction
> No behavior change. Prepares the seam.

- [ ] `encoders/mod.rs`: `H264Encoder` trait + `create_encoder`
- [ ] `encoders/software.rs`: OpenH264 impl (migrate `app_preview_producer` onto it)

### Phase 2 — Desktop Producer
> Destroys `capture_not_ready`; still CPU-encoded (OpenH264) at this point.

- [ ] `desktop_producer.rs` honoring `main_fps`/`main_resolution`
- [ ] On-demand start/stop tied to `preview_peers`/`main_peers`
- [ ] Remove `capture_not_ready` error in `subscribe_stream`

### Phase 3 — ffmpeg HW Encoder
> The core of this plan.

- [ ] `ffmpeg_hw.rs`: spawn, probe, WebRTC-compat args, Annex-B framing
- [ ] `hardware_encoding` toggle selects impl; fallback to OpenH264
- [ ] `streaming_debug_log` reporting active encoder + fallback reasons
- [ ] Live-screen warning when HW unavailable

### Phase 4 — HW Decoding (Thumbnails)
> Lower ROI (cached, one-shot), done last.

- [ ] ffmpeg `-hwaccel d3d11va` frame extraction in `video_thumb.rs`, fallback OpenH264

### Phase 5 — Validation
> Bitstream compatibility and performance measurement.

- [ ] Bitstream compat: baseline profile, no B-frames → plays in webrtc-rs + browser
- [ ] Latency measurement (spawn → first frame)
- [ ] CPU/GPU comparison with toggle on/off
- [ ] Fallback path: uninstall ffmpeg → toggle on → OpenH264 + warning

## End-to-End Verification

1. **Download:** fresh install → Settings → Downloads → install dependencies → `tools/ffmpeg.exe` exists
2. **HW encode:** toggle ON → subscribe `main` → `streaming_debug_log` shows `nvenc`/`qsv`/`amf`/`mf`
3. **Toggle OFF:** `streaming_debug_log` shows `openh264`
4. **Fallback:** remove `ffmpeg.exe` → toggle ON → still streams via OpenH264 + UI warning shown
5. **Pipeline:** subscribe `preview`/`main` no longer errors `capture_not_ready`
6. **Resolution/FPS:** change `main_resolution`/`main_fps` → capture size and rate follow
7. **Compat:** H.264 stream renders in the Live preview and on a mobile device
8. **Persistence:** toggle survives restart

## Risks

- **ffmpeg absent / HW encoder unavailable** → covered by mandatory CPU fallback + warning
- **Bitstream incompatibility** with webrtc-rs/browser (profile/B-frames) → forced baseline + `-bf 0`; validated in Phase 5
- **Process lifecycle leaks** (spawn but never killed) → kill-on-drop + on-demand start/stop
- **Backpressure** (producer outpaces pipe) → `MissedTickBehavior::Skip` + blocked stdin write handling
- **Windows Defender / SmartScreen** flagging the downloaded ffmpeg.exe → same posture as the existing yt-dlp download (user-initiated, from a well-known source)