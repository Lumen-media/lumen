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
| `'sidebar.right.tabs'` | Right sidebar tab |
| `'toolbar'` | Toolbar |
| `'statusbar'` | Bottom status bar |
| `'presenter.content'` | Presenter window |
| `'dialog'` | Modal over content |

> ⚠️ No `<PanelSlot>` is placed in the app layout yet. Panels register successfully but are not visually rendered until slots are inserted.

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

### `CommanderAppProps`

| Prop | Type | Description |
|---|---|---|
| `onClose` | `() => void` | Closes the palette entirely |
| `onBack` | `() => void` | Returns to the palette root list |

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
```

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

Fetch wrapper with error handling. Throws on non-OK responses.

```ts
// GET — returns parsed JSON
const data = await host.net.get<{ id: number; title: string }>(
  'https://api.example.com/items/1'
);

// POST — body automatically serialized as JSON
const result = await host.net.post<{ ok: boolean }>(
  'https://api.example.com/items',
  { title: 'New item', priority: 1 }
);

// Extra fetch options (headers, etc.)
const protected = await host.net.get('https://api.example.com/private', {
  headers: { Authorization: 'Bearer token' },
});
```

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

## Domain APIs 🚧

Exposed on the host but still only wired via bus — read methods return empty/default data. Use them only to emit events for now; to react to real app state, prefer `host.bus.on(...)`.

| API | Read methods | Write methods |
|---|---|---|
| `host.lyrics` | `list()` → `[]`, `get()` → `null`, `currentSlide()` → `null` | `advance()`, `back()` emit on bus |
| `host.queue` | `items()` → `[]`, `currentIndex()` → `-1` | `add()`, `remove()`, `reorder()`, `shuffle()`, `markPlayed()` emit on bus |
| `host.library` | `list()` → `[]`, `get()` → `null` | — |
| `host.player` | `current()` → `null`, `state()` → `'idle'`, `volume()` → `1` | `play()`, `pause()`, `seek()`, `next()`, `prev()` emit on bus |
| `host.presentation` | `state()` → `'idle'`, `isWindowOpen()` → `false` | `project()`, `clear()` emit on bus |
| `host.themes` | `current()` → default theme, `list()` → `[default theme]` | `apply()` emits on bus |

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

## Full example

```ts
import { LumenPlugin } from '@lumen/module-sdk';
import type { LumenHost } from '@lumen/module-sdk';
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
    host.log.info('Module unloaded');
  }
}
```
