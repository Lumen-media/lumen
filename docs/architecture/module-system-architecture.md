# Module System — Architecture Design

## Overview

Lumen is a **fat shell** with first-class built-in features (lyrics, queue, media library, presentation, themes, player, mini-player). The module system is **additive**: it lets new first-party features — and, eventually, third-party plugins — extend the app by registering UI, commands, and event handlers against a stable typed **Host API**.

Existing shell features do **not** become modules. They keep living in the shell and expose their capabilities through `host.*` services. Modules are how you build new features cleanly, and how third-parties will plug in later.

The architecture is closer to Obsidian than to VSCode: same execution context as the host, React tree shared with the host, direct method calls instead of RPC. The pieces below describe the loader, the contract, and the host services modules consume.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       LUMEN SHELL (main window)                     │
│                                                                     │
│  Built-in features                Host API surface                  │
│  ┌──────────────────────┐         ┌──────────────────────────────┐  │
│  │ lyrics / queue       │ ◄─────► │ host.lyrics, host.queue, ... │  │
│  │ library / player     │         │ host.panels, host.commands   │  │
│  │ presentation / themes│         │ host.bus, host.data, host.ui │  │
│  └──────────────────────┘         └──────────────┬───────────────┘  │
│                                                  │                  │
│  Module Injector                                 │                  │
│  ┌──────────────────────┐                        ▼                  │
│  │ discover / load      │         ┌──────────────────────────────┐  │
│  │ instantiate Plugin   │ ───────►│ Module instance              │  │
│  │ track Disposables    │         │  onload(host)                │  │
│  │ onunload on remove   │         │  contributes panels / cmds   │  │
│  └──────────────────────┘         │  React components mount      │  │
│                                   │   directly in shell's tree   │  │
│                                   └──────────────────────────────┘  │
└───────────────────────────────────────────┬─────────────────────────┘
                                            │ WebSocket (host.bus)
┌───────────────────────────────────────────┴─────────────────────────┐
│                     LUMEN SHELL (presenter window)                  │
│                                                                     │
│  Module instance (loaded again, host.window === 'presenter')        │
│   registers only the presenter-side panels for the same plugin      │
└─────────────────────────────────────────────────────────────────────┘

Module storage:
  {app_data}/lumen/modules/{id}/main.js
  {app_data}/lumen/modules/{id}/manifest.json
  {app_data}/lumen/modules/{id}/data.json       (if module uses host.data.json)
  {app_data}/lumen/modules/{id}/data.sqlite     (if module calls host.data.sqlite())
```

---

## Goals & Non-goals

**Goals**
- Single loader path for bundled first-party modules and future third-party modules.
- Stable typed Host API as the only contract modules depend on.
- Modules write idiomatic React using the shell's component library — no descriptor compiler, no UI vocabulary lock-in.
- Hot install, enable, disable, uninstall without restarting the app.
- Per-module data isolation on disk; clean uninstall by removing the module directory.
- A clear path to future sandbox/isolation when the third-party marketplace opens.

**Non-goals**
- Sandboxed execution for first-party / power-user modules. Modules run in the same context as the host.
- Permission system at this stage. Module trust is binary: installed = trusted.
- Multi-language modules. JS/TS only.
- Native code inside modules. Privileged work goes through the host's Rust capabilities.
- Backwards compatibility for the unstable `0.x` Host API.

---

## Module Anatomy

What the author writes (source layout):

```
my-module/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts            — entry: exports default class extends LumenPlugin
│   ├── ui/
│   │   ├── configurator.tsx
│   │   └── display.tsx
│   └── state.ts
├── styles.css             — optional, namespaced selectors
├── assets/
│   └── icon.svg
└── README.md
```

What ends up on disk after build (the installable bundle):

```
my-module/
├── manifest.json
├── main.js               — single JS bundle (React + ui code, no external deps)
├── styles.css            — optional
└── assets/icon.svg
```

The only executable artifact is `main.js`. The build step uses the SDK's Vite plugin to bundle source files and externalize `react`, `react-dom`, and `@lumen/ui` (these are resolved against the host at runtime, not bundled).

### Manifest

```json
{
  "id": "lumen.raffle",
  "name": "Raffle",
  "version": "1.0.0",
  "api": "^1.0.0",
  "minLumenVersion": "1.0.0",
  "description": "Quick draws and giveaways during live events.",
  "author": { "name": "Gabriel", "url": "https://..." },
  "entry": "main.js",
  "icon": "assets/icon.svg",
  "homepage": "https://...",
  "repository": "github:user/repo",
  "license": "MIT"
}
```

- `id` — reverse-DNS, globally unique. Used as the data directory name, CSS class namespace, command ID prefix.
- `version` — semver. The store and the host use it for update detection.
- `api` — semver range against the Host API. The host refuses to load incompatible modules.
- `minLumenVersion` — minimum app version. Belt-and-suspenders with `api`.
- `entry` — defaults to `main.js`; override if needed.

There is no `permissions`, `contributes`, `requires`, or `provides`. Registration is fully imperative in `onload`.

---

## The Plugin class — lifecycle

A module's `main.js` default-exports a class extending `LumenPlugin`:

```ts
import { LumenPlugin } from '@lumen/module-sdk';

