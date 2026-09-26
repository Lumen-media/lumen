// Copyright 2026 Gabriel Santos
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 — see LICENSE for the full text.
// If you modify this file, you must carry a prominent notice stating that you
// changed it (LICENSE section 4(b)).

import type React from 'react';

/** Handle returned by every `add`/`register` call on the host APIs. */
export interface Disposable {
  /**
   * Removes the registration. Never call it twice — the app only guarantees
   * idempotency for the first call.
   */
  dispose(): void;
}

/** Fixed mount points a {@link PanelSpec} can be attached to. */
export type SlotName =
  | 'dialog'
  | 'surface.window'
  | 'presenter.content'
  | 'presenter.controls.item'
  | 'sidebar.right.tabs'
  | 'app.header.trailing';

/** Props injected into every panel component. */
export interface PanelProps {
  /** Closes the hosting slot. Undefined for slots that are not dismissable. */
  close?: () => void;
  [key: string]: unknown;
}

/** Declarative panel registration via {@link PanelsAPI.add}. */
export interface PanelSpec {
  /** Unique within the module. Reusing an id replaces the previous panel. */
  id: string;
  slot: SlotName;
  title?: string;
  /** Image source shown in slot headers. */
  icon?: string;
  component: React.ComponentType<PanelProps>;
  /**
   * Evaluated on every render; return false to unmount the panel without
   * disposing it. Use for conditional availability, not for teardown.
   */
  when?: () => boolean;
}

/** Props passed to a custom search accessory rendered in the commander. */
export interface CommanderSearchAccessoryProps {
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
  back: () => void;
}

/** Component rendered in the search accessory slot. */
export type CommanderSearchTrailingComponent = React.ComponentType<CommanderSearchAccessoryProps>;

/**
 * Handles the back gesture inside a commander app. Return true to consume
 * the event, false or undefined to let the host handle it.
 */
export type CommanderBackHandler = () => boolean | undefined | Promise<boolean | undefined>;

/** Options for enabling commander search on a command. */
export interface CommanderSearchOptions {
  placeholder?: string;
  initialQuery?: string;
}

/** Props passed to a `type: 'app'` command's component. */
export interface CommanderAppProps {
  onClose: () => void;
  onBack: () => void;
  /** Only set when `commanderSearch` is enabled. */
  query?: string;
  setQuery?: (query: string) => void;
  setSearchTrailing?: React.Dispatch<
    React.SetStateAction<CommanderSearchTrailingComponent | undefined>
  >;
  setBackHandler?: (handler: CommanderBackHandler | undefined) => void;
  setFooterTrailing?: React.Dispatch<React.SetStateAction<React.ReactNode | undefined>>;
}

/** A single entry in the command palette. */
export interface CommandSpec {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Accelerator such as `"Ctrl+Shift+P"`. */
  keybinding?: string;
  /** Extra search terms that do not appear in the title. */
  keywords?: string[];
  /** `'action'` runs {@link run}; `'app'` mounts {@link component}. Default `'action'`. */
  type?: 'action' | 'app';
  run?: (args?: unknown) => unknown;
  component?: React.ComponentType<CommanderAppProps>;
  commanderSearch?: boolean | CommanderSearchOptions;
  /** Set by the host; do not set it yourself. */
  moduleId?: string;
}

/** Panel registration. */
export interface PanelsAPI {
  add(spec: PanelSpec): Disposable;
}

/** One result row produced by a {@link PrefixSpec.handle}. */
export interface PrefixResult {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  run?: () => void;
  component?: React.ComponentType<CommanderAppProps>;
  commanderSearch?: boolean | CommanderSearchOptions;
}

/** A `>`-prefixed command palette source that resolves a query to results. */
export interface PrefixSpec {
  /** Literal prefix without the `>`, e.g. `'song'`. */
  prefix: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  placeholder?: string;
  /** Called on every keystroke. Return an empty array for no matches. */
  handle(query: string): PrefixResult[] | Promise<PrefixResult[]>;
  /** Set by the host; do not set it yourself. */
  moduleId?: string;
}

/** Command palette registration and dispatch. */
export interface CommandsAPI {
  add(spec: CommandSpec): Disposable;
  /** Runs a registered command by id. Returns undefined for unknown ids. */
  invoke(id: string, args?: unknown): unknown;
  addPrefix(spec: PrefixSpec): Disposable;
}

