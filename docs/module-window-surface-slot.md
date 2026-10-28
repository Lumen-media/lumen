# Module Window Surface Slot - Usage Guide

> **Status:** implemented. The surface window slot is available for modules.

## Overview

Lumen modules can use the `surface.window` slot to render operator-facing UI in a separate native window.

This surface is meant for workflows that feel like a modal, but need more room or should stay visible while the main Lumen window remains usable. It is not audience-facing output, and it does not replace the presenter/media window.

## Registering a window surface

Register a React component with `host.panels.add()` using `slot: 'surface.window'`.

```ts
host.panels.add({
  id: 'my-module.control-window',
  slot: 'surface.window',
  title: 'Control Window',
  icon: 'monitor',
  component: ControlWindow,
});
```

## Opening a window surface

Open the registered surface from a command, menu item, dialog action, queue trigger, or any other module event.

```ts
host.surface.openWindow(
  'my-module.control-window',
  { mode: 'live' },
 );
```

You can also pass `SurfaceWindowOptions` when opening the window.

```ts
host.surface.openWindow(
  'my-module.control-window',
  { mode: 'live' },
  {
    title: 'Control Window',
    width: 960,
    height: 640,
  },
);
```

### One window per module

Each module gets one active surface window. Opening another `surface.window` panel from the same module should reuse that module's window and replace the active content. Other modules can have their own surface windows open at the same time.

## Window lifecycle

The rendered component receives a `close` callback. Calling it closes only the current module's surface window.

```tsx
function ControlWindow({ close }: { close?: () => void }) {
  return (
    <main className="p-6">
      <button type="button" onClick={close}>
        Close
      </button>
    </main>
  );
}
```

To clear a surface window from the module, use:

```ts
// Close the module's surface window
host.surface.clear();
```

Native window close, `close()`, and `host.surface.clear()` should all clear the module's active surface state.

## State API

```ts
const state = host.surface.state();        // 'idle' | 'live'
const open = host.surface.isWindowOpen();  // boolean

const sub = host.surface.onStateChange((next) => {
  // 'idle' | 'live'
});

host.surface.clear();
```

## Public bus events

Listen for surface lifecycle events from other modules or the host:

```ts
host.bus.on('surface:window-opened', (event) => {
  // event: { moduleId, panelId }
});

host.bus.on('surface:window-closed', (event) => {
  // event: { moduleId, panelId? }
});
```

Use these events for synchronization and cleanup. Do not use them as the primary way to render the window; rendering is controlled by `host.surface.openWindow()`.

## `host.surface`

- `state()` — `'idle'` or `'live'`, whether this module's surface window is open.
- `openWindow(panelId, props?, options?)` — opens or reuses the module's surface window with the given panel.
- `clear()` — closes the module's surface window.
- `isWindowOpen()` — boolean, same as `state() === 'live'`.
- `onStateChange(handler)` — subscribe to open/close transitions scoped to this module.

## `SurfaceWindowOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | panel title | Native window title |
| `width` | `number` | `960` | Initial inner width in logical pixels. Only effective together with `height` |
| `height` | `number` | `640` | Initial inner height in logical pixels. Only effective together with `width` |
| `minWidth` | `number` | `720` | Smallest inner width the window manager allows |
| `minHeight` | `number` | `480` | Smallest inner height the window manager allows |
| `resizable` | `boolean` | `true` | Whether the native window can be resized |
| `decorations` | `boolean` | `true` | Whether OS window decorations are shown |
| `maximized` | `boolean` | `true` without `width`+`height` | Open maximized |
| `fullscreen` | `boolean` | `false` | Open fullscreen |

Omit `width` and `height` (or pass only one) and the window opens maximized, fitted to the OS work area so the taskbar/dock stays visible — it only uses the 960×640 defaults before being maximized. Pass both dimensions for a fixed-size window, and `maximized: false` to opt out of the default maximization. `fullscreen: true` overrides `maximized` even when `width` and `height` are omitted.

## Example: opening a control panel

```ts
host.surface.openWindow('my-module.control-window', { mode: 'live' }, {
  title: 'Control Window',
  width: 960,
  height: 640,
});
```

With both `width` and `height` set, the window opens at that size. Skip them (or send only one) and it opens maximized instead.

## Slot and window context

| Value | Purpose |
|---|---|
| `surface.window` | Module-owned operator-facing native window opened through `host.surface.openWindow(id)` |
| `host.window === 'surface'` | Runtime context inside a surface window |

## Module loading in surface context

Each window runs its own JavaScript context. When a module registers a `surface.window` panel, the module's `onload()` is called separately in each window (main, presenter, surface).

```ts
async onload(host) {
  // host.window === 'main'      → main app window
  // host.window === 'presenter' → presenter/media output window
  // host.window === 'surface'  → this module's surface window

  if (host.window === 'surface') {
    host.panels.add({
      id: 'my-module.surface-panel',
      slot: 'surface.window',
      component: SurfacePanel,
    });
  }
}
```

## Persistence notes

Surface windows reuse the same SQLite database file as the main window. Connections are cached per module and reused across all IPC calls (see SQLite connection caching).

## Recommended defaults

```ts
host.surface.openWindow('my-module.control-window', undefined, {
  title: 'Module Window',
  width: 960,
  height: 640,
});
```

If you do not pass `width` and `height`, the window opens maximized instead of at a fixed size.

## Best practices

- Use `surface.window` for operator-facing module UI.
- Use the overlay surface for separate overlay output.
- Avoid opening multiple surface windows for the same module — reuse the module's single surface window and swap panels instead.
