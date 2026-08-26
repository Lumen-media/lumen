# Module API Reference

Reference for all APIs available to Lumen modules via `host.*`. A module receives the host in `onload` and uses it throughout its lifecycle.

> **Status legend**
> - ✅ Working — use without caveats
> - ⚠️ Partial — works with documented limitations
> - 🚧 Stub — accepts calls but has no real effect yet

---

## Basic module structure

```ts
import { LumenPlugin } from '@lumen/module-sdk';
import type { LumenHost } from '@lumen/module-sdk';

export default class MyModule extends LumenPlugin {
  async onload(host: LumenHost) {
    // register panels, commands, handlers...
  }

  async onunload() {
    // additional cleanup (Disposables are cleaned up automatically)
  }
}
```

> **⚠️ Do not store host API objects in reactive state.** Host objects (`host.queue`, `host.presentation`, etc.) contain closures and internal references. Placing them in Zustand, Redux, `useState`, or any observable store triggers unnecessary comparisons on every state update, degrading performance. Store them in a plain `let` / `const` variable at module scope instead.
>
> ```ts
> // ❌ Wrong — causes performance issues
> useMyStore.getState().init({ queue: host.queue });
>
> // ✅ Right — module-level variable, no reactive overhead
> let apiQueue: QueueHostAPI | null = null;
> apiQueue = host.queue;
> ```

### `manifest.json`

```json
{
  "id": "my-module",
  "name": "My Module",
  "version": "1.0.0",
  "api": "^1.0.0",
  "description": "Short description",
  "author": { "name": "Your Name", "url": "https://example.com" },
  "entry": "main.js",
  "icon": "assets/icon.png"
}
```

---

## Lifecycle and Disposables

Any resource registered via the host returns a `Disposable`. You can hold on to it to remove the resource manually, or ignore it — the runtime removes everything automatically on unload.

```ts
async onload(host: LumenHost) {
  const d = host.commands.add({ id: 'foo', title: 'Foo', run: () => {} });

  // manual removal before unload:
  d.dispose();
}
```

### Crash quota

If a module accumulates **5 or more errors in 10 seconds**, the runtime auto-disables it and shows `faulted` on the Modules settings page. Errors in callbacks registered via the host (`commands.run`, `bus.on`, etc.) are caught and attributed to the module — asynchronous promise rejections are attributed as well.

---

## `host.meta` ✅

```ts
host.meta.id       // string — manifest id
host.meta.version  // string — Lumen app version
```

---

## `host.window` ✅

Indicates which window the module is running in.

```ts
host.window // 'main' | 'presenter' | 'surface'
```

| Value | Description |
|---|---|
| `'main'` | The main Lumen application window |
| `'presenter'` | The presenter/media output window |
| `'surface'` | A module-owned native surface window |

---

## `host.surface` ✅

Opens module UI in a separate native window. Each module gets one active surface window, scoped by module id.

```ts
// Register a panel for the surface window
host.panels.add({
  id: 'my-module.control-window',
  slot: 'surface.window',
  title: 'Control Window',
  component: ControlWindow,
});

// Open the surface window
host.surface.openWindow(
  'my-module.control-window',
  { mode: 'live' },
  { title: 'Control Window', width: 960, height: 640 },
);

// Read state
const state = host.surface.state();        // 'idle' | 'live'
const open = host.surface.isWindowOpen();  // boolean

// Subscribe to state changes
const sub = host.surface.onStateChange((next) => {
  // 'idle' | 'live'
});
sub.dispose();

// Close the current module's surface window
host.surface.clear();
```

The rendered component receives a `close` callback:

```tsx
function ControlWindow({ close }: { close?: () => void }) {
  return (
    <main className="p-6">
      <button type="button" onClick={close}>Close</button>
    </main>
  );
}
```

### `SurfaceHostAPI`

| Method | Returns | Description |
|---|---|---|
| `state()` | `'idle' \| 'live'` | Whether this module's surface window is open |
| `isWindowOpen()` | `boolean` | Same as `state() === 'live'` |
| `openWindow(panelId, props?, options?)` | `void` | Opens or reuses the module's surface window with the given panel |
| `clear()` | `void` | Closes this module's surface window |
| `onStateChange(handler)` | `Disposable` | Subscribe to open/close events scoped to this module |

### `SurfaceWindowOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | panel title | Native window title |
| `width` | `number` | `960` | Initial content width |
| `height` | `number` | `640` | Initial content height |
| `minWidth` | `number` | `720` | Minimum content width |
| `minHeight` | `number` | `480` | Minimum content height |
| `resizable` | `boolean` | `true` | Whether the native window can be resized |
| `decorations` | `boolean` | `true` | Whether OS window decorations are shown |
| `maximized` | `boolean` | `false` | Open maximized |
| `fullscreen` | `boolean` | `false` | Open fullscreen |

### Public bus events

| Topic | Payload | Description |
|---|---|---|
| `surface:window-opened` | `{ moduleId, panelId }` | A module surface window became live |
| `surface:window-closed` | `{ moduleId, panelId? }` | A module surface window closed or cleared |

---

## `host.panels` ⚠️

Adds React components to named slots in the interface. The infrastructure is ready; slots are still being wired into the app layout.

```ts
host.panels.add({
  id: 'my-panel',
  slot: 'sidebar.right.tabs',
  title: 'My Panel',
  component: MyComponent,
  when: () => true,      // optional — visibility condition
});
```

