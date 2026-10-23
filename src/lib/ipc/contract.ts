// Copyright 2026 Gabriel Santos
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 — see LICENSE for the full text.
// If you modify this file, you must carry a prominent notice stating that you
// changed it (LICENSE section 4(b)).

/**
 * Contract between the frontend and the Rust commands registered in
 * `src-tauri/src/main.rs`.
 *
 * Every entry mirrors one `#[tauri::command]` signature:
 *
 * - `args` uses the **camelCase** names Tauri exposes to JavaScript (Rust
 *   `required_permission` is passed as `requiredPermission`). `snake_case` keys
 *   are silently dropped by Tauri, so a typo here disables the argument instead
 *   of failing — this file is the place where that typo becomes a type error.
 * - `result` mirrors the command's `Result<T, _>` payload.
 *
 * Struct fields keep the casing the Rust struct actually serializes to, which
 * varies per module (`Device` is `snake_case`, media/queue rows are
 * `camelCase`), so check the Rust struct before changing a field name.
 *
 * Commands that are not listed here are still invoked through the raw
 * `invoke()` from `@tauri-apps/api/core`; add an entry when migrating one.
 */

import type {
  Migration,
  ModuleManifest,
  NetRequest,
  NetResponse,
  SurfaceWindowOptions,
  ThemeAddInput,
  ThemeAddResult,
} from '@/modules/types';
import type { AppPaths } from '@/services/app-paths';
import type { BootUpdateState, UpdateInfo, UpdateProgress } from '@/services/app-update-service';
import type { ChatConfig, ChatMessage, ChatReactionResult } from '@/services/chat-service';
import type {
  Device,
  DevicePermissions,
  RegistrationTokenPayload,
  RemoteAccessSettings,
} from '@/services/devices-service';
import type { LyricData } from '@/services/lyric-service';
import type {
  MediaFileInput,
  RawFileInfo,
  RawThemeFile,
  SearchHit,
} from '@/services/media-db-service';
import type { Profile } from '@/services/profile-service';
import type { QueueDbItem, QueueFileInput, QueueRow } from '@/services/queue-db-service';
import type { RemoteSyncPayload } from '@/services/remote-sync-service';
import type {
  StoreCatalogResponse,
  StoreInstallResult,
  StoreReadmeResponse,
  StoreReleaseResponse,
} from '@/services/store-service';
import type { StreamingConfig, StreamingStatus } from '@/services/streaming-service';
import type {
  CookieValidation,
  DownloadProvider,
  DownloadQuality,
  DownloadStatus,
  MediaFolder,
  MediaType,
} from '@/services/types';
import type { UrlMediaMetadata } from '@/services/url-media-service';

/** Argument bag for commands that take no parameters. */
export type NoArgs = Record<string, never>;

/** Permission names accepted by `broadcast_remote_event` / remote sessions. */
export type RemotePermission = keyof DevicePermissions;

/* ── Wire types that only exist on the Rust boundary ─────────────────────── */

/** `MediaPoolListing` from `media.rs`. */
export interface MediaPoolFileListing {
  folders: MediaFolder[];
  files: RawFileInfo[];
}

/** `UploadOutput` from `media.rs`. */
export interface MediaUploadOutput {
  path: string;
  file: RawFileInfo | null;
  error: string | null;
}

/** `PresentationMeta` from `presentation.rs`. */
export interface MediaPresentationMeta {
  slide_count: number;
  slides: Array<{ index: number; text: string }>;
  title?: string | null;
}

/** `ScannedFile` from `filescan.rs`. */
export interface ScannedFile {
  name: string;
  path: string;
  folder: string;
  size: number;
  modifiedAt: number;
  extension: string;
}

/** `IdPositionUpdate` from `queue.rs`. */
export interface IdPositionUpdate {
  id: number;
  position: number;
}

/** `PathPositionUpdate` from `queue.rs`. */
export interface PathPositionUpdate {
  path: string;
  position: number;
}

/** `QueueMetadataUpdate` from `queue.rs`. */
export interface QueueMetadataUpdate {
  duration?: number;
  title?: string;
  artist?: string;
  thumbnailPath?: string;
  remoteThumbnailUrl?: string;
}