/** The background currently applied to the stage. */
export interface SelectedBackground {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
}

/** Native dialogs, toasts and palette control. */
export interface UIAPI {
  /** `level: 'loading'` keeps the toast up until you dismiss it by id. */
  notify(opts: {
    title?: string;
    message: React.ReactNode;
    level?: 'info' | 'warn' | 'error' | 'success' | 'loading' | 'custom';
    [key: string]: unknown;
  }): void;
  /** Resolves false when the user dismisses. */
  confirm(opts: { title: string; message: string; danger?: boolean }): Promise<boolean>;
  /** Resolves null when the user dismisses. */
  prompt(opts: { title: string; placeholder?: string; initial?: string }): Promise<string | null>;
  openCommandPalette(prefilter?: string): void;
  /** Opens the dialog slot containing the panel with this id. */
  openDialog(panelId: string): void;
  openBackgroundPicker(onSelect: (bg: SelectedBackground) => void): void;
}

/** A divider row in a titlebar menu. */
export interface MenuItemSeparator {
  type: 'separator';
  id?: string;
}

/** A clickable menu row. */
export interface MenuItemAction {
  type: 'action';
  id: string;
  label: string;
  /** Display hint only — register a real keybinding through {@link CommandsAPI}. */
  shortcut?: string;
  onClick?: () => void;
}

/** A nested menu. */
export interface MenuItemSubmenu {
  type: 'submenu';
  id?: string;
  label: string;
  items: MenuItemDef[];
}

/** Any row accepted by {@link MenuSpec.items}. */
export type MenuItemDef = MenuItemSeparator | MenuItemAction | MenuItemSubmenu;

/** A top-level titlebar menu contributed by a module. */
export interface MenuSpec {
  id: string;
  label: string;
  items?: MenuItemDef[];
  /** Higher sorts earlier among siblings. Default 0. */
  priority?: number;
}

/** Titlebar menu registration and extension. */
export interface MenusAPI {
  register(spec: MenuSpec): Disposable;
  /** Appends to an existing menu, including host built-ins. */
  addItem(menuId: string, item: MenuItemAction, priority?: number): Disposable;
}

/**
 * Module-scoped event bus. Topics are namespaced per module, so two modules
 * cannot collide unless they pick the same prefix.
 */
export interface BusAPI {
  emit<T = unknown>(topic: string, payload?: T): void;
  on<T = unknown>(topic: string, handler: (payload: T) => void): Disposable;
}

/** Alias of {@link BusAPI}, kept for symmetry with the host property name. */
export type EventsAPI = BusAPI;

