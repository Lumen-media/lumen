# Module System — Architecture Design

## Overview

Lumen becomes a thin shell. Every domain feature — lyrics, raffle, media library, themes, Unsplash, presenter window contributions — ships as a **Module**. The same loader runs first-party bundled modules and (later) third-party modules installed from a store. The app stays lean because users only pay for modules they enable.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          LUMEN SHELL (host)                            │
│                                                                        │
│  React main thread                          Rust (Tauri)               │
│  ┌──────────────────────────┐               ┌────────────────────────┐ │
│  │  Module Injector         │◄── manifests──│  module_runtime         ││
│  │  ┌───────────────────┐   │   & assets    │   discover / validate   ││
│  │  │ Registries        │   │               │   capability gate       ││
│  │  │  • ContentTypes   │   │   ── fs/db/net│   sqlite namespace      ││
│  │  │  • Panels         │   │   ── capability-gated commands          ││
│  │  │  • MediaSources   │   │               └────────────────────────┘ │
│  │  │  • Commands       │   │                                          │
│  │  │  • EventBus       │   │   Comlink RPC (typed)                    │
│  │  │  • Settings       │   │  ┌─────────────────────────────────────┐ │
│  │  │  • i18n / Theme   │   │  │ Module Worker (one per module)      │ │
│  │  └───────────────────┘   │◄─┤   module.js (pure JS, no DOM)       │ │
│  │                          │  │   contributes registry entries      │ │
│  │  Declarative UI renderer │  │   emits/receives EventBus messages  │ │
│  │  (maps descriptors → host│  │   describes UI as descriptor trees  │ │
│  │   design-system components)│ └────────────────────────────────────┘ │
│  └──────────────────────────┘                                          │
└────────────────────────────────────────────────────────────────────────┘

Module storage:
  {app_data}/lumen/modules/{id}/         — installed module (bundled or installed)
  {app_data}/lumen/modules/{id}/data.sqlite — per-module isolated DB
```

A Module is a pure-logic JavaScript bundle running in a dedicated **Web Worker**. It has no access to the DOM, the host's globals, or other modules' state. It interacts with the host through a single typed **Comlink** RPC channel mediated by a permission gate.

---

## Goals & Non-goals

**Goals**
- Single loader path for first-party and third-party modules.
- Strong isolation by default — a faulty or malicious module cannot crash the host or read state it was not granted.
- Type-safe authoring through a shared `@lumen/module-sdk`.
- Hot install / enable / disable / uninstall without restarting the app.
- Consistent visual identity — modules cannot ship their own design system; the host renders their UI.

**Non-goals**
- Multi-language modules. JS/TS only.
- Native code inside modules. Privileged work goes through host-mediated capabilities.
- Direct DOM manipulation by modules.
- Backwards compatibility for the unstable `0.x` API.

---

## Module Anatomy

```
my-module/
├── manifest.json     — metadata, declared permissions, contribution points
├── module.js         — worker entry (the only file that executes)
├── i18n/
│   ├── en.json
│   └── pt-BR.json
├── assets/
│   └── icon.svg
└── README.md
```

The only executable file is `module.js`. It is loaded into a Worker, given a typed `LumenContext` proxy, and asked to register its contributions.

### Manifest

```json
{
  "id": "lumen.lyrics",
  "name": "Lyrics",
  "version": "1.0.0",
  "api": "^1.0.0",
  "entry": "module.js",
  "permissions": [
    "events:slide:*",
    "events:presentation:*",
    "registry:content-type:write",
    "registry:panel:write",
    "registry:command:write",
    "fs:read:user-lyrics",
    "fs:write:user-lyrics",
    "db:own"
  ],
  "contributes": {
    "contentTypes": ["lyrics"],
    "panels": [
      { "slot": "sidebar.right.tabs", "id": "lyrics.library", "title": "Lyrics" }
    ],
    "commands": [
      { "id": "lyrics.new", "title": "New Lyrics", "keybinding": "Ctrl+N" }
    ],
    "settings": "settings.schema.json",
    "i18n": ["en", "pt-BR"]
  },
  "requires": [],
  "provides": []
}
```

- `id` — reverse-DNS, globally unique. Used as the SQLite namespace and the filesystem scope.
- `api` — semver range against the host's module API. Host refuses to load incompatible modules.
- `permissions` — coarse capabilities declared up front (see Permissions).
- `contributes` — static contribution descriptors. Mounted before `module.js` activates so the host can show panels even while the worker is still spawning.
- `requires` / `provides` — typed inter-module services (see State sharing).

---

## The Injector — runtime lifecycle

```
discover ─► validate ─► resolve deps ─► spawn worker ─► handshake ─► mount ─► live
                                                                      │
                                              ┌── disable / uninstall ─┤
                                              ▼                        │
                                          teardown ◄──────── crash/timeout