export default class RafflePlugin extends LumenPlugin {
  async onload(host: LumenHost) {
    // register everything here. Anything returned by host.* is Disposable.
  }

  async onunload() {
    // optional. Disposables returned by host.* are tracked and disposed automatically.
    // override only if you need manual cleanup for resources outside the host API.
  }
}
```

Lifecycle stages:

```
discover ─► load (import main.js) ─► instantiate ─► onload(host) ─► live
                                                                    │
                                            ┌── disable / uninstall ┤
                                            ▼                       │
                                       onunload() ◄────── error / crash
```

1. **Discover.** Rust `module_runtime` scans `{app_data}/lumen/modules/` and the bundled-modules dir. Each subdir with a valid `manifest.json` is a candidate.
2. **Validate.** Manifest parsed, schema-checked, `api` range matched against host, `minLumenVersion` checked.
3. **Load.** `await import('lumen-module://{id}/main.js')`. The default export is the plugin class.
4. **Instantiate.** `new PluginClass()`. Stores a back-reference to the manifest.
5. **Activate.** `await plugin.onload(host)`. The plugin registers panels, commands, event listeners.
6. **Live.** Registered contributions appear in the UI. Bus subscriptions receive events.
7. **Teardown.** On disable / uninstall: `await plugin.onunload()`, then the host disposes every `Disposable` the plugin created. Errors are logged and surfaced as a faulted module; the host stays up.

### The Disposable pattern

Every registration method on `host.*` returns a `Disposable`. The Injector tracks all Disposables created during `onload` and disposes them automatically when the module unloads. The author does not need to remember to clean up panels, commands, or event listeners.

```ts
interface Disposable {
  dispose(): void;
}
```

Manual cleanup is only required for resources outside the host API (third-party event listeners, intervals not registered via `host.timers`, etc.) — done in `onunload`.

---

## The Host API

The `host` object passed to `onload` is the single, typed surface modules program against. It is implemented by the shell and grows incrementally as new modules need new capabilities. Below is the v1 shape.

```ts
interface LumenHost {
  // metadata
  meta:     { id: string; version: string };
  window:   'main' | 'presenter';
  app:      { version: string; locale: string };

  // contribution points
  panels:    PanelsAPI;
  commands:  CommandsAPI;
  ui:        UIAPI;          // notify, dialogs, command palette, etc.

  // shared messaging
  bus:       BusAPI;         // cross-window event bus
  events:    EventsAPI;      // intra-window typed events (host-emitted)

  // storage
  data:      DataAPI;        // json + sqlite, per-module
  settings:  SettingsAPI;    // typed settings page for the module

  // domain services (each existing shell feature exposes one)
  lyrics:       LyricsHostAPI;
  queue:        QueueHostAPI;
  library:      LibraryHostAPI;
  player:       PlayerHostAPI;
  presentation: PresentationHostAPI;
  themes:       ThemesHostAPI;

  // platform shims
  fs:       FsAPI;           // scoped to module dir + user data dirs
  net:      NetAPI;          // request helper with sensible defaults
  i18n:     I18nAPI;
  log:      LoggerAPI;       // namespaced by module id
}
```

### Contribution APIs

**`PanelsAPI`** — declare React components for named slots.

```ts
interface PanelsAPI {
  add(spec: PanelSpec): Disposable;
}

