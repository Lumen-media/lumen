# Module Window Surface Slot - Usage Guide

## Overview

Lumen modules can use the planned `surface.window` slot to render operator-facing UI in a separate native window.

This surface is meant for workflows that feel like a modal, but need more room or should stay visible while the main Lumen window remains usable. It is not audience-facing output, and it does not replace the presenter/media window.

> **Status:** planned contract. Runtime and SDK implementation still need to be added.

## How to use

### Registering a window surface

Register a React component with `host.panels.add()` using `slot: 'surface.window'`.

```tsx
host.panels.add({
  id: 'my-module.control-window',
  slot: 'surface.window',
  title: 'Control Window',
  component: ControlWindow,
});
```

The component is rendered inside the module's own native window when opened through `host.surface.openWindow()`.

### Opening the window

Open the registered surface from a command, menu item, dialog action, queue trigger, or any other module event.

```ts
host.commands.add({
  id: 'my-module.open-control-window',
  title: 'Open control window',
  run: () => {
    host.surface.openWindow(
      'my-module.control-window',
      { mode: 'live' },
      {
        title: 'Control Window',
        width: 960,
        height: 640,
        minWidth: 720,
        minHeight: 480,
        resizable: true,
        decorations: true,
      },
    );
  },
});
```

Each module gets one active surface window. Opening another `surface.window` panel from the same module should reuse that module's window and replace the active content. Other modules can have their own surface windows open at the same time.

### Closing the window

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

The module can also clear the window from host code:

```ts
host.surface.clear();
```

Native window close, `close()`, and `host.surface.clear()` should all clear the module's active surface state.

### Passing props

The second argument to `openWindow()` is passed directly to the registered component.

```ts
host.surface.openWindow('my-module.control-window', {
  title: 'Live controls',
  initialTab: 'timers',
});
```

```tsx
function ControlWindow({
  title,
  initialTab,
  close,
}: {
  title?: string;
  initialTab?: string;
  close?: () => void;
}) {
  return (
    <main className="p-6">
      <h1>{title}</h1>
      <p>Initial tab: {initialTab}</p>
      <button type="button" onClick={close}>Close</button>
    </main>
  );
}
```

### Reacting to state

The planned `host.surface` API mirrors other Lumen output services.

```ts
const state = host.surface.state();
const open = host.surface.isWindowOpen();

const sub = host.surface.onStateChange((next) => {
  host.log.info('Surface state changed', next);
});

sub.dispose();
```

`state()` and `isWindowOpen()` are scoped to the current module.

### Listening to events

Lumen should emit public bus events when a surface window opens or closes.

```ts
host.bus.on('surface:window-opened', (event) => {
  // { moduleId: string, panelId: string }
});

host.bus.on('surface:window-closed', (event) => {
  // { moduleId: string, panelId?: string }
});
```

Use these events for synchronization and cleanup. Do not use them as the primary way to render the window; rendering is controlled by `host.surface.openWindow()`.

## API reference

### `host.surface`

```ts
interface SurfaceHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  openWindow(viewId: string, props?: unknown, options?: SurfaceWindowOptions): void;
  clear(): void;
  isWindowOpen(): boolean;
}
```

### `SurfaceWindowOptions`

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Native window title |
| `width` | `number` | Initial content width |
| `height` | `number` | Initial content height |
| `minWidth` | `number` | Minimum content width |
| `minHeight` | `number` | Minimum content height |
| `resizable` | `boolean` | Whether the native window can be resized |
| `decorations` | `boolean` | Whether OS window decorations are shown |
| `maximized` | `boolean` | Open maximized |
| `fullscreen` | `boolean` | Open fullscreen |

Recommended defaults:

```ts
{
  title: panel.title ?? module.name,
  width: 960,
  height: 640,
  minWidth: 720,
  minHeight: 480,
  resizable: true,
  decorations: true,
  maximized: false,
  fullscreen: false,
}
```

### Slot and window context

| Value | Purpose |
|-------|---------|
| `surface.window` | Slot for module content rendered in a native surface window |
| `host.window === 'surface'` | Runtime context inside a surface window |

## Full example

```tsx
import { LumenPlugin, type LumenHost } from '@lumen-media/module-sdk';

function ControlWindow({
  title,
  close,
}: {
  title?: string;
  close?: () => void;
}) {
  return (
    <main className="p-6">
      <h1>{title ?? 'Module controls'}</h1>
      <button type="button" onClick={close}>
        Close
      </button>
    </main>
  );
}

export default class MyModule extends LumenPlugin {
  async onload(host: LumenHost) {
    const panelId = `${host.meta.id}.control-window`;

    host.panels.add({
      id: panelId,
      slot: 'surface.window',
      title: 'Control Window',
      component: ControlWindow,
    });

    host.commands.add({
      id: `${host.meta.id}.open-control-window`,
      title: 'Open control window',
      run: () => {
        host.surface.openWindow(
          panelId,
          { title: 'Live control' },
          { title: 'Live control', width: 960, height: 640 },
        );
      },
    });
  }
}
```

## Notes

- Use `surface.window` for operator-facing module UI.
- Use `dialog` for small modal flows inside the main Lumen window.
- Use `presenter.content` and `host.presentation` for audience-facing media output.
- Use the overlay surface for separate overlay output.
- Do not call Tauri window APIs directly from modules.
- The v1 contract intentionally exposes a small window option set instead of the full Tauri `WebviewWindow` API.