### `PanelSpec`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique panel identifier |
| `slot` | `SlotName` | ✓ | Where the panel appears |
| `title` | `string` | | Displayed title |
| `icon` | `string` | | Icon name or URL |
| `component` | `React.ComponentType<PanelProps>` | ✓ | Component to render |
| `when` | `() => boolean` | | Controls dynamic visibility |

### `SlotName`

| Value | Position |
|---|---|
| `'dialog'` | Modal content opened through `host.ui.openDialog(id)` |
| `'surface.window'` | Module-owned operator-facing native window opened through `host.surface.openWindow(id)` |
| `'presenter.content'` | Presenter/media output surface |
| `'presenter.controls.item'` | Controls injected into the presenter toolbar |
| `'sidebar.right.tabs'` | Right sidebar tab area |
| `'app.header.trailing'` | Compact slot at the start of the header's right-side controls |

Active surfaces in the current app shell: `dialog`, `surface.window`, `presenter.content`, `presenter.controls.item`, `sidebar.right.tabs`, and `app.header.trailing`.

### Presenter controls opt-in

The presenter controls bar only appears when the module explicitly requests it via `host.presentation.requestPresenterControls()`. If a module projects content without calling this method, the controls bar stays hidden.

```ts
// Show the presenter controls bar
host.presentation.requestPresenterControls();

// Set custom slide components rendered in the sequence strip (16:9 aspect ratio)
host.presentation.controls.slides([
  SlideComponentA,
  SlideComponentB,
]);
```

Each slide component is rendered inside a `16:9` aspect ratio container in the horizontal thumbnail strip. The controls bar is automatically hidden when the projection is cleared.

---

## `host.commands` ✅

Registers entries in the command palette (Ctrl+K / ⌘K). Two types are supported: `'action'` executes a function immediately; `'app'` opens a sub-UI inside the palette itself.

### Action command

```ts
host.commands.add({
  id: 'my-module.search',
  title: 'Search files',
  subtitle: 'Find files in the library',      // optional — shown below title
  keybinding: 'Ctrl+Shift+F',                 // optional — displayed as hint
  keywords: ['find', 'browse'],               // optional — improve search hits
  type: 'action',                             // default when omitted
  run: (args) => {
    // executes when the user selects the command
  },
});
```

### App command

Selecting an app command navigates into a sub-view inside the palette where a React component renders freely.

```ts
import { type CommanderAppProps } from '@lumen/module-sdk';

function SearchApp({ onBack, onClose }: CommanderAppProps) {
  return (
    <div className="p-4">
      {/* full UI here */}
      <button onClick={onBack}>Back</button>
    </div>
  );
}

host.commands.add({
  id: 'my-module.browser',
  title: 'File Browser',
  subtitle: 'Browse library files',
  type: 'app',
  component: SearchApp,
});
```

```ts
// Invoke any command programmatically
host.commands.invoke('my-module.search', { query: 'test' });
```

### `CommandSpec`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique identifier (`module-id.name` recommended) |
| `title` | `string` | ✓ | Text displayed in palette |
| `subtitle` | `string` | | Secondary line below title |
| `icon` | `React.ComponentType<{ className?: string }>` | | Lucide or custom icon |
| `keybinding` | `string` | | Keyboard shortcut hint (display only) |
| `keywords` | `string[]` | | Extra terms that match this command |
| `type` | `'action' \| 'app'` | | Defaults to `'action'` |
| `run` | `(args?: unknown) => unknown` | ✓ for `'action'` | Executed on select |
| `component` | `React.ComponentType<CommanderAppProps>` | ✓ for `'app'` | Sub-UI rendered in palette |
| `commanderSearch` | `boolean \| CommanderSearchOptions` | | Shows the commander search input inside the app view and passes its query to `component` |

### `CommanderAppProps`

| Prop | Type | Description |
|---|---|---|
| `onClose` | `() => void` | Closes the palette entirely |
| `onBack` | `() => void` | Returns to the palette root list |
| `query` | `string` | Current value of the commander search input, when `commanderSearch` is enabled |
| `setQuery` | `(query: string) => void` | Updates the commander search input from the app component |
| `setSearchTrailing` | `(component?: CommanderSearchTrailingComponent) => void` | Registers an optional component rendered to the right of the search input |
| `setBackHandler` | `(handler?: CommanderBackHandler) => void` | Registers an optional back override used by the commander header and `Escape` before the app is closed |


### Commander app search

App commands do not show a search input by default. Enable it with `commanderSearch` when the app should use the commander's own input instead of rendering a second search field.

```tsx
import { type CommanderAppProps } from '@lumen/module-sdk';

function SearchApp({ query = '', setSearchTrailing }: CommanderAppProps) {
  React.useEffect(() => {
    if (!setSearchTrailing) return;

    setSearchTrailing(() => function SearchActions() {
      return <button aria-label="Settings">⚙</button>;
    });

    return () => setSearchTrailing(undefined);
  }, [setSearchTrailing]);

  return <Results query={query} />;
}

host.commands.add({
  id: 'my-module.search',
  title: 'Search External Service',
  type: 'app',
  commanderSearch: {
    placeholder: 'Search external service...',
    initialQuery: '',
  },
  component: SearchApp,
});
```

`commanderSearch: true` uses the default app title as the placeholder. Passing an object lets you set `placeholder` and `initialQuery`. Prefix results can also set `commanderSearch`, which is useful when the prefix handler opens an app with the typed prefix query already filled.

