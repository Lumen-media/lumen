# Module Window Surface Slot - Architecture

## Overview

The module window surface slot adds a module-owned native window for operator-facing module UI.

It fills the gap between an in-app `dialog` and the existing output windows. A module registers React content in `surface.window`, then asks Lumen to open that content in a separate Tauri window through `host.surface.openWindow()`.

> **Status:** planned contract. Runtime and SDK implementation still need to be added.

## Goals

- Provide a separate native window for module UI that behaves like a larger modal workflow.
- Keep the surface operator-facing, not audience-facing.
- Allow one active surface window per module.
- Allow different modules to keep independent surface windows open at the same time.
- Keep the public API small and stable.
- Avoid exposing raw Tauri window control to module code.

## Non-goals

- Replacing `dialog`.
- Replacing the presenter/media window.
- Replacing the overlay window.
- Supporting multiple surface windows for the same module in v1.
- Exposing the full Tauri `WebviewWindow` API to modules.

## Surface Matrix

| Surface | Slot | Opened by | Purpose |
|---------|------|-----------|---------|
| Dialog | `dialog` | `host.ui.openDialog(id)` | Small modal content inside the main window |
| Presenter | `presenter.content` | `host.presentation.project(id, props)` | Audience-facing media/presenter output |
| Overlay | Existing overlay projection | `host.overlay.project(id, props)` | Separate overlay-style output window |
| Surface window | `surface.window` | `host.surface.openWindow(id, props, options)` | Module-owned operator-facing native window |

The surface window should not reuse `PresenterSlot`. It needs a dedicated renderer so its lifecycle and semantics stay separate from presenter output.

## Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Native window | Tauri `WebviewWindowBuilder` | Creates one window per module |
| Routing | TanStack Router | Dedicated route for the surface window |
| Module runtime | Existing module injector pattern | Loads modules inside the surface context |
| UI rendering | React | Renders the registered `surface.window` panel |
| State | Zustand module store | Tracks active surface panel per module |
| Communication | Tauri events + module bus | Syncs open/close/project state |

## Public Contract

```ts
type SlotName = 'surface.window' | ...;
type LumenWindow = 'main' | 'presenter' | 'surface';

interface SurfaceHostAPI {
  state(): 'idle' | 'live';
  onStateChange(handler: (state: 'idle' | 'live') => void): Disposable;
  openWindow(viewId: string, props?: unknown, options?: SurfaceWindowOptions): void;
  clear(): void;
  isWindowOpen(): boolean;
}

interface SurfaceWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  decorations?: boolean;
  maximized?: boolean;
  fullscreen?: boolean;
}
```

`LumenHost` should expose `surface: SurfaceHostAPI`.

## Ownership Model

Surface ownership is scoped by module id. The module id from `host.meta.id` determines the owner.

Lumen should derive a deterministic native window label from the module id, for example:

```txt
module-surface-window:<module-id>
```

The exact label is an internal implementation detail and should not be part of the SDK contract.

Opening behavior:

- If the module has no surface window, create one.
- If the module already has a surface window, show/focus it.
- If the module opens another `surface.window` panel, replace the active panel in that module's window.
- Surface windows from other modules are unaffected.

Closing behavior:

- Native close clears only that module's surface state.
- `host.surface.clear()` clears only that module's surface state.
- Module unload closes or clears that module's surface window.

## Data Flow

### Opening a surface window

```txt
Module main context
    |
    |-- host.panels.add({ slot: 'surface.window', id, component })
    |
    |-- host.surface.openWindow(id, props, options)
    |
    v
SurfaceHostAPI
    |
    |-- Store active surface state by module id
    |-- Ensure Tauri window exists for module id
    |-- Emit internal surface project event
                |
                v
SurfaceWindow
    |
    |-- boot modules with host.window === 'surface'
    |-- find panel id in slot 'surface.window'
    |-- render component with props + close
```

### Closing a surface window

```txt
User closes native window
    |
    v
SurfaceWindow close handler
    |
    |-- Emit internal close event
    |-- Clear surface state for module id
    |-- Notify host.surface.onStateChange('idle')
    |-- Emit public bus event 'surface:window-closed'
```

## State Model

The module store should track surface state independently from presenter state.

```ts
interface ModuleSurfaceState {
  moduleId: string;
  panelId: string;
  props?: unknown;
  options?: SurfaceWindowOptions;
}
```

Suggested structure:

```ts
Map<string, ModuleSurfaceState>
```