```

1. **Discover.** On boot, Rust `module_runtime` scans `{app_data}/lumen/modules/` plus the bundled-modules dir. Each subdir with a valid `manifest.json` is a candidate.
2. **Validate.** Manifest is checked against the JSON Schema. Signature is verified for third-party modules (future). API range matched against host.
3. **Resolve deps.** The Injector builds a DAG from `requires` / `provides`. Cycles or missing providers → module is marked as faulted; the host loads the rest.
4. **Spawn worker.** `new Worker(module-blob-url, { type: 'module' })`. The worker code is fetched via a Tauri custom protocol (`lumen-module://`) so file paths stay opaque.
5. **Handshake.** Host sends a typed `LumenContext` proxy via Comlink. Worker calls `ctx.register(contributions)` with runtime entries (content types, panels, commands, etc.). The handshake has a 5s timeout.
6. **Mount.** Registry entries become live. Panels appear. Commands enter the palette. EventBus subscriptions start receiving events.
7. **Lifecycle hooks.** The module may export `onActivate`, `onDeactivate`, `onSettingsChange`. The host invokes them via RPC.
8. **Teardown.** On disable/uninstall/crash, the host posts `onDeactivate`, waits up to 2s, then terminates the worker and removes contributions. Crashes/timeouts mark the module as faulted and surface a notification.

---

## The Bridge — host ↔ worker

A single Comlink channel per module. Two proxies:

**Module side (`LumenContext`)** — what the module calls into:
```ts
interface LumenContext {
  module: { id: string; version: string };
  registry: {
    contentTypes: ContentTypeRegistryAPI;
    panels:       PanelRegistryAPI;
    mediaSources: MediaSourceRegistryAPI;
    commands:     CommandRegistryAPI;
    settings:     SettingsRegistryAPI;
    theme:        ThemeRegistryAPI;
  };
  events: EventBusAPI;       // subscribe / emit, permission-gated by topic
  fs:     ScopedFSAPI;       // capability-checked path operations
  db:     ModuleDbAPI;       // isolated sqlite namespace
  net:    ScopedFetchAPI;    // only declared origins
  ui:     UIBridgeAPI;       // declare/update UI trees
  log:    LoggerAPI;         // namespaced logger
  i18n:   ScopedI18nAPI;
}
```

**Host side (`ModuleHandle`)** — what the host calls into:
```ts
interface ModuleHandle {
  onActivate?(): Promise<void>;
  onDeactivate?(): Promise<void>;
  onSettingsChange?(next: unknown): Promise<void>;
  onEvent?(topic: string, payload: unknown): void;
  onInteraction?(panelId: string, eventId: string, payload: unknown): void;
}
```

Every call is intercepted by the **permission gate**: each method on the context checks the module's granted capabilities and rejects unauthorized calls before any work happens. The gate also stamps every host log with the module id so misbehavior is attributable.

---

## Declarative UI Bridge

Modules cannot render. They **describe** their UI as a tree of typed descriptors; the host renders that tree using its own design-system components. This is the load-bearing trade-off of the architecture: it guarantees visual consistency, keeps modules tiny (no React, no styling deps), and makes UI changes from a malicious module impossible to weaponize.

### Authoring (module side)

The SDK ships a JSX-flavored API that compiles to descriptors at module build time:

```tsx
import { defineUI, Box, Text, Button, List, useState, useEvent } from '@lumen/module-sdk';

defineUI('lyrics.library', () => {
  const [query, setQuery] = useState('');
  const items = useLyricsList(query);

  return (
    <Box direction="col" gap="md" padding="sm">
      <SearchInput value={query} onChange={setQuery} placeholder="Search lyrics" />
      <List items={items} renderItem={(l) => (
        <ListItem
          key={l.id}
          title={l.name}
          subtitle={l.author}
          onSelect={() => ctx.commands.invoke('lyrics.open', { id: l.id })}
        />
      )} />
    </Box>
  );
});
```

`defineUI`, `useState`, `useEvent`, `useSetting` are tiny worker-side primitives — not React. They drive a render loop inside the worker that produces descriptor trees:

```json
{
  "type": "Box",
  "props": { "direction": "col", "gap": "md", "padding": "sm" },
  "children": [
    { "type": "SearchInput", "props": { "value": "", "onChange": "@evt:1" } },
    { "type": "List", "props": { "items": [...] }, "children": [...] }
  ]
}
```

### Rendering (host side)

The host has a single `<ModuleRenderer descriptor={tree} moduleId={...} />` component that maps `type` → host component (from a curated vocabulary), serializes event handlers as IDs (`@evt:1`), and forwards user interactions back to the worker as `onInteraction(panelId, eventId, payload)`. The worker re-runs its render function and posts a new tree; the host diffs and patches.

### Component vocabulary

The host ships a fixed, documented set of components modules can use. Anything outside this set is rejected at descriptor validation. Starting set: layout (`Box`, `Stack`, `Grid`, `Divider`, `ScrollArea`), text (`Text`, `Heading`, `Code`), input (`Input`, `SearchInput`, `Textarea`, `Select`, `Slider`, `Switch`, `Checkbox`, `ColorPicker`), action (`Button`, `IconButton`, `Menu`), data (`List`, `ListItem`, `Table`, `Tabs`, `Tree`), media (`Image`, `Thumbnail`, `VideoPlayer`), feedback (`Spinner`, `Toast`, `EmptyState`), navigation (`Breadcrumbs`, `Tabs`).

### The escape hatch — `<Surface>`

A small subset of host vocabulary will not be enough for some modules (e.g. presenter-window visualizers, custom canvas widgets). A `<Surface kind="canvas" width=... height=... onFrame=...>` primitive gives the module a raw 2D canvas region; the worker draws via an `OffscreenCanvas` transferred over the bridge. This stays within the Worker isolation envelope (no DOM access), but lets modules paint pixels. Document each new `Surface` kind explicitly. Avoid this path unless required.

---

## Extension Points (Registries)

Modules contribute through a small set of registries. Each registry is a typed table the host queries when rendering or routing events. Contributions are either declared statically in the manifest (cheap, available before activation) or registered dynamically in `module.js` (richer payloads).

### ContentTypeRegistry
Defines projectable content types. Each entry declares:
- `id`, `displayName`, `icon`
- `previewView`, `editorView`, `presenterView` (each a UI descriptor factory)
- `serialize` / `deserialize` (for persistence)
- Optional `match(file)` for opening files

Examples once migrated: `lyrics`, `image`, `video`, `audio`, plus future `countdown`, `bible-verse`, `web-overlay`, `slide-deck`.

### PanelRegistry
Modules attach panels to named slots. Initial slot set:
- `sidebar.left.tabs` — presentation manager
- `sidebar.right.tabs` — media library / queue / themes
- `main.center` — workspace tabs
- `media-window.overlay` — presenter screen contributions
- `settings.section` — settings page sections
- `command-palette.section` — palette groupings
- `editor.lyrics.toolbar` — extension points inside built-in editors

### MediaSourceRegistry
Pluggable browsable sources for the media library. Each provides: `list`, `search`, `fetch`, `metadata`. Today: Unsplash + local files. Future: Pexels, Spotify, NDI inputs, OBS scenes, ProPresenter library import.

### CommandRegistry
Invocable named actions with optional keybinding. Available in the command palette and from any module via `ctx.commands.invoke('id', payload)`.

### EventBus
Typed pub/sub. Permission-gated per topic. Core topics (others can be added):
- `slide:changed { from, to, source }`
- `slide:advance` / `slide:back`
- `media:played` / `media:paused` / `media:ended`
- `queue:updated { items }`
- `presentation:started` / `presentation:stopped`
- `module:activated` / `module:deactivated`
- `settings:changed { moduleId, key }`

### SettingsRegistry
Each module ships a settings schema (Zod or JSON Schema). The host renders the settings page using the declarative UI bridge — modules don't draw their settings UIs by hand. Changes are persisted in a host-owned store and propagated back via `onSettingsChange`.

### ThemeRegistry
Tokens (colors, radii, fonts). Themes are themselves modules — the same loader path. The host re-applies token tables on theme change.

### i18nRegistry
Per-module translation bundles loaded into i18next namespaces (`<module-id>:<key>`).

---

## Permissions Model

Permissions are declared in the manifest, granted at install time, and enforced at every RPC boundary.