### Commander app back handling

Apps can optionally override the commander back action without leaving the app. Register a `setBackHandler` callback that returns `true` when it handled the back action internally. If it returns `false`, `undefined`, or no handler is registered, the commander falls back to the default app exit behavior.

```tsx
function SearchApp({ setBackHandler }: CommanderAppProps) {
  const [view, setView] = React.useState<'search' | 'settings'>('search');

  React.useEffect(() => {
    if (!setBackHandler) return;

    setBackHandler(() => {
      if (view === 'settings') {
        setView('search');
        return true;
      }
    });

    return () => setBackHandler(undefined);
  }, [setBackHandler, view]);
}
```
### Prefix search

Registers a keyword prefix that intercepts typed queries in the palette. When the user types `bible foo`, the query `foo` is routed to your handler instead of running the normal search.

```ts
host.commands.addPrefix({
  prefix: 'bible',
  title: 'Bible',
  placeholder: 'Type a reference (1Jo 2:1) or phrase...',
  handle(query) {
    if (!query) return [];

    // verse reference: "1jo 2:1", "john 3"
    if (/^\w+\s+\d+(:\d+)?/.test(query)) {
      return [
        {
          id: `verse:${query}`,
          title: `Go to ${query}`,
          subtitle: 'Open in Bible viewer',
          run() { host.bus.emit('bible:navigate', { ref: query }); },
        },
      ];
    }

    // full-text search (async)
    return searchBibleAsync(query).then((verses) =>
      verses.map((v) => ({
        id: `verse:${v.ref}`,
        title: v.text,
        subtitle: v.ref,
        badge: 'VERSE',
        run() { host.bus.emit('bible:navigate', { ref: v.ref }); },
      }))
    );
  },
});
```

While a module prefix is active the filter tabs are hidden and results appear under a single group labeled with the prefix `title`. The input placeholder switches to the value you provide in `placeholder`.

### `PrefixSpec`

| Field | Type | Required | Description |
|---|---|---|---|
| `prefix` | `string` | ✓ | Trigger word, e.g. `'bible'` |
| `title` | `string` | ✓ | Group heading shown in results |
| `icon` | `React.ComponentType` | | Optional icon |
| `placeholder` | `string` | | Input placeholder while prefix is active |
| `handle` | `(query: string) => PrefixResult[] \| Promise<PrefixResult[]>` | ✓ | Called with the text after the prefix |

### `PrefixResult`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique within this handler call |
| `title` | `string` | ✓ | Primary text |
| `subtitle` | `string` | | Secondary line |
| `badge` | `string` | | Override the badge label (defaults to prefix `title`) |
| `run` | `() => void` | | Called on Enter — closes palette |
| `component` | `React.ComponentType<CommanderAppProps>` | | Opens as an app screen inside the palette |
| `commanderSearch` | `boolean \| CommanderSearchOptions` | | Shows the commander search input in the opened app screen |

### Built-in scope prefixes

These are built into the commander — no module registration required. Typing the prefix word followed by a space auto-filters the results to the corresponding scope.

| Prefix | Scope |
|---|---|
| `lyric <query>`, `lyrics <query>`, `song <query>` | Lyrics only |
| `media <query>`, `audio <query>`, `video <query>`, `image <query>` | Media files |
| `cmd <query>`, `command <query>`, `commands <query>` | Commands & Shortcuts |

Example: `lyric amazing grace` is equivalent to switching to the **Lyrics** tab and typing `amazing grace`.

---

## `host.ui` ✅

```ts
// Toast notification
host.ui.notify({ message: 'Saved successfully' });
host.ui.notify({ title: 'Warning', message: 'Something went wrong', level: 'error' });
// levels: 'info' | 'warn' | 'error'  (default: 'info')

// Confirmation dialog
const ok = await host.ui.confirm({
  title: 'Delete item?',
  message: 'This action cannot be undone.',
  danger: true,
});

// Text prompt
const name = await host.ui.prompt({
  title: 'File name',
  placeholder: 'untitled.txt',
  initial: '',
});
if (name !== null) { /* user confirmed */ }

// Open command palette
host.ui.openCommandPalette();
host.ui.openCommandPalette('search');  // with prefilter

// Open the background picker — lets the user choose a theme/image/video background
host.ui.openBackgroundPicker((bg) => {
  // bg: { type: 'theme' | 'image' | 'video', src: string, name: string }
  console.log('Selected background:', bg.src)
})

// Open the media picker — lets the user choose a library item (image, audio, video, lyric, presentation)
host.ui.openMediaPicker((item) => {
  // item: LibraryItem
  console.log('Selected media:', item.id, item.title, item.type)
})
```

### `LibraryItem`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Library item ID |
| `title` | `string` | Display name |
| `type` | `'image' \| 'audio' \| 'video' \| 'lyric' \| 'presentation'` | Media type |
| `thumbnail` | `string` (optional) | Thumbnail URL/blob |

### `SelectedBackground`

| Field | Type | Description |
|---|---|---|
| `type` | `'theme' \| 'image' \| 'video'` | Background type |
| `src` | `string` | Blob URL or theme identifier |
| `name` | `string` | Display name |

---

## `host.bus` ✅

Global bus shared across all modules. Use it for cross-module communication or to react to app events.

