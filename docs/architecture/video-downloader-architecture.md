# Video Downloader — Architecture Design

## Purpose

Allow Lumen to download YouTube videos for offline playback using `yt-dlp` as the download engine and `FFmpeg` for audio/video muxing. Both tools are fetched on-demand from their GitHub releases when the user first attempts a download, keeping the initial install lightweight.

---

## Scope

- **Supported sources:** YouTube URLs only (same URLs already handled by `url-media-service.ts`).
- **External tools:** `yt-dlp` (download engine) and `FFmpeg` (muxing). Both are standalone binaries downloaded from GitHub releases.
- **Download trigger:** user clicks a download button on a YouTube media item that has `downloadStatus === 'not_downloaded'`.
- **Dependency installation:** on-demand, with user confirmation and progress feedback.
- **Playback after download:** local file takes precedence over streaming URL.
- **Persistence:** downloaded file path and updated `downloadStatus` stored in SQLite.

---

## Current State

YouTube support currently streams only via ReactPlayer's native YouTube embed. The `DownloadStatus` type and `downloadStatus` DB column exist as scaffolding but never transition from `'not_downloaded'`. No download tools are bundled or referenced in the codebase.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                           │
│                                                             │
│  file-list-item.tsx                                         │
│  ├── Download button (visible when not_downloaded)          │
│  ├── Download progress bar                                  │
│  └── Status badge (not_downloaded / downloading / downloaded)│
│                                                             │
│  media-panel.tsx                                            │
│  └── Category "Video" renders FileListItem with download UI │
│                                                             │
│  aside-panel.tsx (queue)                                    │
│  └── Download status badge on queue items                   │
│                                                             │
│  GlobalAlert (alert-store.ts)                               │
│  └── Dependency installation prompt when FFmpeg missing      │
│                                                             │
│  Toast notifications (sonner)                               │
│  └── Download progress and status updates                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ invoke()
┌──────────────────────▼──────────────────────────────────────┐
│  Tauri Commands (Rust)                                      │
│                                                             │
│  download::check_dependencies()                             │
│  download::download_dependencies(callback)                  │
│  download::download_video(url, quality, callback)           │
│  download::get_download_status(file_id)                     │
│  download::cancel_download(download_id)                     │
│  download::list_dependencies()                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ Command::new()
┌──────────────────────▼──────────────────────────────────────┐
│  External Binaries                                          │
│                                                             │
│  yt-dlp  ──► {app_data_dir}/tools/yt-dlp[.exe]             │
│  FFmpeg  ──► {app_data_dir}/tools/ffmpeg[.exe]              │
│                                                             │
│  Downloaded from GitHub Releases (latest version)           │
│  Version cached in {app_data_dir}/tools/versions.json       │
└─────────────────────────────────────────────────────────────┘
```

---

## Rust Module Structure

```
src-tauri/src/
├── download/
│   ├── mod.rs              — Tauri commands, initialization
│   ├── dependencies.rs     — Check, download, and manage yt-dlp + FFmpeg binaries
│   ├── downloader.rs       — Execute yt-dlp, parse progress, handle cancellation
│   └── github.rs           — Fetch latest release info from GitHub API
└── main.rs                 — Register download commands, initialize download state
```

---

## Dependency Management

### Storage Location

All external tools live under `{app_data_dir}/tools/`:

```
{app_data_dir}/
└── tools/
    ├── yt-dlp.exe          (Windows)
    ├── ffmpeg.exe          (Windows)
    ├── ffprobe.exe         (Windows)
    ├── versions.json       — cached version info
    └── downloads/          — temporary download directory
```

On Linux/macOS, binaries are without `.exe` extension.

### versions.json

```json
{
  "ytdlp": {
    "version": "2025.11.12",
    "platform": "win_x64",
    "downloaded_at": 1710000000
  },
  "ffmpeg": {
    "version": "latest",
    "platform": "win_x64",
    "downloaded_at": 1710000000
  }
}
```

### GitHub API

**yt-dlp:**
```
GET https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest
Asset pattern: yt-dlp.exe (Windows), yt-dlp_linux (Linux), yt-dlp_macos (macOS)
```

**FFmpeg:**
```
GET https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest
Asset pattern: ffmpeg-master-latest-win64-gpl.zip (Windows),
               ffmpeg-master-latest-linux64-gpl.tar.xz (Linux)
               macOS: Not available from BtbN - must be installed manually (brew install ffmpeg)
