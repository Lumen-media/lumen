# Video Downloader — Usage Guide

Download YouTube videos for offline playback directly in Lumen. The app uses `yt-dlp` as the download engine and `FFmpeg` for audio/video processing.

---

## How It Works

Lumen does not include download tools in the installer. When you first try to download a video, the app checks if FFmpeg is installed. If not, it displays an alert explaining that FFmpeg is required (~100 MB) and asks if you want to download it from GitHub.

---

## Installing Download Tools

1. Click the download button on any YouTube video in the media panel.
2. If the tools are not installed, a global alert appears:
   - **Title:** "Download requires FFmpeg"
   - **Description:** "To download videos, Lumen needs FFmpeg (~100 MB). It will be downloaded from GitHub. Install now?"
3. Click **Install**.
4. A toast shows the download progress for the tools (yt-dlp + FFmpeg).
5. When finished, the video download starts automatically.

> Tools are downloaded once and saved to the app's data directory.

---

## Downloading a Video

### In the Media Panel (Video tab)

1. Navigate to the **Video** category in the media panel.
2. YouTube videos show a download icon (⬇) when not yet downloaded.
3. Click the download icon.
4. Choose the quality (if available):
   | Quality | Description |
   |---|---|
   | **Best** | Best available quality |
   | **High** | 1080p |
   | **Medium** | 720p |
   | **Low** | 480p |
   | **Audio Only** | Audio only (MP3) |
5. Wait for the download. The progress bar shows speed and estimated time.

### In the Queue

1. YouTube videos in the queue also show download status.
2. Right-click → **Download** or click the download icon.
3. The same quality selection and progress flow applies.

---

## Download Status

| Status | Meaning |
|---|---|
| ⬇ (download icon) | Video not yet downloaded |
| ▶ (progress bar) | Download in progress |
| ✓ (checkmark) | Video downloaded and available offline |
| ⚠ (warning) | Downloaded file was moved or deleted (`missing`) |

---

## Playing Downloaded Videos

After download, the video plays from the local file instead of streaming from YouTube. This means:

- **No internet required** to play.
- **No buffers** or pauses from slow connections.
- **Same playback process** — Lumen's player automatically detects that the file is local.

---

## Canceling a Download

1. During download, a cancel button (✕) appears next to the progress bar.
2. Click to cancel.
3. The partial file is automatically removed.

---

## Installed Tools

Tools are saved to the app's data directory:

| Tool | Purpose | Approximate Size |
|---|---|---|
| **yt-dlp** | Extracts YouTube download URLs and downloads streams | ~17 MB (Windows) |
| **FFmpeg** | Merges video + audio into a single MP4 file | ~170 MB (Windows/Linux) |

> FFmpeg is essential — without it, downloads do not work. yt-dlp is downloaded automatically alongside it.
> 
> **macOS users:** FFmpeg is not auto-downloaded. Install it manually via Homebrew: `brew install ffmpeg`

---

## Updating Tools

Tools are downloaded from the latest version available on GitHub. To update manually:

1. Delete the `tools/` folder in the app's data directory.
2. Restart Lumen.
3. On the next download attempt, the app will download the latest versions.

---

## Troubleshooting

### "Could not download FFmpeg"

- Check your internet connection.
- GitHub may be temporarily unavailable. Try again in a few minutes.
- If the problem persists, check if your firewall is blocking access.
- **macOS:** FFmpeg is not auto-downloaded. Install it manually: `brew install ffmpeg`

### "Could not download the video"

- Check that the YouTube URL is correct.
- Private or age-restricted videos may not be downloadable.
- Some videos may have region restrictions.

### "Insufficient disk space"

- Free up disk space before trying again.
- High-quality videos take up more space (1080p: ~200-500 MB per hour of video).

### File shows as "missing"

- The downloaded file was moved or deleted from disk.
- Click the download icon again to re-download.

---

## Shortcuts

| Shortcut | Action |
|---|---|
| Click ⬇ icon | Start video download |
| Click ✕ during download | Cancel the download |

---

## Notes

- Only YouTube videos are supported initially.
- Playlists are not downloaded — only the individual video.
- Downloaded videos are stored in the `files/media/video/` folder in the app's data directory.
- The app needs disk space equivalent to the size of the downloaded video.