```ts
// Emit
host.bus.emit('my-module:event', { value: 42 });

// Subscribe
const sub = host.bus.on<{ value: number }>('my-module:event', (payload) => {
  console.log(payload.value);
});

// Unsubscribe before unload:
sub.dispose();
```

### Events emitted by the app (listen via `host.bus`)

| Topic | Payload | Description |
|---|---|---|
| `'lyrics:advance'` | — | Lyrics slide advanced |
| `'lyrics:back'` | — | Lyrics slide went back |
| `'queue:add'` | `QueueItem` | Item added to queue |
| `'queue:remove'` | `{ id }` | Item removed from queue |
| `'queue:reorder'` | `{ from, to }` | Queue reordered |
| `'queue:shuffle'` | — | Queue shuffled |
| `'queue:markPlayed'` | `{ id }` | Item marked as played |
| `'player:play'` | `TrackRef?` | Playback started |
| `'player:pause'` | — | Playback paused |
| `'player:seek'` | `{ seconds }` | Track seeked |
| `'player:volume'` | `{ value }` | Volume changed |
| `'player:next'` | — | Next track |
| `'player:prev'` | — | Previous track |
| `'presentation:project'` | `{ viewId, props? }` | Projection started |
| `'presentation:clear'` | — | Projection cleared |
| `'surface:window-opened'` | `{ moduleId, panelId }` | Module surface window opened |
| `'surface:window-closed'` | `{ moduleId, panelId? }` | Module surface window closed |
| `'themes:apply'` | `{ id }` | Theme changed |

---

## `host.events` ✅

Module-local bus — same API as `bus`, but events are isolated: only the module itself receives them.

```ts
host.events.emit('state:changed', { active: true });
host.events.on('state:changed', (payload) => { /* ... */ });
```

---

## `host.settings` ⚠️

Registers module settings.

```ts
host.settings.register({
  key: 'show-badge',
  label: 'Show badge',
  description: 'Displays a counter on the sidebar tab',
  type: 'boolean',
  default: true,
});

host.settings.register({
  key: 'mode',
  label: 'Operation mode',
  type: 'select',
  default: 'compact',
  options: [
    { value: 'compact', label: 'Compact' },
    { value: 'expanded', label: 'Expanded' },
  ],
});

const value = host.settings.get<boolean>('show-badge');
host.settings.set('show-badge', false);

host.settings.onChange<boolean>('show-badge', (newValue) => {
  // react to change
});
```

### `SettingSpec`

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | `string` | ✓ | Unique key within the module |
| `label` | `string` | ✓ | Display label |
| `description` | `string` | | Help text |
| `type` | `'boolean' \| 'string' \| 'number' \| 'select'` | ✓ | Value type |
| `default` | `T` | ✓ | Default value |
| `options` | `Array<{ value, label }>` | | Only for `'select'` |

> ⚠️ Settings work in memory but are not shown in any UI and do not persist across reloads. Use `host.data.json` to persist preferences for now.

---

## `host.data` ✅

Persistent storage isolated per module.

### JSON

Ideal for settings and simple state.

```ts
// Load everything
const state = await host.data.json.load();

// Save everything at once
await host.data.json.save({ count: 10, items: [] });

// Read/write individual keys
const count = await host.data.json.get<number>('count', 0);
await host.data.json.set('count', count + 1);
await host.data.json.delete('obsolete-key');
```

### SQLite

Ideal for larger volumes of structured data.

```ts
const db = await host.data.sqlite();

// Versioned migrations (always run in onload)
await db.migrate([
  {
    version: 1,
    up: `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  },
]);

// Write
await db.exec('INSERT INTO items VALUES (?, ?, ?)', [id, name, Date.now()]);

// Read
const items = await db.query<{ id: string; name: string }>(
  'SELECT id, name FROM items ORDER BY created_at DESC'
);
```

---

## `host.fs` ✅

File system access within the module's data directory. Paths are always relative to the module root — path traversal attempts (`../`) are blocked by the runtime.

```ts
// Read
const bytes = await host.fs.read('cache/thumb.jpg');

// Write
const encoder = new TextEncoder();
await host.fs.write('export.csv', encoder.encode('id,name\n1,test'));

// Existence check
const exists = await host.fs.exists('config.json');

// List directory
const files = await host.fs.list('cache/');

// Remove
await host.fs.remove('temp/file.tmp');
```

---

## `host.net` ✅

Generic host-managed HTTP requests for modules. Implemented through Rust/Tauri with `reqwest` — permission checks, timeouts, response size limits, and redirect validation are all enforced by the Lumen host. See [module-net-request-api.md](./architecture/module-net-request-api.md).

The primary API is `request()`. Convenience helpers `get()` and `post()` are thin wrappers that throw on non-2xx and return `response.data` directly.

```ts
// Primary API — full control
const response = await host.net.request<{ items: unknown[] }>({
  method: 'GET',
  url: 'https://api.example.com/items',
  query: { search: 'test', limit: 10 },
  headers: { Authorization: `Bearer ${token}` },
  responseType: 'json',
  timeoutMs: 15_000,
});

if (!response.ok) {
  throw new Error(`Request failed: ${response.status}`);
}

// Convenience — throws on non-2xx, returns data directly
const items = await host.net.get!<{ items: unknown[] }>(
  'https://api.example.com/items',
  { query: { search: 'test', limit: 10 } },
);