```

### Rate Limiting

- GitHub API: 60 requests/hour per IP (unauthenticated).
- Cache `versions.json` for 24 hours. Only re-fetch if cache is stale or user forces update.
- First check uses `If-None-Match` / `If-Modified-Since` headers when available.

### Platform Detection

```rust
fn platform_key() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64")  => "win_x64",
        ("windows", "aarch64") => "win_arm64",
        ("linux", "x86_64")    => "linux_x64",
        ("linux", "aarch64")   => "linux_aarch64",
        ("macos", "aarch64")   => "macos_arm64",
        ("macos", "x86_64")    => "macos_x64",
        _ => "unknown",
    }
}
```

**Note:** FFmpeg auto-download is only supported on Windows and Linux. macOS users must install FFmpeg manually via Homebrew (`brew install ffmpeg`).

---

## Tauri Commands

### `check_dependencies`

```rust
#[tauri::command]
async fn check_dependencies(state: State<'_, DownloadState>) -> Result<DependencyStatus, String>
```

Returns which tools are installed and their versions:

```rust
pub struct DependencyStatus {
    pub ytdlp_installed: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_installed: bool,
    pub ffmpeg_version: Option<String>,
    pub tools_dir: String,
}
```

### `download_dependencies`

```rust
#[tauri::command]
async fn download_dependencies(
    state: State<'_, DownloadState>,
    app: AppHandle,
) -> Result<(), String>
```

Downloads both yt-dlp and FFmpeg. Progress is reported via toast notifications (`sonner`) on the frontend, listening to Tauri events:

| Event | Payload |
|---|---|
| `dependency-download-progress` | `{ tool: "ytdlp" \| "ffmpeg", progress: 0.0-1.0, bytes_downloaded: u64, total_bytes: u64 }` |
| `dependency-download-complete` | `{ tool: "ytdlp" \| "ffmpeg", version: String }` |
| `dependency-download-error` | `{ tool: "ytdlp" \| "ffmpeg", error: String }` |

Both tools must succeed. If one fails, the error is reported but the other tool's download is not rolled back.

### `download_video`

```rust
#[tauri::command]
async fn download_video(
    state: State<'_, DownloadState>,
    app: AppHandle,
    url: String,
    provider: String,
    quality: DownloadQuality,
) -> Result<DownloadResult, String>
```

```rust
pub enum DownloadQuality {
    Best,       // best available → video
    High,       // 1080p → video
    Medium,     // 720p → video
    Low,        // 480p → video
    AudioOnly,  // audio only (mp3/mp4) → audio
}

pub struct DownloadResult {
    pub download_id: String,
    pub file_path: String,
    pub file_size: u64,
    pub file_info: FileInfo,  // updated FileInfo with download_status = 'downloaded'
}
```

> When `AudioOnly` is selected, the downloaded file is saved to `files/media/audio/` and `media_type` is set to `'audio'`. All other qualities save to `files/media/video/` with `media_type = 'video'`.

Progress events:

| Event | Payload |
|---|---|
| `video-download-progress` | `{ download_id, progress: 0.0-1.0, speed: String, eta: String, status: String }` |
| `video-download-complete` | `{ download_id, file_path, file_size, file_info: FileInfo }` |
| `video-download-error` | `{ download_id, error: String }` |

### `cancel_download`

```rust
#[tauri::command]
async fn cancel_download(
    state: State<'_, DownloadState>,
    download_id: String,
) -> Result<(), String>
```

Kills the yt-dlp child process. Partial files are cleaned up.

### `get_download_status`

```rust
#[tauri::command]
async fn get_download_status(
    state: State<'_, DownloadState>,
    file_id: i64,
) -> Result<Option<ActiveDownload>, String>
```

Returns active download info if a download is in progress for the given file.

### `list_dependencies`

```rust
#[tauri::command]
async fn list_dependencies() -> Result<Vec<DependencyInfo>, String>
```

Returns metadata about each tool (name, version, platform, size, installed path).

---

## DownloadState

```rust
pub struct DownloadState {
    pub inner: Arc<Mutex<DownloadStateInner>>,
}

pub struct DownloadStateInner {
    pub tools_dir: PathBuf,
    pub active_downloads: HashMap<String, ActiveDownload>,
    pub versions: ToolVersions,
}

pub struct ActiveDownload {
    pub download_id: String,
    pub file_id: i64,
    pub url: String,
    pub process: Option<Child>,
    pub started_at: u64,
}

pub struct ToolVersions {
    pub ytdlp: Option<ToolInfo>,
    pub ffmpeg: Option<ToolInfo>,
}

pub struct ToolInfo {
    pub version: String,
    pub path: PathBuf,
    pub downloaded_at: u64,
}
```

---

## Download Flow

### 1. User Clicks Download Button

```
Frontend: invoke('download_video', { url, quality: 'Best' })
```

### 2. Dependency Check

```
Rust: check_dependencies()
  ├── yt-dlp exists? → use it
  │   └── No → GlobalAlert: "Download requires yt-dlp" → download_dependencies()
  ├── FFmpeg exists? → use it
  │   └── No (Windows/Linux) → GlobalAlert: "Download requires FFmpeg" → download_dependencies()
  │   └── No (macOS) → Error: "Install FFmpeg via: brew install ffmpeg"
  └── Both OK → proceed
```

### 3. Execute yt-dlp

```rust
let output_dir = tools_dir.join("downloads");
Command::new(ytdlp_path)
    .args([
        "--no-playlist",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", &format!("{}/%(title)s.%(ext)s", output_dir.display()),
        "--newline",           // progress per line
        "--progress",          // show progress
        &url,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()?
```

### 4. Parse Progress

yt-dlp outputs progress lines like:

```
[download]  45.2% of  120.50MiB at  5.23MiB/s ETA 00:12
```

Parse these lines and emit `video-download-progress` events to the frontend.

### 5. Completion

- Determine media type from download quality:
  - `AudioOnly` → `media_type = 'audio'`, save to `files/media/audio/`
  - All others → `media_type = 'video'`, save to `files/media/video/`
- Move the downloaded file from `downloads/` to the appropriate media directory.
- Update SQLite immediately:
  - Set `download_status = 'downloaded'`.
  - Update `path` to the local file path.
  - Update `media_type` to the determined type (`'audio'` or `'video'`).
  - Set `size` to the file size.
  - Update `modified_at` to current timestamp.
- Emit `video-download-complete`.
- Frontend receives the event and updates the UI in real time — the item moves to the correct category without refresh.
- Clean up temporary files.

### 6. Cancellation

- Kill the yt-dlp child process via `child.kill()`.
- Remove partial files from `downloads/`.
- Remove the download entry from `active_downloads`.

---

## SQLite Changes

No new columns needed. Existing columns are sufficient:

- `download_status`: update from `'not_downloaded'` to `'downloaded'` (or `'missing'` if file is deleted).
- `path`: for URL media, currently stores the YouTube URL. After download, update to local file path.

Consider adding a `local_path` column in a future migration if the URL must be preserved alongside the local path. For now, `original_url` already stores the YouTube URL.

---

## Frontend Integration

### file-list-item.tsx

Add a download button to the file list item when:

```tsx
{item.originalUrl && item.downloadStatus === 'not_downloaded' && (
  <DownloadButton onClick={() => startDownload(item)} />
)}
```

States:

| State | UI |
|---|---|
| `not_downloaded` | Download icon button |
| `downloading` | Progress bar + cancel button |
| `downloaded` | Checkmark badge, plays from local file |
| `missing` | Warning badge + download button |

### Dependency Installation Flow

First time the user clicks download and dependencies are missing:

1. Use `useAlertStore.show()` (GlobalAlert) to prompt the user:
   - **Title:** "Download requires FFmpeg"
   - **Description:** "To download videos, Lumen needs FFmpeg (~100 MB). It will be downloaded from GitHub. Install now?"
   - **Confirm button:** "Install"
   - **Cancel button:** "Cancel"
2. User confirms → `invoke('download_dependencies')`
3. Show progress via toast notifications (`sonner`) — listening to `dependency-download-progress` events
4. On complete → toast success, automatically start the video download
5. On error → toast error, allow retry by clicking download again

### Quality Selection

Before download, optionally show a quality picker:

| Quality | yt-dlp flag |
|---|---|
| Best | `-f bestvideo+bestaudio` |
| High (1080p) | `-f bestvideo[height<=1080]+bestaudio` |
| Medium (720p) | `-f bestvideo[height<=720]+bestaudio` |
| Low (480p) | `-f bestvideo[height<=480]+bestaudio` |
| Audio Only | `-f bestaudio --extract-audio --audio-format mp3` |

---

## Error Handling

| Error | Handling |
|---|---|
| No internet | "Check your connection and try again." |
| GitHub API rate limited | "Too many requests. Try again later." (use cached version if available) |
| yt-dlp download failed | "Failed to download video. The URL may be unavailable." |
| FFmpeg not found (Windows/Linux) | "FFmpeg is required for video processing. Install dependencies." |
| FFmpeg not found (macOS) | "FFmpeg is required. Install via: brew install ffmpeg" |
| Disk full | "Not enough disk space." |
| Invalid URL | "Unsupported URL. Only YouTube links are supported." |
| Process killed (cancel) | Silent cleanup, no error shown |
| yt-dlp outdated | Auto-update: re-download latest version |

---

## Security Considerations

- yt-dlp and FFmpeg binaries are downloaded from official GitHub releases only.
- SHA256 checksums are verified when available (yt-dlp provides `SHA256SUMS`).
- Downloaded binaries are stored in the app's data directory, not in a shared location.
- No arbitrary command execution — only specific, hardcoded arguments are passed to yt-dlp.
- URLs are validated before passing to yt-dlp (YouTube only).

---

## Module-Facing API

Modules can use `host.download` to download videos programmatically. The API exposes the full download pipeline — dependency management, video download with progress, and file management.

### `host.download` API

```ts
// Check if download dependencies are installed
const status = await host.download.checkDependencies();
// { ytdlp: { installed: true, version: string }, ffmpeg: { installed: true, version: string } }

// Install missing dependencies (shows GlobalAlert if called from UI context)
await host.download.installDependencies();

// Download a video
const result = await host.download.video({
  provider: 'youtube',
  url: 'https://www.youtube.com/watch?v=VIDEO_ID',
  quality: 'best',        // 'best' | 'high' | 'medium' | 'low' | 'audio_only'
  onProgress: (progress) => {
    // progress: { percent: number, speed: string, eta: string, status: string }
    console.log(`Download: ${progress.percent}%`);
  },
  onComplete: (result) => {
    // result: { filePath: string, fileSize: number, duration?: number }
    console.log(`Downloaded to: ${result.filePath}`);
  },
  onError: (error) => {
    // error: { message: string, code: string }
    console.error(`Download failed: ${error.message}`);
  },
});

// Cancel an active download
await host.download.cancel(result.downloadId);

// Get download status for a file
const status = await host.download.getStatus(fileId);
// { status: 'not_downloaded' | 'downloading' | 'downloaded' | 'missing', progress?: number }

// List supported providers
const providers = host.download.supportedProviders();
// ['youtube']
```

### `DownloadHostAPI`

| Method | Returns | Description |
|---|---|---|
| `checkDependencies()` | `Promise<DependencyStatus>` | Check if yt-dlp and FFmpeg are installed |
| `installDependencies()` | `Promise<void>` | Download and install missing dependencies |
| `video(options)` | `Promise<DownloadHandle>` | Download a video with progress callbacks |
| `cancel(downloadId)` | `Promise<void>` | Cancel an active download |
| `getStatus(fileId)` | `Promise<DownloadStatusInfo>` | Get download status for a media file |
| `supportedProviders()` | `DownloadProvider[]` | List supported download providers |

### `DownloadVideoOptions`

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | `DownloadProvider` | ✓ | Video source provider (e.g., `'youtube'`) |
| `url` | `string` | ✓ | Video URL from the specified provider |
| `quality` | `'best' \| 'high' \| 'medium' \| 'low' \| 'audio_only'` | | Default: `'best'` |
| `onProgress` | `(progress: DownloadProgress) => void` | | Progress callback |
| `onComplete` | `(result: DownloadResult) => void` | | Completion callback |
| `onError` | `(error: DownloadError) => void` | | Error callback |

### `DownloadProvider`

```ts
type DownloadProvider = 'youtube';
```

Currently supported providers:
| Provider | URL patterns | Notes |
|---|---|---|
| `youtube` | `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/` | Full support |

Future providers may include: `vimeo`, `dailymotion`, `twitch`, etc.

### `DownloadProgress`

| Field | Type | Description |
|---|---|---|
| `percent` | `number` | Download progress (0-100) |
| `speed` | `string` | Current download speed (e.g., "5.23 MiB/s") |
| `eta` | `string` | Estimated time remaining (e.g., "00:12") |
| `status` | `string` | Current status (e.g., "downloading", "merging") |

### `DownloadResult`

| Field | Type | Description |
|---|---|---|
| `downloadId` | `string` | Unique download identifier |
| `filePath` | `string` | Path to the downloaded file |
| `fileSize` | `number` | File size in bytes |
| `duration` | `number` (optional) | Video duration in seconds |

### `DownloadError`

| Field | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error message |
| `code` | `string` | Error code for programmatic handling |

Error codes:
- `dependency_missing` — yt-dlp or FFmpeg not installed
- `dependency_install_failed` — Failed to install dependencies
- `unsupported_provider` — Provider not supported
- `invalid_url` — URL not valid for the specified provider
- `download_failed` — yt-dlp download failed
- `merge_failed` — FFmpeg merge failed
- `disk_full` — Not enough disk space
- `cancelled` — Download was cancelled by user

### Usage Example

```ts
import { LumenPlugin } from '@lumen/module-sdk';
import type { LumenHost } from '@lumen/module-sdk';

export default class VideoDownloaderPlugin extends LumenPlugin {
  async onload(host: LumenHost) {
    // Register a command to download a video
    host.commands.add({
      id: 'video-downloader.download',
      title: 'Download YouTube Video',
      run: async () => {
        const url = await host.ui.prompt({
          title: 'YouTube URL',
          placeholder: 'https://www.youtube.com/watch?v=...',
        });

        if (!url) return;

        // Check dependencies first
        const deps = await host.download.checkDependencies();
        if (!deps.ytdlp.installed || !deps.ffmpeg.installed) {
          const ok = await host.ui.confirm({
            title: 'Download requires FFmpeg',
            message: 'To download videos, Lumen needs FFmpeg (~100 MB). Install now?',
          });
          if (!ok) return;
          await host.download.installDependencies();
        }

        // Download the video
        await host.download.video({
          provider: 'youtube',
          url,
          quality: 'best',
          onProgress: (p) => {
            host.ui.notify({ message: `Downloading: ${p.percent}%` });
          },
          onComplete: (result) => {
            host.ui.notify({ message: `Downloaded: ${result.filePath}` });
            // Add to library
            host.library.addUrl?.({
              type: 'video',
              url,
              addToQueue: false,
            });
          },
          onError: (err) => {
            host.ui.notify({ message: `Error: ${err.message}`, level: 'error' });
          },
        });
      },
    });
  }
}
```

### Bus Events

Modules can also listen to download events via `host.bus`:

| Topic | Payload | Description |
|---|---|---|
| `'download:started'` | `{ downloadId, url }` | Download started |
| `'download:progress'` | `{ downloadId, progress }` | Download progress update |
| `'download:complete'` | `{ downloadId, filePath, fileSize }` | Download completed |
| `'download:error'` | `{ downloadId, error }` | Download failed |
| `'download:cancelled'` | `{ downloadId }` | Download cancelled |
| `'dependencies:installed'` | `{ tool, version }` | Dependency installed |

---

## Deferred / Out of Scope

- **Non-YouTube platforms** — only YouTube is supported initially.
- **Batch downloads** — single video download only for now.
- **Download queue** — sequential downloads, no parallel downloads.
- **Auto-update of tools** — tools are re-downloaded only when `versions.json` is missing or corrupted. A future improvement can check for newer versions periodically.
- **Subtitle download** — not included in initial scope.
- **Playlist download** — `--no-playlist` is used to prevent accidental playlist downloads.

---

## Implemented Shape

First cut scope:

1. Rust module `download/` with dependency check, download, and video download commands.
2. `check_dependencies` and `download_dependencies` commands.
3. `download_video` command with progress parsing.
4. `cancel_download` command.
5. GitHub API integration for latest releases.
6. GlobalAlert prompt for dependency installation (when FFmpeg/yt-dlp missing).
7. Toast notifications for download progress and status.
8. Download button on YouTube media items in `file-list-item.tsx`.
9. Progress bar and status updates during download.
10. SQLite update on download completion.
11. Local file playback after download.
