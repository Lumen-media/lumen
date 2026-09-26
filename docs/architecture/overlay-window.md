# Overlay Window

The overlay is a single shared Tauri window that a module projects one view into. It is separate from the surface windows, which are per-module.

Sources: `src/modules/apis/domain.ts`, `src/app/module-overlay-window.tsx`, `src-tauri/src/main.rs` (`create_overlay_window`)

---

## One window, not one per module

`host.overlay` is created with no arguments — `createOverlayHostAPI()` — and there is exactly one overlay window, labelled `module-overlay-window`. Contrast with `createSurfaceHostAPI(moduleId)`, which creates a window per module (`module-surface-{moduleId}`).

Because the state is a single module-scope pair:

```ts
let overlayViewId: string | undefined;
let overlayProps: unknown;
```

a second `project()` call **replaces** the first. Two modules calling `project()` at the same time contend for the same window; the last caller wins and the other module's view is dropped. Nothing in the API serializes or rejects a competing claim. A module that needs its own window should use `host.surface.openWindow()` instead.

---

## Opening sequence

`ensureOverlayWindow()` in `domain.ts`:

1. `WebviewWindow.getByLabel('module-overlay-window')` — reuse if it already exists
2. Otherwise `invoke('create_overlay_window', { label, title, route: '/module-overlay-window' })`
3. Wait for `module:overlay-ready`, bounded at 8s
4. Re-fetch the handle, `show()`, hide `main`, then apply `maximized`/`fullscreen` from `overlayProps.windowConfig`
5. `syncOverlayProjection()` to push the current view into the fresh window

The Rust command builds the window hidden, at 960x540, min 720x405, offset +80/+80 from the main window, `fullscreen(false)` and `always_on_top(true)`. It returns immediately; the window is shown by step 4.

### Readiness is gated on module boot

`module-overlay-window.tsx` emits `module:overlay-ready` only after `bootPresenterModules()` resolves:

```ts
bootPresenterModules()
  .then(() => emit('module:overlay-ready'))
```

`bootPresenterModules` lists every installed module and boots each one in turn. The ready signal therefore means "all modules are loaded", not "the window is painted". On a cold start with many modules this is slow enough that the wait is load-bearing — a short timeout makes the host race the boot, which is what the `maximized` fix corrected.

### Re-sync

On `module:overlay-ready` the host re-projects immediately and again at 100ms and 400ms. The retries exist because the window's own `listen('module:overlay-project')` registration races the ready emission: if the listener is not bound yet, the first projection is lost. The window has the same listener-registration race, which is why it pushes its own ready only after boot rather than on mount.

These timers fix the **view content**. They do not fix window geometry, which is why a lost `maximize()` is not recovered by them.

### Taking over the screen

While the overlay is up, the main window is hidden. The swap is one-way in the sense that only the overlay drives it: the media window is not involved, since it already opens on the second screen and its own show/hide is driven by `isScreenOpen` in the player store.

`ensureOverlayWindow` hides `main` after showing the overlay, and both exit paths restore it:

- `host.overlay.clear()`
- `module:overlay-window-closed`, emitted by the window's `onCloseRequested`, which covers closing via the titlebar and the `overlay.close` shortcut

`hideMainForOverlay` sets a module-scoped `mainHiddenForOverlay` flag only after `hide()` resolves, so a hide that never landed is not "restored" later, and a main window the user hid themselves is not unhidden. `restoreMainAfterOverlay` clears the flag first, making a second call a no-op — which is what makes it safe to run from both paths, since `clear()` closes the window and triggers the close event too.

Restore does `unminimize()` before `show()` so a maximized main window returns maximized rather than restored-small.

The overlay is still *created* while `main` is visible, because `create_overlay_window` reads `main.outer_position()` to place the overlay and a hidden window does not report its position reliably. The order is: create → show overlay → hide main.

### Always-on-top

`create_overlay_window` sets `always_on_top(true)` on the `WebviewWindowBuilder` chain. Without it the overlay could go behind the main window or any other app, which defeats the point of hiding `main` in the first place.

---

## Window configuration

`windowConfig` travels inside the props of `project(viewId, props)`, not as a separate argument:

```ts
host.overlay.project('player.main', { windowConfig: { maximized: true } })
```

`applyWindowConfig` in `module-overlay-window.tsx` applies, in order: `title`, `decorations`, `resizable`, `size`, `minSize`, then `maximize()` if `maximized` or `fullscreen` is set.

The Rust command accepts no options at all — `create_overlay_window` takes only `label`, `title` and `route`. Every window option is applied from the frontend after creation, which is why the ordering with `show()` matters.

### Maximize ordering

Geometry commands issued against a hidden window are dropped on Windows. The current code has two protections:

- The host calls `show()` **before** maximizing
- `applyWindowConfig` checks `isVisible()` and waits for `tauri://focus`, bounded at 2s, before calling `maximize()`

The 2s bound is deliberate: a window that never receives focus would otherwise hang the event handler indefinitely.

---

## Closing

`host.overlay.clear()`:

- resets `overlayViewId`/`overlayProps`
- emits `overlay:clear` on the bus (for `onStateChange` subscribers)
- emits `module:overlay-clear` so the window drops its presenter state
- restores `main` (see [Taking over the screen](#taking-over-the-screen))

The window also emits `module:overlay-window-closed` from an `onCloseRequested` handler, which the host listens for to reset the same state and restore `main` — so closing via the window's own titlebar button clears the overlay and brings the main window back as well.

`isWindowOpen()` is `presenterViewId !== null`, i.e. it reflects whether a view is projected, not whether the OS window is open. A closed window with no projection reports `false`, which is the useful answer for a module.