await host.net.request({
  method: 'POST',
  url: 'https://api.example.com/events',
  body: { type: 'json', value: { kind: 'started' } },
  responseType: 'none',
});
```

### Request body modes

| Mode | Type discriminant | Value |
|---|---|---|
| JSON | `{ type: 'json', value: unknown }` | Any JSON-serializable value |
| Text | `{ type: 'text', value: string, contentType?: string }` | Plain text, defaults to `text/plain` |
| Bytes | `{ type: 'bytes', valueBase64: string, contentType?: string }` | Base64-encoded binary |
| Form | `{ type: 'form', value: Record<string, string> }` | URL-encoded form |
| Multipart | `{ type: 'multipart', parts: [...] }` | Not yet supported in v1 |

### Response modes

| Mode | Description |
|---|---|
| `json` (default) | Parses body as JSON. Falls back to raw string if parsing fails. |
| `text` | Returns body as a plain string. |
| `bytes` | Returns body as a base64-encoded string. |
| `none` | Returns `null`. Use for fire-and-forget requests. |

### Defaults

- Method: `GET` when body is absent, `POST` when body is present.
- Response type: `json`.
- Timeout: 15 seconds (max 60 s).
- Max response size: 10 MB (hard limit 50 MB).
- Follow redirects: yes (max 5 hops).
- Only `https://` URLs allowed. Localhost, private IPs, and link-local addresses are blocked.
- Forbidden headers: `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Upgrade`, `Proxy-*`, `Sec-*`.

### Manifest permissions

Modules must declare which URLs they can access in their `manifest.json`:

```json
{
  "permissions": {
    "network": [
      "https://www.googleapis.com/youtube/v3/*",
      "https://api.github.com/repos/example/*"
    ]
  }
}
```

Matching rules:
- Only `https` scheme.
- Exact host match, or wildcard subdomain (`*.example.com`).
- Path wildcards at segment boundaries (`/api/*`).
- Redirect targets are revalidated against the same rules.
- Queries are not part of the permission pattern.
- If a module declares no permissions, all `https` URLs are allowed (behaviour may change in the future).

### Error model

`request()` rejects only on host policy violations or network failures. HTTP 4xx/5xx resolve as `response.ok === false`.

```ts
try {
  await host.net.request({ url: 'https://api.example.com/data' });
} catch (err) {
  // err.code: 'permission_denied' | 'invalid_url' | 'blocked_url'
  //           | 'timeout' | 'network_error' | 'response_too_large'
  //           | 'invalid_response' | 'unsupported_body'
  // err.status?: number
  // err.url?: string
}
```

---

## `host.download` 🚧

Download YouTube videos for offline playback. Uses `yt-dlp` as the download engine and `FFmpeg` for audio/video muxing. Both tools are downloaded on-demand from GitHub releases when first needed.

```ts
// Check if download dependencies are installed
const status = await host.download.checkDependencies();
// { ytdlp: { installed: true, version: string }, ffmpeg: { installed: true, version: string } }

// Install missing dependencies (shows GlobalAlert if called from UI context)
await host.download.installDependencies();

// Download a video
const handle = await host.download.video({
  provider: 'youtube',
  url: 'https://www.youtube.com/watch?v=VIDEO_ID',
  quality: 'best',
  onProgress: (progress) => {
    console.log(`Download: ${progress.percent}%`);
  },
  onComplete: (result) => {
    console.log(`Downloaded to: ${result.filePath}`);
  },
  onError: (error) => {
    console.error(`Download failed: ${error.message}`);
  },
});

// Cancel an active download
await host.download.cancel(handle.downloadId);

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
| `quality` | `'best' \| 'high' \| 'medium' \| 'low' \| 'audio_only'` | | Default: `'best'`. `audio_only` saves to audio section, others to video. |
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
| `mediaType` | `'audio' \| 'video'` | Determined media type (audio for `audio_only`, video for all others) |

> When `quality: 'audio_only'` is used, the file is saved to `files/media/audio/` and `mediaType` is `'audio'`. All other qualities save to `files/media/video/` with `mediaType` is `'video'`.

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
- `ffmpeg_not_found_macos` — FFmpeg not found on macOS (install via: brew install ffmpeg)

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

## `host.log` ✅

Logger prefixed with the module id. Output goes to the console and Tauri logs.

```ts
host.log.debug('Starting sync...');
host.log.info('Module loaded', { version: '1.2.0' });
host.log.warn('Unexpected API response', response);
host.log.error('Failed to save', error);
```

---

## `host.i18n` ⚠️

Basic internationalization for module strings.

```ts
const text = host.i18n.t('greeting', { name: 'Gabriel' });
// 'Hello, {{name}}' → 'Hello, Gabriel'

const locale = host.i18n.locale();
// 'en-US'
```

> ⚠️ Not integrated with the app's i18next instance. Does simple `{{key}}` substitution only — no plurals, namespaces, or automatic translation file loading.

---

## `host.queue` ⚠️

Read state and navigate the playback queue.

```ts
// Read current state
const state = host.queue.state()
// { items: QueueItem[], currentIndex: number | null }

// Subscribe to changes
const unsub = host.queue.onChange((state) => {
  console.log('Current item:', state.items[state.currentIndex ?? 0])
})
unsub.dispose()

// Navigation
host.queue.next()
host.queue.previous()
host.queue.goTo(2)   // 0-based index