**First-party (bundled) modules** are auto-granted everything they declare. **Third-party modules** prompt the user at install with a clear permission summary; the user may approve, deny, or approve a subset (where applicable).

### Capability vocabulary

| Capability                           | Grants                                                            |
|--------------------------------------|-------------------------------------------------------------------|
| `events:<topic-pattern>`             | Subscribe/emit on matching topics (`slide:*`, `media:played`).    |
| `registry:<name>:write`              | Contribute to that registry.                                      |
| `commands:invoke:<id-pattern>`       | Invoke commands matching the pattern.                             |
| `fs:read:<scope>`                    | Read inside a scope: `user-lyrics`, `user-media`, `module-data`.  |
| `fs:write:<scope>`                   | Write inside a scope.                                             |
| `network:<origin>`                   | HTTPS fetches to explicit origins. Wildcards rejected.            |
| `db:own`                             | Open the module's own SQLite namespace.                           |
| `media-window`                       | Contribute to the secondary window slot.                          |
| `clipboard:read` / `clipboard:write` | Mediated by the host.                                             |
| `notifications`                      | Surface toasts and OS notifications.                              |

Permission strings are stable contracts — they're versioned with `api`. Removed or renamed permissions trigger a re-prompt at upgrade.

---

## Native Bridge (Rust)

A `module_runtime` Rust module owns the privileged surface. The frontend cannot reach raw Tauri commands from inside a Worker without going through it.

```
src-tauri/src/
└── module_runtime/
    ├── mod.rs          — discovery, manifest validation, lifecycle commands
    ├── capability.rs   — capability grants and enforcement
    ├── fs_scoped.rs    — scoped fs read/write
    ├── net_scoped.rs   — origin-allowlisted fetch
    ├── db_scoped.rs    — per-module sqlite handle
    └── manifest.rs     — schema, parsing, semver checks
```

Every privileged operation is exposed as a Tauri command that takes a `module_id` and a payload. The command first looks up the module's grants in `capability.rs`; rejects on mismatch. Modules cannot invoke commands directly — they only see `ctx.fs`, `ctx.net`, `ctx.db` proxies on the worker side, which the host translates into capability-checked Tauri calls.

### SQLite isolation

Each module gets its own database file:

```
{app_data}/lumen/modules/{id}/data.sqlite
```

Uninstall = `rm -rf {app_data}/lumen/modules/{id}`. No schema collisions, no leaked data, no migrations to coordinate across modules. The host owns its own database (`lumen.sqlite`) for shell-level state (window, queue, enabled-modules list).

### Filesystem scopes

Scopes are stable named directory roots, not raw paths:

| Scope          | Root                                        |
|----------------|---------------------------------------------|
| `module-data`  | `{app_data}/lumen/modules/{id}/data/`       |
| `user-lyrics`  | user-configured Lyrics directory            |
| `user-media`   | user-configured Media directory             |
| `temp`         | OS temp dir, namespaced                     |

The host resolves the scope at runtime; the module never sees absolute paths it didn't author.

---

## State Sharing & Inter-Module Communication

Modules don't read Zustand stores. There are two sanctioned paths:

1. **EventBus** for loose coupling. Fire-and-forget, permission-gated topics.
2. **Provided Services** for typed RPC between modules. A module declares:

   ```json
   "provides": [{ "id": "queue", "interface": "queue@1" }]
   ```

   Another module declares:

   ```json
   "requires": [{ "id": "queue", "interface": "queue@1" }]
   ```

   The Injector resolves the graph at boot and hands the consumer a Comlink proxy to the provider's exported interface. Interfaces are semver'd; missing or incompatible providers fault the consumer with a clear error.

This makes the dependency graph explicit and inspectable instead of being implicit through shared global state.

---

## Module Distribution

**First-party (bundled).** Each module ships under `src-tauri/resources/modules/{id}/`. On first run, the host copies bundled modules to `{app_data}/lumen/modules/{id}/`. They are pre-approved and always enabled by default. Disabling them is allowed; uninstalling them is not (the host re-copies on next boot if missing).

**Third-party (future).** Downloaded from a store URL (not designed yet). The host validates the manifest, verifies signature, prompts the user for permissions, copies to the same dir tree. From the runtime's standpoint they're indistinguishable from bundled modules — same loader, same enforcement.

**Updates.** Bundled modules update with app releases. Third-party modules check for updates against the store on a configurable cadence and prompt the user before applying.

---

## Developer Experience