/** Scoped JSON store. One document per module, persisted to the app folder. */
export interface DataJsonAPI {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
  get<T = unknown>(key: string, fallback?: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A single ordered schema version. */
export interface Migration {
  version: number;
  /** Raw SQL applied inside a transaction, in ascending `version` order. */
  up: string;
}

/** Handle to a module-private SQLite database. */
export interface SqliteHandle {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Applies not-yet-applied versions and records them. */
  migrate(versions: Migration[]): Promise<void>;
}

/** Persistence surface: a JSON document plus an optional SQLite database. */
export interface DataAPI {
  json: DataJsonAPI;
  sqlite(): Promise<SqliteHandle>;
}

/** A setting the host renders in the module's settings section. */
export interface SettingSpec<T = unknown> {
  key: string;
  label: string;
  description?: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  default: T;
  /** Required when `type` is `'select'`. */
  options?: Array<{ value: T; label: string }>;
}

/** Typed settings registry. Keys are namespaced per module. */
export interface SettingsAPI {
  register<T>(spec: SettingSpec<T>): Disposable;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  onChange<T>(key: string, handler: (value: T) => void): Disposable;
}

/** Summary form of a lyrics document. */
export interface LyricsRef {
  id: string;
  title: string;
  artist?: string;
}

/** One page of a lyrics document. */
export interface SlideRef {
  index: number;
  /** Lines joined with `\n`. */
  text: string;
}

/** A fully loaded lyrics document. */
export interface Lyrics {
  id: string;
  title: string;
  artist?: string;
  slides: SlideRef[];
}

/** Filter accepted by {@link LyricsHostAPI.list}. */
export interface LyricsQuery {
  /** Matched against title and file name. Omit to list everything. */
  search?: string;
}

/** Read access to the lyrics library, plus transport control. */
export interface LyricsHostAPI {
  list(query?: LyricsQuery): Promise<LyricsRef[]>;
  /** Resolves null for unknown ids and for non-lyrics media. */
  get(id: string): Promise<Lyrics | null>;
  /**
   * Resolves null when nothing is playing. `text` is currently always empty —
   * the index is reliable, the text is not.
   */
  currentSlide(): SlideRef | null;
  advance(): void;
  back(): void;
}

/** One entry in the live queue. */
export interface QueueItem {
  id: string;
  title: string;
  path: string;
  type: 'audio' | 'video' | 'image';
  played: boolean;
}

/** Snapshot of the queue. */
export interface QueueState {
  items: { id: string; title: string }[];
  /** null when the queue is empty. */
  currentIndex: number | null;
}

/**
 * A user-configurable source that can enqueue an item mid-show.
 *
 * Prefer this over {@link QueueActionSpec} when the operator should be able to
 * configure what gets added: it supplies the config UI and the summary row.
 */
export interface QueueTriggerSpec {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  ConfigComponent: React.ComponentType<{ value: unknown; onChange: (value: unknown) => void }>;
  /** Shown as the entry summary in the queue; omit to fall back to the label. */
  SummaryComponent?: React.ComponentType<{ value: unknown; onEdit: () => void }>;
  defaultConfig: unknown;
  onFire(config: unknown): void;
}

/**
 * A fire-and-forget queue action.
 *
 * Use when there is nothing to configure — {@link QueueHostAPI.registerAction}
 * takes no config UI, so the operator cannot set anything up front.
 */
export interface QueueActionSpec {
  id: string;
  onFire(config: unknown): void;
}

/**
 * The live queue.
 *
 * Reads are not yet wired to real state: {@link items} returns `[]` and
 * {@link currentIndex} returns `-1`. Writes and the state subscription do work.
 */
export interface QueueHostAPI {
  /** Stub — always `[]`. */
  items(): QueueItem[];
  /** Stub — always `-1`. */
  currentIndex(): number;
  add(item: QueueItem, position?: number): void;
  remove(id: string): void;
  reorder(fromIndex: number, toIndex: number): void;
  shuffle(): void;
  markPlayed(id: string): void;
  state(): QueueState;
  onChange(handler: (state: QueueState) => void): Disposable;
  next(): void;
  previous(): void;
  goTo(index: number): void;
  registerTrigger(spec: QueueTriggerSpec): Disposable;
  registerAction(spec: QueueActionSpec): Disposable;
  /** Replays a trigger by id. This is the auto-advance entry point. */
  addTrigger(triggerId: string, config: unknown): void;
  /** Present on builds with URL media support. */
  addUrl?(input: { url: string; position?: 'end' | 'next'; duration?: number }): Promise<void>;
}

/** Media kinds the library indexes. */
export type MediaType = 'audio' | 'video' | 'image';

/** Lightweight library entry. */
export interface MediaRef {
  id: string;
  path: string;
  name: string;
  type: MediaType;
}

/** A library entry with file metadata. */
export interface MediaItem extends MediaRef {
  duration?: number;
  size: number;
  modifiedAt: string;
}

/** Tags read from the file itself. */
export interface MediaMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  width?: number;
  height?: number;
}

/** Query and metadata access over the indexed media library. */
export interface LibraryHostAPI {
  /** Omit `type` to search across all three kinds. */
  list(type?: MediaType, query?: string): Promise<MediaRef[]>;
  get(id: string): Promise<MediaItem | null>;
  metadata(path: string): Promise<MediaMetadata>;
  /** Resolves a data URL for the generated thumbnail. */
  thumbnail(path: string, size?: number): Promise<string>;
  /** Present on builds with URL media support. */
  addUrl?(input: {
    type: 'video';
    url: string;
    addToQueue?: boolean;
    playNext?: boolean;
    duration?: number;
  }): Promise<MediaRef>;
}

/** The currently loaded track. */
export interface TrackRef {
  id: string;
  path: string;
  title?: string;
  artist?: string;
}

/** Transport control for the audio player. */
export interface PlayerHostAPI {
  current(): TrackRef | null;
  state(): 'playing' | 'paused' | 'idle';
  play(track?: TrackRef): void;
  pause(): void;
  seek(seconds: number): void;
  /** Set the volume, or omit to read it. Returns the applied value. */
  volume(value?: number): number;
  next(): void;
  prev(): void;
}

/** System font discovery. */
export interface FontsAPI {
  list(): Promise<string[]>;
}

/** Describes what is currently driving the stage backdrop. */
export interface StageBackdropChangeDetail {
  active: boolean;
  source: 'player' | 'lyrics' | 'media' | 'scene' | 'unknown' | null;
  mediaType: 'image' | 'video' | 'lyrics' | 'color' | 'unknown' | null;
  id?: string | null;
  name?: string | null;
}

/** Projects a view into the presenter window. */
export interface PresentationHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  /**
   * Replaces the presenter view. Opening the window is implicit — the host
   * opens it on the first `project` and leaves it open afterwards.
   */
  project(viewId: string, props?: unknown): void;
  /** Asks the operator for control of the presenter controls slot. */
  requestPresenterControls(): void;
  controls: {
    /** Install slide components. Only valid after `requestPresenterControls()`. */
    slides(components: React.ComponentType[]): void;
  };
  clear(): void;
  isWindowOpen(): boolean;
}