// Add a supported URL to the queue — currently YouTube video URLs only
await host.queue.addUrl?.({ url: 'https://youtu.be/VIDEO_ID', position: 'end' })
await host.queue.addUrl?.({ url: 'https://youtu.be/VIDEO_ID', position: 'next' })
```

### `QueueItem`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique item identifier |
| `title` | `string` | Display title |

### `QueueHostAPI`

| Method | Returns | Description |
|---|---|---|
| `state()` | `QueueState` | Current items + currentIndex |
| `onChange(handler)` | `Disposable` | Subscribe to state changes |
| `next()` | `void` | Advance to next item |
| `previous()` | `void` | Go to previous item |
| `goTo(index)` | `void` | Jump to specific index |
| `addUrl(input)` | `Promise<void>` | Adds a supported URL to the queue. Currently YouTube video URLs only. Optional until the SDK types catch up. |

> ⚠️ `state()` read and `onChange` work. Write navigation methods (`next`, `previous`, `goTo`) emit via the app event bus.

---

## `host.player` ⚠️

Control the active media player.

```ts
// Advance to next slide (for presentations/lyrics)
host.player.nextSlide()

// Play a specific library item by ID
host.player.play('media-item-id')
```

### `PlayerHostAPI`

| Method | Returns | Description |
|---|---|---|
| `nextSlide()` | `void` | Advances to next slide in the active presentation/lyric |
| `play(itemId)` | `void` | Plays the library item with the given ID |

> ⚠️ Methods emit via bus — full read state (`current()`, `state()`, `volume()`) not yet wired.

---

### URL media

Modules can ask Lumen to own YouTube metadata and thumbnail caching instead of calling YouTube directly:

```ts
const item = await host.library.addUrl?.({
  type: 'video',
  url: 'https://youtu.be/VIDEO_ID',
  addToQueue: true,
})
```

Initial support is intentionally provider-limited: only YouTube URLs are accepted, and they are stored as `video` media with cached thumbnail metadata when available.

## Domain APIs 🚧

Still only wired via bus — read methods return empty/default data.

| API | Read methods | Write methods |
|---|---|---|
| `host.lyrics` | `list()` → `[]`, `get()` → `null`, `currentSlide()` → `null` | `advance()`, `back()` emit on bus |
| `host.library` | `list()` → `[]`, `get()` → `null` | — |
| `host.presentation` | `state()` → `'idle'`, `isWindowOpen()` → `false` | `project()`, `clear()`, `requestPresenterControls()`, `controls.slides()` |

---

## `host.themes` — background APIs ✅

Methods on `host.themes` are fully implemented and read real profile state.

### `addBackground(input)`

Registers a new background image in the app's themes library. The image is written to the shared themes folder (`lumen/files/media/themes/`) and inserted into the `theme_files` table, exactly like a manually downloaded Unsplash image — it then appears in the background picker and can be served via `lumen-module://__theme/id/{id}`.

```ts
const theme = await host.themes.addBackground({
  source: { type: 'url', url: 'https://example.com/background.jpg' },
  name: 'My Module Background',
})
// { id: 12, name: 'My Module Background.jpg', path: 'C:\\lumen\\files\\media\\themes\\My Module Background.jpg', extension: '.jpg' }
```

`source` accepts either a remote URL or a file from the module's own data directory:

```ts
// From a file inside the module's sandboxed data dir (path is module-relative):
const theme = await host.themes.addBackground({
  source: { type: 'file', path: 'assets/background.png' },
})
```

Behavior:

- **URL source** — the host downloads the image on the module's behalf using the module's manifest `permissions.network` allowlist. URLs outside the allowlist are rejected with `permission_denied`; localhost/private hosts are blocked; the response must be an image and is capped at 50 MB.
- **File source** — the path is resolved inside the module's own sandboxed directory (same scoping as `host.fs`). Path traversal is blocked.
- **`name`** (optional) — display/file name. When omitted, it is derived from the URL or file name. Invalid filename characters are sanitized, and a numeric suffix (`name (1)`, `name (2)`, …) is added if a file with the same name already exists.
- Supported image types: `gif`, `jpg`, `jpeg`, `png`, `webp`, `svg`, `bmp`, `avif`.

The returned `ThemeAddResult` contains the persisted file metadata; the new background is available in the background picker immediately (the picker re-lists themes on open).

### `defaultBackground()`

Returns the active profile's default background, or `null` if none is set.

```ts
const bg = host.themes.defaultBackground()
// { type: 'theme' | 'image' | 'video', src: string, name: string } | null
```

> **Do not call this at `onload` and store the result.** The profile store may not be hydrated yet when the module loads — `defaultBackground()` can return `null` even when a background is configured. Use `onDefaultBackgroundChange` instead.

### `onDefaultBackgroundChange(handler)`

Subscribes to background changes and fires immediately with the current value once the profile store is ready. The handler receives a blob URL — the host reads the file using Lumen's own filesystem access before calling back.

```ts
// In onload:
const hostExt = host as unknown as {
  themes: {
    onDefaultBackgroundChange?: (
      handler: (bg: { src: string; type: string; name: string } | null) => void
    ) => { dispose(): void }
  }
}

hostExt.themes.onDefaultBackgroundChange?.((bg) => {
  if (!bg) return
  // bg.src is already a blob URL — safe to use directly in <img> or CSS
})
```

**Why the cast?** This method is not yet in the public SDK types (`ThemesHostAPI`). It exists on the Lumen runtime but is accessed via `as unknown as` until the next SDK minor adds it.

