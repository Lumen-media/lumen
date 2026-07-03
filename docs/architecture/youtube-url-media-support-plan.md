# YouTube URL Media Support Plan

## Goal

Allow Lumen to treat a YouTube URL as a video media item in the library and queue, with the smallest useful model for now:

- Support only YouTube URLs initially.
- Store URL entries under `video` media.
- Do not add an in-app UI to add YouTube videos yet; modules will use host APIs later.
- Reuse the current player path because `ReactPlayer` already handles YouTube.
- Fetch title, channel/author, and thumbnail through YouTube oEmbed when possible.
- Cache the thumbnail locally so the list/queue can still show it offline.
- Persist a download status so the UI/player can distinguish URL-only media from media that has a local downloaded file later.

## Current Decision

Keep the persisted model intentionally small. We do not need provider/source fields while the only accepted URL source is YouTube and the player already supports the URL.

`FileInfo` keeps only these new URL-related fields:

```ts
export type DownloadStatus = 'not_downloaded' | 'downloaded' | 'missing';

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
  extension: string;
  duration?: number;
  title?: string;
  artist?: string;
  originalUrl?: string;
  thumbnailPath?: string;
  remoteThumbnailUrl?: string;
  downloadStatus?: DownloadStatus;
}
```

Compatibility rules:

- Local files keep working exactly as before.
- URL media is identified by `extension === 'url'` or `originalUrl` being present.
- For now, `path` remains required by the existing schema and queue/player flow.
- For URL-only media, `path` stores the normalized YouTube watch URL as a compatibility fallback.
- If a future downloader adds a local video file, the downloaded file path can be represented through the existing `path` semantics after a dedicated migration, or by adding a single explicit local-path column later when the downloader exists.

## SQLite Changes

Add only the fields that are needed by the current behavior.

`media_files`:

```sql
ALTER TABLE media_files ADD COLUMN original_url TEXT;
ALTER TABLE media_files ADD COLUMN thumbnail_path TEXT;
ALTER TABLE media_files ADD COLUMN remote_thumbnail_url TEXT;
ALTER TABLE media_files ADD COLUMN download_status TEXT NOT NULL DEFAULT 'downloaded';
CREATE INDEX IF NOT EXISTS idx_mf_original_url ON media_files (original_url);
```

`queue`:

```sql
ALTER TABLE queue ADD COLUMN original_url TEXT;
ALTER TABLE queue ADD COLUMN thumbnail_path TEXT;
ALTER TABLE queue ADD COLUMN remote_thumbnail_url TEXT;
ALTER TABLE queue ADD COLUMN download_status TEXT NOT NULL DEFAULT 'downloaded';
CREATE INDEX IF NOT EXISTS idx_queue_original_url ON queue (original_url);
```

Fields intentionally not persisted now:

- `source_kind`
- `provider`
- `provider_id`
- `canonical_url`
- `downloaded_path`
- `local_path`

If these columns exist from an earlier local test migration, they can be dropped manually. The app no longer writes or reads them.

## URL Service

Use `src/services/url-media-service.ts` as the narrow provider-aware boundary.

Responsibilities:

1. Accept YouTube URL shapes:
   - `youtube.com/watch?v=...`
   - `youtu.be/...`
   - `youtube.com/shorts/...`
   - `youtube.com/embed/...`
2. Normalize internally to `https://www.youtube.com/watch?v=<videoId>`.
3. Fetch oEmbed:
   - `title` -> `name` and `title`
   - `author_name` -> `artist`
   - `thumbnail_url` -> `remoteThumbnailUrl`
4. Cache the thumbnail under app cache, for example `cache/remote-thumbs/youtube_<videoId>.jpg`.
5. Return a `FileInfo` with:
   - `extension = 'url'`
   - `path = normalized YouTube URL`
   - `originalUrl = input URL`
   - `downloadStatus = 'not_downloaded'`
   - cached thumbnail fields when available

Failure behavior:

- If oEmbed or thumbnail download fails, still create the item.
- Use a fallback title such as `YouTube video <id>`.
- Leave thumbnail fields empty and let the UI fall back to the video icon.

## Library And Queue

Library:

- Add `mediaDbService.insertUrlMedia(url)`.
- Validate that the URL is YouTube.
- Reuse an existing row when `original_url` or normalized `path` already matches.
- Insert the row as `media_type = 'video'`.
- Keep filesystem sync from deleting URL entries by excluding `extension = 'url'` from local-file cleanup.

Queue:

- Persist the same minimal URL fields into `queue` rows.
- Add `queueDbService.addUrlToQueue(url)`.
- Keep duplicate detection based on normalized `file_path` or `original_url`.
- Queue rows should render offline from persisted title/artist/thumb fields.

## Playback

Player-store behavior:

- Treat supported YouTube URLs as `video`.
- Save/restore YouTube URLs as video media.
- Queue auto-advance can keep returning `path`; URL entries already use the normalized YouTube URL there.

Video player behavior:

- If the load payload is HTTP(S), skip local `readFile()`.
- Set `activeUrl` directly to the normalized URL.
- Keep local files on the old blob URL path.

## Thumbnail And UI

Thumbnail service:

- For local media, keep using generated local thumbnails.
- For URL media with `thumbnailPath`, read the cached thumbnail file.
- For URL media with only `remoteThumbnailUrl`, fetch it as a fallback if online.
- If no thumbnail exists, reject and let the UI render the icon.

List/queue badges:

- URL media shows `YouTube`.
- URL-only media shows `Not downloaded`.
- Future local/downloaded media can show `Downloaded`.
- Missing local download can show `Missing download`.

## Module-Facing API

Modules can later call:

```ts
host.library.addUrl({
  type: 'video',
  url: 'https://youtu.be/...',
  addToQueue?: boolean,
  playNext?: boolean,
});

host.queue.addUrl({
  url: 'https://youtu.be/...',
  position?: 'end' | 'next',
});
```

Contract:

- Only YouTube is accepted initially.
- Lumen owns oEmbed lookup and thumbnail caching.
- Modules do not need to know provider IDs or YouTube metadata details.

## Implemented Shape

The first cut should land with this scope:

1. Minimal `FileInfo` URL fields.
2. Dynamic column migration for `media_files` and `queue` using only the four needed columns.
3. YouTube URL parsing, normalization, oEmbed metadata, and cached thumbnail support.
4. URL-safe playback in the video player.
5. Library/queue URL helper methods for future module use.
6. URL badges and download status in library and queue rows.

This keeps the data model small now and leaves room to add one explicit downloaded-file field later only when the downloader behavior is real.