/** `SlideUpdate` from `streaming/html_server.rs` (fields are `snake_case`). */
export interface SlideUpdate {
  lines: string[];
  font?: string | null;
  font_size?: number | null;
  alignment?: string | null;
  background?: string | null;
  slide_index: number;
  total_slides: number;
  active: boolean;
}

/** Item of `module_list_installed` (`InstalledModule` from the module runtime). */
export interface ModuleListEntry {
  manifest: ModuleManifest;
  source: string;
}

/** Payload of `module_install` / `module_get`. */
export interface InstalledModuleRecord {
  manifest: ModuleManifest;
  source: string;
  enabled: boolean;
}

/** `SystemHardwareInfo` from `main.rs`. */
export interface SystemHardwareInfo {
  total_memory_gb: number;
  gpu_name: string;
}

/** `LocaleInfo` from `locales/mod.rs`. */
export interface RawLocaleInfo {
  code: string;
  name: string;
  native_name: string;
  installed: boolean;
  path: string | null;
}

/** `LocaleStatus` from `locales/mod.rs`. */
export interface RawLocaleStatus {
  latest_tag: string | null;
  last_synced_tag: string | null;
  synced_at: number | null;
  locales_dir: string;
  languages: RawLocaleInfo[];
}

/** `DependencyStatus` from the downloader (snake_case fields). */
export interface RawDependencyStatus {
  ytdlp_installed: boolean;
  ytdlp_version: string | null;
  ytdlp_outdated: boolean;
  ffmpeg_installed: boolean;
  ffmpeg_version: string | null;
  cookies_installed: boolean;
  node_installed: boolean;
  node_dir: string | null;
  tools_dir: string;
}

/** `DependencyInfo` from the downloader. */
export interface RawDependencyInfo {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  platform: string;
}

/** `DownloadResult` from the downloader (snake_case fields). */
export interface RawDownloadResult {
  download_id: string;
  file_path: string;
  file_size: number;
  media_type: string;
  file_extension: string;
}

/** `DownloadStatusInfo` from the downloader. */
export interface RawDownloadStatus {
  status: string;
  progress?: number | null;
}

/* ── Command map ─────────────────────────────────────────────────────────── */

export interface CommandMap {
  /* ── Devices & remote access ──────────────────────────────────────────── */

  /** Lists paired devices. */
  get_devices: { args: NoArgs; result: Device[] };

  /** Reads the remote-access switches. */
  get_remote_access_settings: { args: NoArgs; result: RemoteAccessSettings };

  /** Persists the remote-access switches and closes live sessions if disabled. */
  update_remote_access_settings: {
    args: { remoteEnabled: boolean; transmissionEnabled: boolean };
    result: RemoteAccessSettings;
  };

  /** LAN IPv4 address advertised to remote clients. */
  get_local_ip: { args: NoArgs; result: string };

  /** Mints a single-use pairing token (valid for 15 minutes). */
  gen_reg_token: { args: NoArgs; result: RegistrationTokenPayload };

  /** Activates or deactivates a paired device. */
  toggle_device: { args: { deviceId: string; isActive: boolean }; result: undefined };

  /** Replaces the permission set of a paired device. */
  update_device_permissions: {
    args: { deviceId: string; permissions: DevicePermissions };
    result: undefined;
  };

  /** Forgets a paired device and closes its sessions. */
  remove_device: { args: { deviceId: string }; result: undefined };

  /** Sends a remote-sync envelope to every authorised session. */
  broadcast_remote_event: {
    args: { envelope: RemoteSyncPayload; requiredPermission?: RemotePermission | null };
    result: undefined;
  };

  /* ── Chat ─────────────────────────────────────────────────────────────── */

  send_chat_message: {
    args: { text: string; replyToId?: number | null };
    result: ChatMessage;
  };
  send_chat_file: {
    args: { filePath: string; text?: string | null; replyToId?: number | null };
    result: ChatMessage;
  };
  get_chat_messages: { args: { limit?: number }; result: ChatMessage[] };
  get_chat_config: { args: NoArgs; result: ChatConfig };
  set_chat_config: { args: { config: ChatConfig }; result: undefined };
  clear_chat_history: { args: NoArgs; result: undefined };
  delete_chat_message: { args: { messageId: number }; result: undefined };
  send_chat_reaction: { args: { messageId: number; emoji: string }; result: ChatReactionResult };
  send_chat_typing: { args: { isTyping: boolean }; result: undefined };