**Why not use `host.fs.read()` yourself?** Module file access (`host.fs`) is sandboxed to the module's own data directory. Reading arbitrary paths from the host filesystem (e.g. theme image files stored under `lumen/files/media/themes/`) will throw `path traversal attempt blocked`. The host reads those files on your behalf and delivers a blob URL.

### `current()` / `list()` / `apply(id)`

`current()` returns the active profile as a `ThemeRef` (id, name, color mode, accent — including the resolved accent hex and the profile language). `list()` returns all profiles. `apply(id)` switches the active profile and propagates to every window.

```ts
const active = host.themes.current()
// { id: 'ministerio', name: 'Ministério', colorMode: 'light', accentId: 'rose', accentHex: '#fb7185', language: 'en' }
```

### `onChange(handler)`

Subscribes to changes of the **active theme** — fires whenever the active profile changes, or when its `colorMode`, `accentId`, or `language` is updated. Fires immediately with the current value on subscription, and returns a `Disposable`.

```ts
const dispose = host.themes.onChange((theme) => {
  // theme: ThemeRef with accentHex + language resolved
  applyMyColors(theme.colorMode, theme.accentHex)
  if (theme.language) setMyTexts(theme.language)
})

// stop listening later:
dispose.dispose()
```

> **Multi-window support**: modules run in the main window, presenter/overlay window, and surface windows — each is a separate JS context with its own profile store. Profile/locale changes are broadcast across windows via the internal Tauri event `profile:changed`, so `onChange` fires consistently in every window (main, presenter, overlay, surface). The callback payload is always the fully resolved `ThemeRef`; React state local to a window is not shared, only the data via this event.

**`ThemeRef` shape:**

```ts
interface ThemeRef {
  id: string
  name: string
  colorMode: 'dark' | 'light'
  accentId: string
  accentHex?: string // resolved from the accent preset
  language?: string  // active profile language (e.g. 'pt-BR')
}
```

---

## `host.menus` ✅

Registers menus and menu items in the application titlebar.

```ts
// Register a full menu
host.menus.register({
  id: 'my-module',
  label: 'My Module',
  priority: 50,          // optional — controls position relative to other menus
  items: [
    { type: 'action', id: 'my-module.open', label: 'Open panel', onClick: () => {} },
    { type: 'separator' },
    { type: 'action', id: 'my-module.settings', label: 'Settings', shortcut: 'Ctrl+,', onClick: () => {} },
  ],
});
```

```ts
// Add an item to an existing menu (e.g. the built-in Modules menu)
host.menus.addItem(
  'modules',
  { type: 'action', id: 'my-module.reload', label: 'Reload My Module', onClick: () => {} },
  10,     // optional priority within the menu
);
```

Both methods return a `Disposable` — the menu or item is automatically removed on module unload.

### `MenuSpec`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique menu identifier |
| `label` | `string` | ✓ | Menu label shown in the titlebar |
| `items` | `MenuItemDef[]` | | Initial items (can be empty) |
| `priority` | `number` | | Order relative to other menus (lower = earlier) |

### `MenuItemAction`

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'action'` | ✓ | Item type |
| `id` | `string` | ✓ | Unique item id (needed for `addItem` / unregistration) |
| `label` | `string` | ✓ | Displayed text |
| `shortcut` | `string` | | Keyboard shortcut hint shown in the menu |
| `onClick` | `() => void` | | Click handler |

### `MenuItemSubmenu`

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'submenu'` | ✓ | Item type |
| `id` | `string` | | Optional identifier |
| `label` | `string` | ✓ | Displayed text (becomes the submenu trigger) |
| `items` | `MenuItemDef[]` | ✓ | Nested items — supports actions, separators, and further submenus |

```ts
host.menus.register({
  id: 'my-module',
  label: 'My Module',
  items: [
    { type: 'action', id: 'my-module.open', label: 'Open Panel', onClick: () => {} },
    {
      type: 'submenu',
      label: 'Export',
      items: [
        { type: 'action', id: 'my-module.export.csv', label: 'As CSV', onClick: () => {} },
        { type: 'action', id: 'my-module.export.json', label: 'As JSON', onClick: () => {} },
      ],
    },
  ],
});
```

### `MenuItemSeparator`

```ts
{ type: 'separator' }
```

### Built-in menu ids

| `menuId` | Menu |
|---|---|
| `'file'` | File |
| `'edit'` | Edit |
| `'view'` | View |
| `'presentation'` | Presentation |
| `'live'` | Live |
| `'modules'` | Modules |
| `'help'` | Help |

---

## `host.queue.registerTrigger`

Registers a queue trigger. Triggers are placed **between** items in the queue and intercept the auto-advance flow — when the item before the trigger finishes playing, the trigger fires before the next item loads.

```ts
import { Timer } from 'lucide-react'

host.queue.registerTrigger({
  id: 'my-module.timer',
  label: 'Countdown Timer',
  icon: Timer,
  ConfigComponent: TimerConfig,
  SummaryComponent: TimerSummary,   // optional — shown inline in the queue item
  defaultConfig: { totalSeconds: 300 },
  onFire(config) {
    startMyTimer(config.totalSeconds)
    // call host.queue.next() when done to advance to the next queue item
  },
})
```

### Auto-advance flow

Triggers intercept the queue's auto-advance — they do **not** fire when the user manually plays an item.