/**
 * Projects a view into the overlay window — a separate always-on-top surface
 * that survives the presenter window being closed.
 */
export interface OverlayHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  /** Opening the overlay window is implicit and happens on the first call. */
  project(viewId: string, props?: unknown): void;
  /** Clears the view and closes the overlay window. */
  clear(): void;
  isWindowOpen(): boolean;
}

/** Geometry and chrome for a surface window. */
export interface SurfaceWindowOptions {
  maximized?: boolean;
  resizable?: boolean;
  decorations?: boolean;
  title?: string;
  fullscreen?: boolean;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

/** Projects a panel into its own window. */
export interface SurfaceHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  /**
   * Opens a dedicated window hosting the `surface.window` panel with this id.
   * Calling it again for an open panel raises and focuses the existing window
   * rather than opening a second one.
   */
  openWindow(panelId: string, props?: unknown, options?: SurfaceWindowOptions): Promise<void>;
  /** Clears the view and closes the surface window. */
  clear(): void;
  isWindowOpen(): boolean;
}

/** An installed theme. */
export interface ThemeRef {
  id: string;
  name: string;
  colorMode: 'dark' | 'light';
  accentId: string;
  accentHex?: string;
  language?: string;
}

/** Where a background is imported from. */
export type ThemeAddSource = { type: 'url'; url: string } | { type: 'file'; path: string };

/** Input for {@link ThemesHostAPI.addBackground}. */
export interface ThemeAddInput {
  source: ThemeAddSource;
  name?: string;
}

/** Outcome of a background import. */
export interface ThemeAddResult {
  id: number;
  name: string;
  path: string;
  extension: string;
}

/** Theme switching and background management. */
export interface ThemesHostAPI {
  current(): ThemeRef;
  list(): ThemeRef[];
  apply(id: string): void;
  /** Imports a background and makes it the default. */
  addBackground(input: ThemeAddInput): Promise<ThemeAddResult>;
  defaultBackground(): Promise<{
    src: string;
    type: 'theme' | 'image' | 'video';
    name: string;
  } | null>;
  onChange(handler: (theme: ThemeRef) => void): Disposable;
  onDefaultBackgroundChange(
    handler: (
      bg: { src: string; thumb?: string; type: 'theme' | 'image' | 'video'; name: string } | null
    ) => void
  ): Disposable;
}

/**
 * Filesystem access, confined to the module's own sandbox directory.
 *
 * Paths resolve relative to that directory; escaping it fails the call with
 * `path traversal attempt blocked` rather than reaching the host filesystem.
 */