  /* ── Queue ────────────────────────────────────────────────────────────── */

  queue_load: { args: NoArgs; result: Array<QueueDbItem & { modifiedAt: number }> };
  queue_load_rows: { args: NoArgs; result: QueueRow[] };
  queue_load_trigger_entries: { args: NoArgs; result: QueueRow[] };
  queue_add_trigger_entry: {
    args: { entryId: string; triggerId: string; configJson: string; title: string; tag: string };
    result: number;
  };
  queue_remove_trigger_entry: { args: { entryId: string }; result: undefined };
  queue_toggle_trigger_played: { args: { entryId: string }; result: undefined };
  queue_exists: { args: { filePath: string }; result: boolean };
  queue_add_to_queue: { args: { file: QueueFileInput }; result: number };
  queue_play_next: { args: { file: QueueFileInput }; result: number };
  queue_add_url_to_queue: { args: { url: string }; result: number };
  queue_remove: { args: { id: number }; result: undefined };
  queue_mark_played: { args: { id: number }; result: undefined };
  queue_toggle_played: { args: { id: number }; result: undefined };
  queue_shift: {
    args: { excludePath?: string | null };
    result: (QueueDbItem & { modifiedAt: number }) | null;
  };
  queue_clear: { args: NoArgs; result: undefined };
  queue_reorder: { args: { orderedIds: number[] }; result: undefined };
  queue_update_all_positions: {
    args: { idUpdates: IdPositionUpdate[]; pathUpdates: PathPositionUpdate[] };
    result: undefined;
  };
  queue_shuffle: { args: NoArgs; result: undefined };
  queue_update_metadata: {
    args: { filePath: string; metadata: QueueMetadataUpdate };
    result: undefined;
  };

  /* ── Media library ────────────────────────────────────────────────────── */

  media_initialize: { args: NoArgs; result: undefined };
  media_sync_type: { args: { mediaType: MediaType; files: MediaFileInput[] }; result: undefined };
  media_list: { args: { mediaType: MediaType }; result: RawFileInfo[] };
  media_list_folder: {
    args: { mediaType: MediaType; folder?: string | null };
    result: MediaPoolFileListing;
  };
  media_search_files: { args: { mediaType: MediaType; query: string }; result: RawFileInfo[] };
  media_insert: {
    args: { file: MediaFileInput; mediaType: MediaType; content?: string | null };
    result: undefined;
  };
  media_insert_url: {
    args: { url: string; refreshMetadata: boolean; duration?: number | null };
    result: RawFileInfo;
  };
  media_search: {
    args: {
      query: string;
      fullContent?: boolean | null;
      mediaType?: MediaType | null;
      limit?: number | null;
    };
    result: SearchHit[];
  };
  media_search_multi: {
    args: {
      query: string;
      fullContent?: boolean | null;
      mediaTypes: MediaType[];
      limitPerGroup?: number | null;
    };
    result: SearchHit[];
  };
  media_upload_files: {
    args: { mediaType: MediaType; folder?: string | null; filePaths: string[] };
    result: MediaUploadOutput[];
  };
  media_list_by_type: { args: { mediaType: MediaType; limit?: number | null }; result: SearchHit[] };
  media_get_by_id: { args: { id: number }; result: SearchHit | null };
  media_get_by_path: { args: { path: string }; result: SearchHit | null };
  media_get_file_info_by_path: { args: { path: string }; result: RawFileInfo | null };
  media_get_file_info_by_id: { args: { id: number }; result: RawFileInfo | null };
  media_get_file_info_by_original_url: {
    args: { originalUrl: string; canonicalUrl?: string | null };
    result: RawFileInfo | null;
  };
  media_delete: { args: { path: string }; result: undefined };
  media_delete_folder: { args: { mediaType: MediaType; folder: string }; result: undefined };
  media_update_download_status: {
    args: {
      originalUrl: string;
      status: DownloadStatus;
      newPath?: string | null;
      newSize?: number | null;
      newMediaType?: string | null;
      newExtension?: string | null;
    };
    result: undefined;
  };
  media_sync_themes: { args: { files: MediaFileInput[] }; result: undefined };
  media_list_themes: { args: NoArgs; result: RawThemeFile[] };
  media_insert_theme: {
    args: { file: MediaFileInput; contentHash?: string | null };
    result: undefined;
  };
  media_delete_theme: { args: { path: string }; result: undefined };