The `@lumen/module-sdk` workspace package exports:
- Types for `LumenContext`, manifest, capabilities, registry payloads.
- JSX → descriptor compiler (Vite plugin).
- Component vocabulary types (so authoring catches typos).
- Worker-side primitives: `useState`, `useEvent`, `useSetting`, `useCommand`, `useTheme`.
- Test harness: a mock `LumenContext` for unit tests.

**Module dev mode.** `pnpm lumen module dev <path>` launches the app pointed at a module folder, watches files, and respawns the worker on change. Sourcemaps preserved.

**Templates.** A starter template (`pnpm create @lumen/module my-mod`) scaffolds manifest + entry + i18n + tests.

---

## Mapping the current app onto modules

The migration target. Items in **bold** stay in the shell.

| Today                                | Tomorrow                                                   |
|--------------------------------------|------------------------------------------------------------|
| **Routing, window state**            | **Shell**                                                  |
| **Module Injector, Registries**      | **Shell**                                                  |
| **Permission gate, native bridge**   | **Shell**                                                  |
| **Settings page chrome**             | **Shell** (sections come from modules)                     |
| **Theme runtime**                    | **Shell** (tokens come from theme modules)                 |
| Lyrics editor + library              | `lumen.lyrics` module                                      |
| Media library                        | `lumen.media-library` module                               |
| Unsplash search                      | `lumen.media-source.unsplash` module                       |
| Playback queue                       | `lumen.queue` module (`provides: queue@1`)                 |
| Media window sync (WebSocket)        | `lumen.presenter-bridge` module                            |
| Themes                               | A `lumen.theme.*` module per theme                         |
| Raffle                               | `lumen.raffle` module                                      |
| Mini player                          | `lumen.mini-player` module (panel into `main.center`)      |

The shell shrinks to: routing, window/state plumbing, the Injector, the Registries, the permission gate, the native bridge, and the renderer that draws descriptor trees.

---

## Risks & Open Questions

- **Heavy editors (TipTap).** The current lyrics editor depends on a rich DOM-mounted React subtree. Expressing it as descriptors is non-trivial. Two options: (a) make `RichTextEditor` a first-class host component invoked by descriptor; (b) introduce a narrowly-scoped "trusted module" tier for first-party modules that need full main-thread UI freedom — same API surface, but the entry runs on the main thread instead of a worker, with no permission relaxation. Option (a) preserves the isolation guarantee and is preferred; option (b) is a documented escape hatch with a security caveat.
- **Worker count.** One worker per module is clean but costly past ~20 modules. Mitigation: a shared "worker pool" host that multiplexes low-risk modules onto fewer threads, with same RPC contract. Defer until we measure.
- **Descriptor vocabulary growth.** Every new host component the SDK exposes is part of a public contract. Bias toward composing existing primitives over adding new ones. Promote new vocabulary only after a real module needs it twice.
- **Presenter window scope.** The presenter window is its own webview. Modules contributing there register against `media-window.*` slots; the renderer in the presenter window subscribes to the same registries but with a different visible slot set. The bridge spans windows via the existing WebSocket transport.
- **State migration.** Existing Zustand stores need to be split: shell-owned state stays; domain state moves into module-owned `data.sqlite`. The migration must be runnable on existing user installs without data loss.
- **API stability.** `api: 0.x` until the first module reaches a third-party author. Breaking changes are free during 0.x; once we publish the SDK, semver discipline starts.
- **Signature & store trust.** Third-party signing scheme is undesigned. Tracking under a future doc.

---

## Appendix — Minimal module sketch

```ts
// module.js (runs in a Worker)
import { defineUI, Box, Text, Button, useEvent } from '@lumen/module-sdk';

export async function onActivate(ctx) {
  ctx.registry.commands.add({ id: 'countdown.start', title: 'Start countdown' });

  defineUI('countdown.panel', () => {
    const [remaining, setRemaining] = useState(60);

    useEvent('countdown:tick', () => setRemaining(r => r - 1));

    return (
      <Box direction="col" gap="sm">
        <Text variant="display">{remaining}</Text>
        <Button onClick={() => ctx.commands.invoke('countdown.start')}>Start</Button>
      </Box>
    );
  });
}

export async function onDeactivate() { /* cleanup */ }
```

Manifest declares `events:countdown:*` + `registry:command:write` + `registry:panel:write` and contributes a panel into `sidebar.right.tabs`. The host renders the descriptor tree using its own `Box` / `Text` / `Button` components — pixel-identical to every other panel in the app.
