import type React from 'react';

export interface Disposable {
  dispose(): void;
}

export type SlotName =
  | 'dialog'
  | 'presenter.content'
  | 'sidebar.right.tabs'
  | 'app.header.trailing';

export interface PanelProps {
  close?: () => void;
  [key: string]: unknown;
}

export interface PanelSpec {
  id: string;
  slot: SlotName;
  title?: string;
  icon?: string;
  component: React.ComponentType<PanelProps>;
  when?: () => boolean;
}

export interface CommanderSearchAccessoryProps {
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
  back: () => void;
}

export type CommanderSearchTrailingComponent = React.ComponentType<CommanderSearchAccessoryProps>;

export type CommanderBackHandler = () => boolean | undefined | Promise<boolean | undefined>;

export interface CommanderSearchOptions {
  placeholder?: string;
  initialQuery?: string;
}

export interface CommanderAppProps {
  onClose: () => void;
  onBack: () => void;
  query?: string;
  setQuery?: (query: string) => void;
  setSearchTrailing?: React.Dispatch<
    React.SetStateAction<CommanderSearchTrailingComponent | undefined>
  >;
  setBackHandler?: React.Dispatch<React.SetStateAction<CommanderBackHandler | undefined>>;
}

export interface CommandSpec {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  keybinding?: string;
  keywords?: string[];
  type?: 'action' | 'app';
  run?: (args?: unknown) => unknown;
  component?: React.ComponentType<CommanderAppProps>;
  commanderSearch?: boolean | CommanderSearchOptions;
}

export interface PanelsAPI {
  add(spec: PanelSpec): Disposable;
}

export interface PrefixResult {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  run?: () => void;
  component?: React.ComponentType<CommanderAppProps>;
  commanderSearch?: boolean | CommanderSearchOptions;
}

export interface PrefixSpec {
  prefix: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  placeholder?: string;
  handle(query: string): PrefixResult[] | Promise<PrefixResult[]>;
}

export interface CommandsAPI {
  add(spec: CommandSpec): Disposable;
  invoke(id: string, args?: unknown): unknown;
  addPrefix(spec: PrefixSpec): Disposable;
}

export interface SelectedBackground {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
}

export interface UIAPI {
  notify(opts: { title?: string; message: React.ReactNode; level?: 'info' | 'warn' | 'error' | 'success' | 'loading' | 'custom'; [key: string]: unknown }): void;
  confirm(opts: { title: string; message: string; danger?: boolean }): Promise<boolean>;
  prompt(opts: { title: string; placeholder?: string; initial?: string }): Promise<string | null>;
  openCommandPalette(prefilter?: string): void;
  openDialog(panelId: string): void;
  openBackgroundPicker(onSelect: (bg: SelectedBackground) => void): void;
}

export interface MenuItemSeparator {
  type: 'separator';
  id?: string;
}

export interface MenuItemAction {
  type: 'action';
  id: string;
  label: string;
  shortcut?: string;
  onClick?: () => void;
}

export interface MenuItemSubmenu {
  type: 'submenu';
  id?: string;
  label: string;
  items: MenuItemDef[];
}

export type MenuItemDef = MenuItemSeparator | MenuItemAction | MenuItemSubmenu;

export interface MenuSpec {
  id: string;
  label: string;
  items?: MenuItemDef[];
  priority?: number;
}

export interface MenusAPI {
  register(spec: MenuSpec): Disposable;
  addItem(menuId: string, item: MenuItemAction, priority?: number): Disposable;
}

export interface BusAPI {
  emit<T = unknown>(topic: string, payload?: T): void;
  on<T = unknown>(topic: string, handler: (payload: T) => void): Disposable;
}

export type EventsAPI = BusAPI;