  /* ── Presentation / files ─────────────────────────────────────────────── */

  extract_presentation_metadata: { args: { path: string }; result: MediaPresentationMeta };
  extract_metadata: { args: { path: string }; result: { duration: number | null } };
  scan_media_files: { args: { mediaType: MediaType }; result: ScannedFile[] };

  /* ── Streaming ────────────────────────────────────────────────────────── */

  get_streaming_config: { args: NoArgs; result: StreamingConfig };
  update_streaming_config: { args: { config: StreamingConfig }; result: StreamingConfig };
  get_streaming_status: { args: NoArgs; result: StreamingStatus };
  set_stream_content_protected: { args: { isProtected: boolean }; result: undefined };
  set_stream_master_volume: { args: { volume: number }; result: number };
  set_stream_device_volume: { args: { deviceId: string; volume: number }; result: number };
  push_stream_slide: { args: { update: SlideUpdate }; result: undefined };
  push_stream_blank: { args: NoArgs; result: undefined };
  set_mobile_preview_device: { args: { deviceId?: string | null }; result: undefined };
  set_stream_overlay: { args: { active: boolean }; result: undefined };

  /* ── Profiles ─────────────────────────────────────────────────────────── */

  profile_list: { args: NoArgs; result: Profile[] };
  profile_save: { args: { profile: Profile }; result: undefined };
  profile_delete: { args: { id: string }; result: undefined };

  /* ── Lyrics ───────────────────────────────────────────────────────────── */

  lyric_parse: { args: { content: string }; result: LyricData };
  lyric_serialize: { args: { data: LyricData }; result: string };
  lyric_build_search_content: { args: { data: LyricData }; result: string };

  /* ── Thumbnails ───────────────────────────────────────────────────────── */

  get_thumbnail: { args: { path: string; size?: number | null }; result: string };
  get_remote_thumbnail: { args: { url: string; maxSize?: number | null }; result: string };

  /* ── URL media ────────────────────────────────────────────────────────── */

  resolve_youtube: { args: { url: string }; result: UrlMediaMetadata };

  /* ── App paths & windows ──────────────────────────────────────────────── */

  get_app_paths: { args: NoArgs; result: AppPaths };
  get_exe_dir: { args: NoArgs; result: string };
  set_media_folder: {
    args: { mediaType: MediaType; path?: string | null; migrate?: string | null };
    result: undefined;
  };
  restart_app: { args: NoArgs; result: undefined };
  open_folder: { args: { path: string }; result: undefined };
  close_splashscreen: { args: NoArgs; result: undefined };
  create_window: {
    args: { label: string; title: string; route?: string | null };
    result: undefined;
  };
  create_overlay_window: {
    args: { label: string; title: string; route?: string | null };
    result: undefined;
  };
  create_surface_window: {
    args: {
      label: string;
      title: string;
      route?: string | null;
      options?: SurfaceWindowOptions | null;
    };
    result: undefined;
  };
  set_surface_state: { args: { label: string; stateJson: string }; result: undefined };
  get_surface_state: { args: { label: string }; result: string | null };
  save_window_position: { args: { label: string; x: number; y: number }; result: undefined };
  get_system_fonts: { args: NoArgs; result: string[] };
  get_system_info: { args: NoArgs; result: SystemHardwareInfo };

  /* ── Modules ──────────────────────────────────────────────────────────── */