```
[Video A ends] → advanceQueue() finds trigger T between A and B
              → calls T.onFire(config)          ← your module runs
              → queue pauses here
              → module calls host.queue.next()  ← when done
              → advanceQueue() resumes, finds Video B
              → Video B plays
```

The trigger is responsible for calling `host.queue.next()` when it's done — that's what unblocks the queue. Multiple triggers between the same two items fire in order, each waiting for `next()` before the next fires.

### How it works in the app

1. User right-clicks anywhere in the queue panel → context menu shows registered trigger types
2. User selects a trigger type → config dialog opens with `ConfigComponent` rendered
3. User confirms → trigger instance is inserted into the queue as a draggable item
4. Trigger instances can be dragged to any position between queue items
5. Each trigger item has a label toggle (tag icon) — hides or shows the spec label text
6. `SummaryComponent` (if provided) renders inside the item to show config values compactly

### `QueueTriggerSpec<T>`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique identifier (`module-id.name`) |
| `label` | `string` | ✓ | Shown in the context menu and togglable in the queue item |
| `icon` | `ComponentType` | | Lucide or custom icon |
| `ConfigComponent` | `ComponentType<{ value: T; onChange: (v: T) => void }>` | ✓ | Rendered in the config dialog |
| `SummaryComponent` | `ComponentType<{ value: T; onEdit: () => void }>` | | Compact inline display of the config — rendered inside the queue item |
| `defaultConfig` | `T` | ✓ | Initial value for new trigger instances |
| `onFire` | `(config: T) => void` | ✓ | Called when the queue auto-advances past this trigger |

### `SummaryComponent`

When provided, `SummaryComponent` is rendered inside the trigger's queue item instead of (or alongside) the label. Use it to show a compact representation of the current config — e.g. a countdown module showing `"5:00"` instead of `"Wait (Countdown)"`.

```tsx
function TimerSummary({ value, onEdit }: { value: TimerConfig; onEdit: () => void }) {
  const mins = Math.floor(value.totalSeconds / 60)
  const secs = value.totalSeconds % 60
  return (
    <button onClick={onEdit} className="font-mono text-sm text-primary">
      {mins}:{String(secs).padStart(2, '0')}
    </button>
  )
}
```

`onEdit` opens the standard config dialog when called. The summary is display-only by default — clicking it is the recommended way to open the edit dialog from a custom component.

Returns a `Disposable` — registered trigger is removed on module unload.


## `host.queue.registerAction`

Registers a module-only action for programmatic use via `addTrigger`. Unlike `registerTrigger`, actions do **not** appear in the queue panel context menu — only the module itself can create queue instances through `addTrigger`.

Actions serve as pure execution triggers controlled entirely by module code. The operator never sees or configures them.

```ts
host.queue.registerAction({
  id: 'my-module.show-slide',
  onFire(config) {
    host.presentation.project('my-module-slide', { data: config });
  },
})

// Later, from a component or handler:
host.queue.addTrigger?.('my-module.show-slide', {
  slideIndex: 3,
  title: 'Announcements',
})
```

### When to use `registerAction` vs `registerTrigger`

| Use `registerAction` when... | Use `registerTrigger` when... |
|---|---|
| The module decides what and when to add | The operator decides what and when to add |
| Config is pre-determined by module logic | Config must be chosen by the operator (dialog) |
| No operator-facing UI is needed | Full config UI (`ConfigComponent`, `SummaryComponent`) is needed |
| Examples: verse bookmark, quick-slide, auto-generated items | Examples: countdown timer, custom announcement builder |

### `QueueActionSpec<T>`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique identifier (`module-id.name`) |
| `onFire` | `(config: T) => void` | ✓ | Called when the queue auto-advances past this action |

Returns a `Disposable` — registered action is removed on module unload.

### Auto-advance flow

Same as triggers: when the queue auto-advances and encounters an action instance, `onFire` is called with the config passed via `addTrigger`. The action is responsible for calling `host.queue.next()` when done to unblock the queue.

### How trigger entries are resolved

When the queue encounters a `kind: 'trigger'` entry, it looks up the `triggerId` in both `queueTriggerSpecs` and `queueActionSpecs`. If found in either, the corresponding `onFire` is called. This means actions and triggers share the same entry format — the only difference is visibility in the queue panel.


---

## Full example

```ts
import { LumenPlugin } from '@lumen-media/module-sdk';
import type { LumenHost } from '@lumen-media/module-sdk';
import { MainPanel } from './components/MainPanel';

export default class ExamplePlugin extends LumenPlugin {
  async onload(host: LumenHost) {
    // Load persisted state
    const count = await host.data.json.get<number>('count', 0);

    // Register panel
    host.panels.add({
      id: 'example.panel',
      slot: 'sidebar.right.tabs',
      title: 'Example',
      component: MainPanel,
    });

    // Register command
    host.commands.add({
      id: 'example.increment',
      title: 'Example: Increment counter',
      run: async () => {
        const current = await host.data.json.get<number>('count', 0);
        await host.data.json.set('count', current + 1);
        host.ui.notify({ message: `Counter: ${current + 1}` });
        host.bus.emit('example:count', { value: current + 1 });
      },
    });

    // React to app events
    host.bus.on('player:play', (track) => {
      host.log.info('Playback started', track);
    });

    host.log.info('Module loaded', { initialCount: count });
  }

  async onunload() {
    // Cleanup handled automatically — Disposables are disposed on unload
  }
}
```