export interface DataJsonAPI {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
  get<T = unknown>(key: string, fallback?: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Migration {
  version: number;
  up: string;
}

export interface SqliteHandle {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  migrate(versions: Migration[]): Promise<void>;
}

export interface DataAPI {
  json: DataJsonAPI;
  sqlite(): Promise<SqliteHandle>;
}

export interface SettingSpec<T = unknown> {
  key: string;
  label: string;
  description?: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  default: T;
  options?: Array<{ value: T; label: string }>;
}

export interface SettingsAPI {
  register<T>(spec: SettingSpec<T>): Disposable;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  onChange<T>(key: string, handler: (value: T) => void): Disposable;
}

export interface LyricsRef {
  id: string;
  title: string;
  artist?: string;
}

export interface SlideRef {
  index: number;
  text: string;
}

export interface Lyrics {
  id: string;
  title: string;
  artist?: string;
  slides: SlideRef[];
}

export interface LyricsQuery {
  search?: string;
}

export interface LyricsHostAPI {
  list(query?: LyricsQuery): Promise<LyricsRef[]>;
  get(id: string): Promise<Lyrics | null>;
  currentSlide(): SlideRef | null;
  advance(): void;
  back(): void;
}

export interface QueueItem {
  id: string;
  title: string;
  path: string;
  type: 'audio' | 'video' | 'image';
  played: boolean;
}

export interface QueueState {
  items: { id: string; title: string }[];
  currentIndex: number | null;
}

export interface QueueTriggerSpec {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  ConfigComponent: React.ComponentType<{ value: unknown; onChange: (value: unknown) => void }>;
  SummaryComponent?: React.ComponentType<{ value: unknown; onEdit: () => void }>;
  defaultConfig: unknown;
  onFire(config: unknown): void;
}

export interface QueueHostAPI {
  items(): QueueItem[];
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
  addUrl?(input: { url: string; position?: 'end' | 'next' }): Promise<void>;
}

export type MediaType = 'audio' | 'video' | 'image';

export interface MediaRef {
  id: string;
  path: string;
  name: string;
  type: MediaType;
}

export interface MediaItem extends MediaRef {
  duration?: number;
  size: number;
  modifiedAt: string;
}

export interface MediaMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface LibraryHostAPI {
  list(type?: MediaType, query?: string): Promise<MediaRef[]>;
  get(id: string): Promise<MediaItem | null>;
  metadata(path: string): Promise<MediaMetadata>;
  thumbnail(path: string, size?: number): Promise<string>;
  addUrl?(input: {
    type: 'video';
    url: string;
    addToQueue?: boolean;
    playNext?: boolean;
  }): Promise<MediaRef>;
}

export interface TrackRef {
  id: string;
  path: string;
  title?: string;
  artist?: string;
}

export interface PlayerHostAPI {
  current(): TrackRef | null;
  state(): 'playing' | 'paused' | 'idle';
  play(track?: TrackRef): void;
  pause(): void;
  seek(seconds: number): void;
  volume(value?: number): number;
  next(): void;
  prev(): void;
}

export interface FontsAPI {
  list(): Promise<string[]>;
}

export interface PresentationHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  project(viewId: string, props?: unknown): void;
  clear(): void;
  isWindowOpen(): boolean;
}

export interface OverlayHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  project(viewId: string, props?: unknown): void;
  clear(): void;
  isWindowOpen(): boolean;
}

export interface ThemeRef {
  id: string;
  name: string;
  colorMode: 'dark' | 'light';
  accentId: string;
}

export interface ThemesHostAPI {
  current(): ThemeRef;
  list(): ThemeRef[];
  apply(id: string): void;
  defaultBackground(): { src: string; type: 'theme' | 'image' | 'video'; name: string } | null;
  onDefaultBackgroundChange(
    handler: (
      bg: { src: string; thumb?: string; type: 'theme' | 'image' | 'video'; name: string } | null
    ) => void
  ): Disposable;
}

export interface FsAPI {
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

// ── NetAPI ────────────────────────────────────────────────────────

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

export interface NetAPI {
  request<T = unknown>(input: NetRequest): Promise<NetResponse<T>>;

  get?<T = unknown>(url: string, opts?: Omit<NetRequest, 'url' | 'method' | 'body'>): Promise<T>;
  post?<T = unknown>(
    url: string,
    body?: NetRequestBody | unknown,
    opts?: Omit<NetRequest, 'url' | 'method' | 'body'>
  ): Promise<T>;
}

export interface I18nAPI {
  t(key: string, params?: Record<string, string>): string;
  locale(): string;
}

export interface LoggerAPI {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface LumenHost {
  meta: { id: string; version: string };
  window: 'main' | 'presenter';
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
  themes: ThemesHostAPI;
  fonts: FontsAPI;

  fs: FsAPI;
  net: NetAPI;
  i18n: I18nAPI;
  log: LoggerAPI;
}

export abstract class LumenPlugin {
  manifest!: ModuleManifest;

  abstract onload(host: LumenHost): Promise<void>;

  async onunload(): Promise<void> {}
}

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  api: string;
  minLumenVersion?: string;
  description?: string;
  author?: { name: string; url?: string };
  entry: string;
  icon?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  permissions?: {
    network: string[];
  };
}

export type ModuleStatus = 'loading' | 'active' | 'faulted' | 'disabled';

export interface ModuleRecord {
  manifest: ModuleManifest;
  status: ModuleStatus;
  error?: string;
  errorAt?: string;
  errorCount: number;
  source: 'bundled' | 'store' | 'sideload' | 'dev';
}