  module_list_installed: { args: NoArgs; result: ModuleListEntry[] };
  module_install: { args: { path: string; devMode: boolean }; result: InstalledModuleRecord };
  module_get: { args: { id: string }; result: InstalledModuleRecord | null };
  module_enable: { args: { id: string }; result: undefined };
  module_disable: { args: { id: string }; result: undefined };
  module_uninstall: { args: { id: string }; result: undefined };
  module_data_json_load: { args: { moduleId: string }; result: unknown };
  module_data_json_save: { args: { moduleId: string; value: unknown }; result: undefined };
  module_data_json_set: {
    args: { moduleId: string; key: string; value: unknown };
    result: undefined;
  };
  module_data_json_delete: { args: { moduleId: string; key: string }; result: undefined };
  module_fs_read: { args: { moduleId: string; path: string }; result: number[] };
  module_fs_write: { args: { moduleId: string; path: string; data: number[] }; result: undefined };
  module_fs_exists: { args: { moduleId: string; path: string }; result: boolean };
  module_fs_list: { args: { moduleId: string; path: string }; result: string[] };
  module_fs_remove: { args: { moduleId: string; path: string }; result: undefined };
  module_data_sqlite_open: { args: { moduleId: string }; result: undefined };
  module_data_sqlite_exec: {
    args: { moduleId: string; sql: string; params: unknown[] };
    result: undefined;
  };
  module_data_sqlite_query: {
    args: { moduleId: string; sql: string; params: unknown[] };
    result: unknown[];
  };
  module_data_sqlite_migrate: {
    args: { moduleId: string; versions: Migration[] };
    result: undefined;
  };
  module_data_sqlite_close: { args: { moduleId: string }; result: undefined };
  module_net_request: {
    args: { moduleId: string; input: NetRequest };
    result: NetResponse<unknown>;
  };
  module_theme_add: {
    args: { moduleId: string; input: ThemeAddInput };
    result: ThemeAddResult;
  };

  /* ── Module store ─────────────────────────────────────────────────────── */

  store_fetch_catalog: { args: NoArgs; result: StoreCatalogResponse };
  store_get_release: { args: { repo: string; force?: boolean }; result: StoreReleaseResponse };
  store_download_module: { args: { repo: string; tag: string }; result: string };
  store_install: { args: { repo: string; tag: string }; result: StoreInstallResult };
  store_get_readme: {
    args: { repo: string; branch?: string | null; locale?: string | null };
    result: StoreReadmeResponse | null;
  };
  store_get_manifest: {
    args: { repo: string; branch?: string | null };
    result: ModuleManifest | null;
  };

  /* ── Locales ──────────────────────────────────────────────────────────── */

  check_locales: { args: NoArgs; result: RawLocaleStatus };
  sync_locales: { args: NoArgs; result: RawLocaleStatus };
  list_locales: { args: NoArgs; result: RawLocaleInfo[] };
  apply_locale: { args: { lang: string }; result: string };

  /* ── Updates ──────────────────────────────────────────────────────────── */

  app_update_progress_state: { args: NoArgs; result: UpdateProgress };
  app_update_boot: { args: NoArgs; result: BootUpdateState };
  check_app_update: { args: { force?: boolean }; result: UpdateInfo | null };
  install_app_update: { args: NoArgs; result: undefined };
  defer_app_update: { args: NoArgs; result: undefined };

  /* ── Downloads & dependencies ─────────────────────────────────────────── */

  check_dependencies: { args: NoArgs; result: RawDependencyStatus };
  download_dependencies: { args: NoArgs; result: undefined };
  list_dependencies: { args: NoArgs; result: RawDependencyInfo[] };
  download_video: {
    args: {
      url: string;
      provider: DownloadProvider;
      quality: DownloadQuality;
      maxHeight?: number | null;
    };
    result: RawDownloadResult;
  };
  cancel_download: { args: { downloadId: string }; result: undefined };
  get_download_status: { args: { downloadId: string }; result: RawDownloadStatus | null };
  install_cookies_file: { args: { sourcePath: string }; result: string };
  validate_cookies: { args: NoArgs; result: CookieValidation };
}

/** Every command name the typed layer knows about. */
export type CommandName = keyof CommandMap;

/** Argument bag of `K`, honouring the "no arguments" case. */
export type CommandArgs<K extends CommandName> = CommandMap[K]['args'];

/** Resolved value of `K`. */
export type CommandResult<K extends CommandName> = CommandMap[K]['result'];