export interface FsAPI {
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

/** ── NetAPI ──────────────────────────────────────────────────────── */

/** HTTP verbs the runtime will issue. */
export type NetMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** How the response body should be decoded. */
export type NetResponseType = 'json' | 'text' | 'bytes' | 'none';

/** Scalar accepted in a query string. */
export type NetQueryValue = string | number | boolean | null | undefined;

/** Tagged union of every body encoding the runtime can send. */
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

/** A single outbound request. */
export interface NetRequest {
  url: string;
  method?: NetMethod;
  query?: Record<string, NetQueryValue | NetQueryValue[]>;
  headers?: Record<string, string>;
  body?: NetRequestBody;
  responseType?: NetResponseType;
  timeoutMs?: number;
  /** Response cap; exceeding it rejects with `response_too_large`. */
  maxBytes?: number;
  followRedirects?: boolean;
}

/** A completed response. Inspect `ok`/`status` rather than relying on rejection. */
export interface NetResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  /** Shape depends on `responseType`; absent when `'none'`. */
  data: T;
}

/**
 * Why a request failed.
 *
 * `permission_denied` and `blocked_url` come from the module's manifest
 * `permissions.network` allowlist, not from the server.
 */
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

/** Rejection value for {@link NetAPI.request}. */
export interface NetError extends Error {
  code: NetErrorCode;
  status?: number;
  url?: string;
}

/**
 * Outbound HTTP.
 *
 * Every call is checked against the module's `permissions.network` allowlist.
 * `get` and `post` are optional and absent when the runtime does not provide
 * them — use {@link NetAPI.request} if you need a guaranteed path.
 */
export interface NetAPI {
  request<T = unknown>(input: NetRequest): Promise<NetResponse<T>>;

  get?<T = unknown>(url: string, opts?: Omit<NetRequest, 'url' | 'method' | 'body'>): Promise<T>;
  post?<T = unknown>(
    url: string,
    body?: NetRequestBody | unknown,
    opts?: Omit<NetRequest, 'url' | 'method' | 'body'>
  ): Promise<T>;
}

/** Translation lookup, scoped to the active profile locale. */
export interface I18nAPI {
  t(key: string, params?: Record<string, string>): string;
  locale(): string;
}

/** Console logger, prefixed with the module id. */
export interface LoggerAPI {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * The object handed to {@link LumenPlugin.onload}.
 *
 * Every property is namespaced per module: two modules can register the same
 * command id or menu id without colliding.
 */
export interface LumenHost {
  meta: { id: string; version: string };
  /** Which window the calling module is mounted in. */
  window: 'main' | 'presenter' | 'surface';
  app: { version: string; locale: string };

  panels: PanelsAPI;
  commands: CommandsAPI;
  menus: MenusAPI;
  ui: UIAPI;

  bus: BusAPI;
  events: EventsAPI;

  data: DataAPI;
  settings: SettingsAPI;

  lyrics: LyricsHostAPI;
  queue: QueueHostAPI;
  library: LibraryHostAPI;
  player: PlayerHostAPI;
  presentation: PresentationHostAPI;
  overlay: OverlayHostAPI;
  surface: SurfaceHostAPI;
  themes: ThemesHostAPI;
  fonts: FontsAPI;

  fs: FsAPI;
  net: NetAPI;
  i18n: I18nAPI;
  log: LoggerAPI;
}

/**
 * Convenience base class. Optional — a plugin can also be a plain object with
 * an `onload` method.
 */
export abstract class LumenPlugin {
  /** Injected by the loader before {@link onload} runs. */
  manifest!: ModuleManifest;

  abstract onload(host: LumenHost): Promise<void>;

  /** Called after the host has disposed everything the module registered. */
  async onunload(): Promise<void> {}
}

/** Contents of a module's `manifest.json`. */
export interface ModuleManifest {
  /** Globally unique, reverse-domain is the convention. */
  id: string;
  name: string;
  version: string;
  /** Host API version this module targets. The loader refuses a mismatch. */
  api: string;
  minLumenVersion?: string;
  description?: string;
  author?: { name: string; url?: string };
  /** Entry file, relative to the module root. */
  entry: string;
  icon?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  permissions?: {
    /** Hosts the module may reach through {@link NetAPI}. */
    network: string[];
  };
}

/** Where a module is in its lifecycle. */
export type ModuleStatus = 'loading' | 'active' | 'faulted' | 'disabled';

/** Loader bookkeeping for one installed module. */
export interface ModuleRecord {
  manifest: ModuleManifest;
  status: ModuleStatus;
  error?: string;
  errorAt?: string;
  /** Consecutive load failures; the loader disables a module past the quota. */
  errorCount: number;
  source: 'bundled' | 'store' | 'sideload' | 'dev';
}