The map key is the module id. This prevents collisions and supports independent windows across modules.

## Tauri Events

Internal event names may change during implementation, but the architecture needs these flows:

| Event | Direction | Payload | Triggered by |
|-------|-----------|---------|--------------|
| `module:surface-ready` | surface -> main | `{ moduleId }` | Surface route booted |
| `module:surface-project` | main -> surface | `{ moduleId, panelId, props }` | `host.surface.openWindow()` |
| `module:surface-clear` | main -> surface | `{ moduleId }` | `host.surface.clear()` or unload |
| `module:surface-window-closed` | surface -> main | `{ moduleId, panelId? }` | Native close |

## Public Bus Events

| Topic | Payload | Description |
|-------|---------|-------------|
| `surface:window-opened` | `{ moduleId, panelId }` | A module surface window became live |
| `surface:window-closed` | `{ moduleId, panelId? }` | A module surface window closed or cleared |

These events are for synchronization and cleanup. Rendering remains controlled by `host.surface.openWindow()`.

## File Structure

### New files

| File | Description |
|------|-------------|
| `src/app/module-surface-window.tsx` | Route/component for module-owned surface windows |
| `src/modules/components/SurfaceWindowSlot.tsx` | Dedicated renderer for `surface.window` panels |

### Modified files

| File | Change |
|------|--------|
| `src/modules/types.ts` | Add `surface.window`, `SurfaceHostAPI`, `SurfaceWindowOptions`, and `surface` on `LumenHost` |
| `src/modules/apis/domain.ts` | Implement `createSurfaceHostAPI()` and surface lifecycle events |
| `src/modules/host.ts` | Add `host.surface` for the main module context |
| `src/modules/presenter-host.ts` | Add safe surface stubs for non-main contexts |
| `src/modules/store.ts` | Track active surface state per module id |
| `src-tauri/src/main.rs` | Add or generalize a command for creating surface windows |
| `src/routeTree.gen.ts` | Regenerated after adding the new route |

## Window Options Policy

The v1 option set should remain intentionally narrow:

- `title`
- `width`
- `height`
- `minWidth`
- `minHeight`
- `resizable`
- `decorations`
- `maximized`
- `fullscreen`

Do not expose position, always-on-top, focus stealing, arbitrary URL loading, devtools control, or raw Tauri window handles in v1.

## Rendering Rules

The surface renderer should:

- Render only panels registered with `slot: 'surface.window'`.
- Wrap module content in `ModuleErrorBoundary`.
- Scope content with `data-module-scope={moduleId}`.
- Pass the original props from `openWindow()`.
- Pass a `close` callback that closes only the current module surface window.

The surface renderer should not:

- Render `presenter.content`.
- Apply presenter backdrops.
- Share presenter state.
- Assume fullscreen media output behavior.

## Failure Handling

- Missing panel id: keep the window stable and render nothing or a minimal module error state.
- Module render crash: use the existing `ModuleErrorBoundary` and module crash accounting.
- Native window creation failure: log through the shell/module logger and fail softly.
- Future API versions may make `openWindow()` return a promise if modules need explicit failure handling.

## SDK Coordination

The SDK must expose the same public contract before third-party modules rely on this surface:

- `surface.window`
- `host.surface`
- `SurfaceHostAPI`
- `SurfaceWindowOptions`
- `LumenWindow = 'main' | 'presenter' | 'surface'`
- `createMockHost()` support for `host.surface`

The app implementation and docs should stay aligned with the SDK contract.

## Implementation Checklist

- [ ] Add `surface.window` to app module types.
- [ ] Add `SurfaceHostAPI` and `SurfaceWindowOptions`.
- [ ] Add `host.surface` in the main host.
- [ ] Add safe `host.surface` stubs in non-main hosts.
- [ ] Add per-module surface state to the module store.
- [ ] Add Tauri surface window creation.
- [ ] Add `/module-surface-window` route.
- [ ] Add `SurfaceWindowSlot`.
- [ ] Wire open, project, ready, clear, and close events.
- [ ] Emit public `surface:window-opened` and `surface:window-closed` bus events.
- [ ] Update `docs/module-api-reference.md`.
- [ ] Update SDK types and SDK README.

## Considerations

- One surface window per module is enough for v1 and keeps cleanup predictable.
- The surface window is operator-facing. Audience-facing content should keep using `host.presentation`.
- The overlay surface remains separate because it has output-window semantics.
- The window label should stay internal so Lumen can change its native implementation later.