interface PanelSpec {
  id: string;                        // unique within the module
  slot: SlotName;                    // 'sidebar.right.tabs', 'dialog', 'presenter.content', etc.
  title?: string;
  icon?: string;
  component: React.ComponentType<PanelProps>;
  when?: () => boolean;              // optional visibility predicate
}
```

The shell mounts `component` directly in its React tree at the chosen slot. The component receives standard props (close handler for dialogs, slot-specific state, etc.) and may use any React features, `@lumen/ui` components, and the host APIs it captured from `onload`.

**`CommandsAPI`** — invocable named actions.

```ts
interface CommandsAPI {
  add(spec: CommandSpec): Disposable;
  invoke(id: string, args?: unknown): unknown;
}

interface CommandSpec {
  id: string;
  title: string;
  keybinding?: string;
  run: (args?: unknown) => unknown;
}
```

Commands are surfaced in the command palette and can be bound to keys. Any code (host or another module) can `host.commands.invoke('raffle.open')`.

**`UIAPI`** — quick host-rendered UI helpers.

```ts
interface UIAPI {
  notify(opts: { title?: string; message: string; level?: 'info' | 'warn' | 'error' }): void;
  confirm(opts: { title: string; message: string; danger?: boolean }): Promise<boolean>;
  prompt(opts: { title: string; placeholder?: string; initial?: string }): Promise<string | null>;
  openCommandPalette(prefilter?: string): void;
}
```

### Bus and events

**`BusAPI`** — typed cross-window event bus. Synchronizes transparently across main and presenter via the existing WebSocket.

```ts
interface BusAPI {
  emit<T = unknown>(topic: string, payload?: T): void;
  on<T = unknown>(topic: string, handler: (payload: T) => void): Disposable;
}
```

Modules may emit and subscribe to any topic. Convention: namespace topics by module id (`raffle:draw`, `countdown:tick`). Host-emitted system topics (`slide:changed`, `media:played`, `presentation:started`, `theme:changed`) are documented in the SDK.

**`EventsAPI`** — same shape as `BusAPI` but local to the current window. Useful when a module has internal events it doesn't want to leak across windows.

### Storage

```ts
interface DataAPI {
  json: {
    load(): Promise<unknown>;
    save(value: unknown): Promise<void>;
    get<T = unknown>(key: string, fallback?: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };
  sqlite(): Promise<SqliteHandle>;   // lazy, opens on first call
}
```

Default is `host.data.json` — a single JSON file at `{app_data}/lumen/modules/{id}/data.json`, debounced writes, simple key/value helpers. Suitable for settings, small lists, last-used preferences.

For modules with non-trivial data (history with queries, large lists, FTS), `host.data.sqlite()` returns a connection to the module's own SQLite at `{app_data}/lumen/modules/{id}/data.sqlite`. Each module's database is isolated; the host does not provide cross-module SQL.

```ts
interface SqliteHandle {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  migrate(versions: Migration[]): Promise<void>;
}
```

### Domain services (one per shell feature)

These are typed gateways to the built-in features. They grow only when a module needs them — design under pressure, not speculation. Sketch of the initial shape:

```ts
interface LyricsHostAPI {
  list(query?: LyricsQuery): Promise<LyricsRef[]>;
  get(id: string): Promise<Lyrics | null>;
  currentSlide(): SlideRef | null;
  advance(): void;
  back(): void;
}

interface QueueHostAPI {
  items(): QueueItem[];
  currentIndex(): number;
  add(item: QueueItem, position?: number): void;
  remove(id: string): void;
  reorder(fromIndex: number, toIndex: number): void;
  shuffle(): void;
  markPlayed(id: string): void;
}

interface LibraryHostAPI {
  list(type?: MediaType, query?: string): Promise<MediaRef[]>;
  get(id: string): Promise<MediaItem | null>;
  metadata(path: string): Promise<MediaMetadata>;
  thumbnail(path: string, size?: number): Promise<string>;   // returns blob URL
}

interface PlayerHostAPI {
  current(): TrackRef | null;
  state(): 'playing' | 'paused' | 'idle';
  play(track?: TrackRef): void;
  pause(): void;
  seek(seconds: number): void;
  volume(value?: number): number;
  next(): void;
  prev(): void;
}

interface PresentationHostAPI {
  state(): 'idle' | 'live';
  project(viewId: string, props?: unknown): void;   // takeover the presenter window
  clear(): void;                                     // release the takeover
  isWindowOpen(): boolean;
}

interface ThemesHostAPI {
  current(): ThemeRef;
  list(): ThemeRef[];
  apply(id: string): void;
}
```

Each domain service is implemented by the corresponding shell feature. They are not modules.

---

## UI contribution — React directly

A module's UI is plain React. Components from `@lumen/ui` (the host's design-system package) are externalized at build time and resolved against the running host. This means:

- Modules import host components: `import { Button, Card, Input, List } from '@lumen/ui';`
- They write idiomatic JSX, use hooks, manage state with `useState` / `useReducer`, animate with whatever the host supports.
- They can use a small set of explicitly-shared external APIs (e.g. `host.themes.current()` reactive via a hook the SDK provides), but they do **not** poke into Zustand stores or other internal state.

A `LumenPanel` wrapper enforces an error boundary around every contributed panel: if a module throws during render, the panel surface displays a "module faulted" placeholder and the rest of the shell keeps working.

### CSS

Modules may ship a `styles.css` that gets injected globally when the module activates. Selectors must be namespaced under `.lumen-mod-{id}` to avoid collisions. The SDK build step warns on un-namespaced rules.

---

## Cross-window communication

The presenter window is a separate Tauri WebView with its own React tree and its own `LumenHost`. A module that wants to contribute on both windows ships a single bundle that loads in both, and uses `host.window` to decide what to register:

```ts
async onload(host: LumenHost) {
  if (host.window === 'main') {
    host.panels.add({ slot: 'dialog', id: 'raffle.config', component: Configurator });
    host.commands.add({ id: 'raffle.open', run: () => host.dialogs.open('raffle.config') });
  }

  if (host.window === 'presenter') {
    host.panels.add({ slot: 'presenter.content', id: 'raffle.display', component: Display });
  }

  host.bus.on('raffle:draw', ({ name }) => this.state.add(name));
}
```

Cross-window state lives in the **bus**, which is synchronized transparently over the WebSocket transport that already connects main and presenter. From the module's perspective there is no socket — only `host.bus`.

```
                  ┌──────────────────────────────────┐
   Main window    │   Lumen Shell (main)             │
   ┌────────────┐ │   ┌──────────┐   ┌────────────┐  │
   │ Plugin     │─┼──►│  Panels  │   │  host.bus  │◄─┼───┐
   │ (main)     │ │   │  Commands│   │            │  │   │
   └────────────┘ │   │  Dialogs │   └────────────┘  │   │ WebSocket
                  │   └──────────┘                   │   │ (existing)
                  └──────────────────────────────────┘   │
                  ┌──────────────────────────────────┐   │
   Presenter      │   Lumen Shell (presenter)        │   │
   ┌────────────┐ │   ┌──────────┐   ┌────────────┐  │   │
   │ Plugin     │─┼──►│  Slots:  │   │  host.bus  │◄─┼───┘
   │ (presenter)│ │   │ presenter│   │            │  │
   └────────────┘ │   └──────────┘   └────────────┘  │
                  └──────────────────────────────────┘
```

### Sugar over the bus: `host.presentation.project`

The common case "show this content on the presenter window now" gets a convenience helper:

```ts
host.presentation.project('raffle.display', { participants, drawn });
host.presentation.clear();
```

Under the hood this is `host.bus.emit('presentation:project', { viewId, props })`. The presenter window's shell subscribes to this topic, looks up the panel registered with id `raffle.display`, mounts it with the supplied props, and pauses any currently-projected content.

---

## The Injector — runtime

The Injector lives in the renderer process. It owns module discovery, instantiation, registration tracking, and teardown.

Boot sequence:

1. Rust `module_runtime::list_installed_modules` returns manifests for everything in `{app_data}/lumen/modules/` and the bundled-modules dir.
2. Each manifest is validated and `api` is matched against the host.
3. For each enabled module, the renderer does `await import('lumen-module://{id}/main.js')`, instantiates the default-exported class, and calls `onload(host)`.
4. As the plugin registers contributions, every `host.*` method records a `Disposable` against the plugin instance.
5. Once `onload` resolves, the module is **live**.

Errors during load or `onload` mark the module as **faulted** — the renderer logs the error, surfaces a toast, and continues without it. The shell stays up.

Disable / uninstall path:

1. `await plugin.onunload()` (errors during unload are logged, not fatal).
2. The Injector disposes every recorded `Disposable` (panels disappear, commands deregister, bus subscriptions detach, css unloads).
3. The module reference is dropped. If uninstalling, Rust removes `{app_data}/lumen/modules/{id}/`.

### Dev mode

`pnpm lumen module dev <path>` invokes the Rust install command with a `devMode: true` flag. The shell points the protocol handler at the source folder (no copy to app_data) and starts a file watcher. On change, the Injector unloads and reloads the module — same path as production unload/load, no special-casing.

---

## Failure handling

The same-thread execution model means a misbehaving module can affect the host in ways that a sandboxed model would not. The shell isolates most realistic failure modes; the remainder are inherent to same-thread execution and are accepted for v1 in exchange for the simpler authoring experience. The threat model at the end of this section draws the boundary explicitly.

### What the shell isolates

| Failure mode                                            | Mechanism                                                     |
|---------------------------------------------------------|---------------------------------------------------------------|
| Render error in a contributed React component           | Per-panel error boundary; panel renders a fault placeholder   |
| Synchronous throw inside `onload`                       | Injector try/catch; module marked faulted, host continues     |
| Throw in a command's `run` callback                     | Host wraps every invocation                                   |
| Throw in a `host.bus` or `host.events` subscriber       | Dispatcher wraps each subscriber independently                |
| Unhandled promise rejection from module code            | `window.onunhandledrejection` attributes via stack trace      |
| Throw inside `onunload`                                 | Logged; cleanup of Disposables proceeds regardless            |
| `Disposable.dispose()` that throws                      | Each dispose runs in its own try/catch                        |
| Forgotten cleanup                                       | Disposables tracked automatically; freed on unload            |

### What it does not isolate

These follow from running in the same JS thread as the host. They cannot be mitigated without process isolation.

| Failure mode                                | Result                            |
|---------------------------------------------|-----------------------------------|
| Synchronous infinite loop                   | UI thread frozen; whole app hangs |
| Stack overflow or unbounded recursion       | Renderer process crashes          |
| Unbounded heap allocation                   | OS terminates the renderer        |
| Direct destructive DOM access               | Host UI broken                    |
| Monkey-patching globals or prototypes       | Unpredictable host behavior       |
| `window.location` redirect                  | App navigates away                |
| Slow memory leak                            | Gradual app slowdown              |

### Mitigations the Injector implements

- **Per-panel error boundary.** Every component contributed via `host.panels.add` is wrapped. A render error swaps the panel for a fault placeholder; the rest of the shell renders normally.
- **Callback wrappers.** Every module-supplied function passed through the host API (`commands.run`, `bus.on` handlers, panel lifecycle callbacks, etc.) is wrapped at the call site. Throws are caught, logged, and attributed to the module id.
- **Global error attribution.** `window.onerror` and `window.onunhandledrejection` walk the stack to attribute errors to a module when possible. Unattributable errors are logged against the shell.
- **Crash quota.** If a module accumulates more than a configured threshold of errors within a rolling window (default: 5 errors in 10 seconds), the Injector auto-disables it and surfaces a notification. Prevents broken modules from looping noisily.
- **Visible module status.** The settings page surfaces each module's state — `healthy`, `faulted` (with last error and timestamp), or `disabled` (manual or auto). Faulted modules can be retried with a single click without restarting the app.
- **Cleanup proceeds on failure.** `onunload` errors do not stop the Disposable cleanup pass. Each Disposable is disposed in its own try/catch so one bad cleanup does not block the rest.

### Threat model

| Audience                          | Acceptable with v1 model?    | Notes                                                                 |
|-----------------------------------|------------------------------|-----------------------------------------------------------------------|
| First-party / bundled             | Yes                          | Code is reviewed and shipped by the Lumen team                        |
| Power users / sideloaded packs    | Yes                          | User explicitly chose to install; failure modes are bugs, not attacks |
| Third-party from open marketplace | No — requires isolation      | A malicious or buggy plugin must not be able to take down a live event |

The bridge to the marketplace tier is the `isolation: 'worker'` opt-in described in Future work. When the marketplace opens, unsigned modules will be required to declare `isolation: 'worker'`, trading the React-direct authoring model for a Worker-isolated descriptor bridge that contains all of the failure modes above — including the ones the shell cannot currently mitigate.

---

## Native bridge (Rust)

`module_runtime` is the Rust side. It owns:

- **Discovery**: enumerate installed modules from both bundled and user directories.
- **Manifest validation**: JSON schema, semver checks, signature verification for third-party modules (future).
- **Install / uninstall**: extract `.lumenpack` archives, atomic move, register in `lumen.sqlite`.
- **Custom protocol `lumen-module://`**: serves module files to the renderer. The handler checks the module is enabled before serving any byte and adds a CSP appropriate for module assets.
- **Privileged operations**: anything Tauri-only (e.g. native file dialogs, OS notifications, secure storage) is exposed through commands that take a `module_id` parameter. The host shell wraps them in the `host.*` API surface; modules never `invoke()` Tauri directly.

```
src-tauri/src/
└── module_runtime/
    ├── mod.rs          — public commands: install, list, enable, disable, uninstall
    ├── manifest.rs     — schema, parsing, semver checks
    ├── protocol.rs     — lumen-module:// handler
    ├── install.rs      — pack extraction, atomic move
    └── registry.rs     — enabled-modules state in lumen.sqlite
```

---

## Distribution

A built module ships as a single archive called a `.lumenpack` — a zip containing `manifest.json`, `main.js`, and any optional `styles.css` or `assets/`. Same artifact format for every installation source. The SDK CLI produces it from a module's `dist/` directory.

### The `.lumenpack` artifact

```
raffle-1.0.0.lumenpack          (zip)
├── manifest.json
├── main.js
├── styles.css        (optional)
└── assets/
    └── icon.svg
```

### Installation sources

Three sources, one terminal command. They all converge on `module_runtime::install_module` in Rust, which validates, extracts, and registers the module on disk.

```
1. Dev mode               pnpm lumen module dev ./path
                          └─► install_module({ LocalPath, devMode: true })

2. Sideload (manual)      "Install from file…" picker in app settings
                          └─► install_module({ LocalPath: <chosen-file> })

3. Store (community)      User clicks Install on a store card
                          └─► fetch .lumenpack from author's GitHub Release
                              └─► install_module({ Pack: <bytes> })
```

### Bundled (first-party)

Modules shipped with the app live in `src-tauri/resources/modules/{id}/` and are copied to `{app_data}/lumen/modules/{id}/` on first run. Enabled by default; users can disable but not uninstall — the app re-copies on next boot if the directory is missing.

### Store — the GitHub-decentralized model

The store does **not** host modules. It hosts an **index** — a single JSON file in a public GitHub repo (`Lumen-media/community-modules`) listing approved modules and where to find them. Each module's actual `.lumenpack` lives on the author's own repo, attached to a GitHub Release.

```
┌────────────────────────────────────┐     ┌──────────────────────────────┐
│  Lumen-media/community-modules     │     │  Author's repo               │
│  (source of truth for the index)   │     │  github.com/<author>/<repo>  │
│                                    │     │                              │
│  modules.json:                     │     │  Releases:                   │
│  [                                 │     │   v1.0.0 → asset             │
│    {                               │     │           raffle-1.0.0       │
│      "id": "com.example.raffle",   │     │           .lumenpack         │
│      "name": "Raffle",             │ ──► │   v1.1.0 → asset ...         │
│      "repo": "<author>/<repo>",    │     │                              │
│      "tags": [...],                │     │                              │
│      ...                           │     │                              │
│    }                               │     │                              │
│  ]                                 │     │                              │
└────────────┬───────────────────────┘     └──────────────┬───────────────┘
             │ fetched as raw text                        │ fetched via
             │ (raw.githubusercontent.com)                │ GitHub Releases API
             ▼                                            ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                          Lumen app                            │
        │  Store UI lists entries from modules.json. Install button     │
        │  fetches the .lumenpack from the matching GitHub Release.    │
        └──────────────────────────────────────────────────────────────┘
```

**Why this model.** Zero hosting infrastructure for the Lumen team — a single public repo is the entire backend. Authors own their distribution: their repo, their release schedule, their changelog. The moderation point is a single place: PRs into `modules.json`. GitHub Releases handle versioning and asset hosting for free. Same model Obsidian uses at scale.

**Author publishing flow**

1. Build and pack locally: `pnpm lumen module build && pnpm lumen module pack`.
2. Create a GitHub Release on their own repo, tag `vX.Y.Z`, attach the `.lumenpack` as a release asset.
3. Open a pull request against `Lumen-media/community-modules` adding an entry to `modules.json` (id, name, description, author, repo, tags, icon URL).
4. Lumen team reviews — checks id collision against existing entries, manifest validity, basic code review — and merges.

**App install flow**

1. App fetches `https://raw.githubusercontent.com/Lumen-media/community-modules/main/modules.json` and renders the store UI.
2. User clicks Install on an entry.
3. App calls GitHub's API for the latest release of the author's repo (`api.github.com/repos/<owner>/<repo>/releases/latest`).
4. App downloads the `.lumenpack` asset, hands the bytes to `install_module` as `Pack`.
5. `install_module` validates manifest, refuses on id collision against installed modules, extracts to `{app_data}/lumen/modules/{id}/`, registers in `lumen.sqlite`.
6. Injector picks up the new module on the next boot pass or hot-activates it without restart.

**Updates**

The app periodically (and on demand) queries the latest GitHub release for each installed module from the store. If a newer `version` exists than what is installed, the module is surfaced as "Update available" in the Installed list. The user approves; the install flow re-runs against the new release. Installed-but-removed-from-index modules keep running but stop receiving updates and surface a "no longer in store" notice.

### Signing and verification (future)

V1 trusts the moderation review of `modules.json` as the integrity gate. There is no signature verification or content hashing yet. The future third-party-store tier — discussed alongside `isolation: 'worker'` in Future work — is the natural place to introduce signed manifests, sha256 of release assets recorded in the index, and reproducible build checks. None of those exist now.

---

## Developer experience

The module authoring stack is two pieces: a **CLI** for managing the project, and an **SDK** package for writing the plugin code. Together they define the entire surface a third-party developer interacts with.

> The SDK and CLI live in a separate repository (`Lumen-media/module-sdk`) and are published independently to npm. This section describes the **contract** the SDK exposes; details on the SDK's own architecture, package layout, versioning discipline, and release flow are in [module-sdk-architecture.md](./module-sdk-architecture.md).

### CLI — `pnpm lumen module …`

| Command              | Purpose                                                                                            |
|----------------------|----------------------------------------------------------------------------------------------------|
| `init <name>`        | Scaffold a new module from the starter template (manifest, `src/main.ts`, ui example, tsconfig, vite.config) |
| `dev [path]`         | Launch Lumen pointed at a module folder. File watcher; on change the Injector unloads and re-imports |
| `build`              | Bundle `src/main.ts` into `dist/main.js`; copy manifest and assets; externalize React and `@lumen/ui` |
| `pack`               | Run `build`, then zip `dist/` into `{id}-{version}.lumenpack`                                       |
| `validate [path]`    | Schema-check the manifest, warn on un-namespaced CSS, lint host API usage                          |
| `publish` (future)   | Helper that opens a PR against `community-modules` with the right entry pre-filled                  |

### SDK — `@lumen/module-sdk`

**Runtime exports**
- `LumenPlugin` — base class with the `onload(host)` / `onunload()` contract
- Types for everything in `host.*` so module code is fully type-checked
- React hooks that bridge `host.*` services into React reactivity: `useHost()`, `useBus(topic)`, `useTheme()`, `useSetting(key)`, `useQueue()`, `useSlideState()`, etc.

**Build exports**
- `import lumenModule from '@lumen/module-sdk/build'` — a single Vite plugin that:
  - Bundles `src/main.ts` into one ESM `main.js`
  - Externalizes `react`, `react-dom`, `@lumen/ui` (resolved against the host at runtime, not bundled)
  - Copies `manifest.json`, `styles.css`, `assets/` to `dist/`
  - Validates the manifest against the schema at build time
  - Warns on CSS selectors that are not namespaced under `.lumen-mod-{id}`
  - Preserves source maps; integrates with `lumen module dev` for hot reload

### Scaffold and dev loop

```bash
pnpm lumen module init my-module
cd my-module
pnpm install
pnpm lumen module dev .       # Lumen launches with this module loaded; saves trigger reload
```

The starter template ships with a panel + command + state example so the author has a working module to modify on first run.

### Source vs distributed layout

```
Source layout (what the author writes)           Distributed layout (what install_module receives)
─────────────────────────────────────            ──────────────────────────────────────────────────
my-module/                                       my-module-1.0.0.lumenpack  (zip of dist/)
├── manifest.json                                ├── manifest.json
├── package.json                                 ├── main.js
├── tsconfig.json                                ├── styles.css      (if present)
├── vite.config.ts                               └── assets/
├── src/
│   ├── main.ts
│   ├── ui/
│   └── state.ts
├── styles.css       (optional)
├── assets/
└── README.md
```

`pnpm lumen module pack` is the bridge between the two.

---

## What stays in the shell vs what is a module

The shell continues to own everything that is **currently** part of Lumen. Modules are how **new** features are added. As a guideline:

| Stays in the shell                                              | Good candidate for a module                          |
|-----------------------------------------------------------------|------------------------------------------------------|
| Anything already built (lyrics, queue, library, player, themes, presentation, mini-player, settings, routing, theming) | Raffle (new), countdown (new), bible-verse (new), MIDI hardware mapping (new), Spotify integration (new), ProPresenter import (new), per-song notes (new) |
| Core services consumed by many features (queue, presentation, themes) | Anything that can be enabled/disabled independently  |
| Privileged Rust capabilities (fs, db, websocket, thumbnail)     | UI-only features layered on top of host services    |

The litmus test: **if disabling the feature would break other parts of the app, it belongs in the shell**.

---

## Future work

These are deliberately out of scope for v1 and tracked here so the design has a clear evolution path.

- **Sandbox / isolation mode.** Manifest field `isolation: 'main' | 'worker'`, default `main`. When set to `worker`, the Injector loads the module into a Web Worker, exposes the host API via Comlink, and replaces direct React contribution with a declarative UI bridge. Required for unsigned third-party modules.
- **Permission system.** Capability-based grants (`fs:*`, `network:*`, `host.queue:write`). Declared in manifest, prompted at install. Stays dormant until the third-party tier is real.
- **Activation events.** `activationEvents: ['onCommand:raffle.open']` so a module's `onload` only runs when actually needed. Reduces boot cost as the installed-modules count grows.
- **Settings/state migration.** `onMigrate(fromVersion, toVersion)` lifecycle hook for modules that change their `data.json` or `data.sqlite` schema between releases.
- **Observability.** Per-module panel in settings showing CPU, memory, last error, RPC latency, throughput. Important for debugging once third-party modules exist.
- **Inter-module communication.** Currently modules talk only via `host.bus` (loose) or by reading each other's published events. If a hard requirement appears for typed module-to-module services, revisit a `requires`/`provides` mechanism — but only with strong versioning discipline.

---

## Open questions

- **Reactive host services.** `host.queue.items()` is a snapshot. To react to changes, modules need either an event (`host.bus.on('queue:updated', ...)`) or a hook (`useQueue()` from the SDK). The SDK should ship both, but which is the encouraged pattern? Lean towards hooks for React components, events for non-component code.
- **Bundled-module override.** When a first-party module is bundled but the user copies a newer version into `{app_data}/lumen/modules/{id}/`, which wins? Proposal: user copy wins; the app surfaces a warning. Confirms power-user expectations and gives a debugging escape hatch.

---

## Appendix — minimal module sketch

```ts
// src/main.ts
import { LumenPlugin, LumenHost } from '@lumen/module-sdk';
import { Configurator } from './ui/configurator';
import { Display } from './ui/display';

export default class RafflePlugin extends LumenPlugin {
  async onload(host: LumenHost) {
    if (host.window === 'main') {
      host.panels.add({
        slot: 'dialog',
        id: 'raffle.config',
        title: 'Raffle',
        component: Configurator,
      });

      host.commands.add({
        id: 'raffle.open',
        title: 'Open Raffle',
        run: () => host.ui.openDialog('raffle.config'),
      });
    }

    if (host.window === 'presenter') {
      host.panels.add({
        slot: 'presenter.content',
        id: 'raffle.display',
        component: Display,
      });
    }

    host.bus.on('presentation:stopped', () => host.presentation.clear());
  }
}
```

```tsx
// src/ui/configurator.tsx
import { Box, Button, Switch, Textarea, useState } from '@lumen/ui';
import { useHost } from '@lumen/module-sdk';

export function Configurator() {
  const host = useHost();
  const [participants, setParticipants] = useState('');
  const [noRepeat, setNoRepeat] = useState(true);

  function draw() {
    const next = pickOne(participants, { noRepeat });
    host.bus.emit('raffle:draw', { name: next });
    host.presentation.project('raffle.display', { current: next });
  }

  return (
    <Box direction="col" gap="md" padding="md">
      <Switch checked={noRepeat} onChange={setNoRepeat} label="Do not repeat names" />
      <Textarea value={participants} onChange={setParticipants} placeholder="One name per line" />
      <Button variant="primary" onClick={draw}>Draw</Button>
    </Box>
  );
}
```

Manifest: the example shown earlier in this document. Eleven fields, all metadata. The module is a single source file plus two UI files; the build produces one `main.js`. The Injector imports it, calls `onload`, and the modal + presenter contributions are live.
