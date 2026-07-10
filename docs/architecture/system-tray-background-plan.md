# System Tray & Background Running — Implementation Plan

## Goal

Allow Lumen to run in the background, hidden from the taskbar, with an icon in the Windows system tray (notification area). All backend services (WebSocket server, module runtime, device management, streaming) must continue functioning normally when no window is visible.

## Why this works

Lumen's architecture already separates **backend services** (Rust) from **UI** (React windows). The critical pieces — WebSocket server on `:8080`, `ModuleRuntime`, device authentication, WebRTC streaming — all live in Rust, spawned during `setup` and independent of any window. Hiding all windows does not stop them.

## Changes Required

### 1. `src-tauri/Cargo.toml`

Add the `tray-icon` feature to the `tauri` dependency:

```toml
tauri = { version = "2", features = ["tray-icon", ...existing features...] }
```

No new crates needed. Tauri v2 has built-in tray support behind this feature flag.

### 2. `src-tauri/tauri.conf.json`

Add a `trayIcon` section pointing to an icon file:

```json
{
  "app": {
    "trayIcon": {
      "iconPath": "icons/icon.ico",
      "iconAsTemplate": true
    },
    "windows": [...]
  }
}
```

The icon already exists at `src-tauri/icons/icon.ico` (used for the app bundle). On macOS, `iconAsTemplate: true` enables automatic dark/light mode adaptation.

### 3. `src-tauri/src/main.rs`

This is where the bulk of the work lives (~50 lines). Three changes:

#### a) Build tray icon and menu (in `setup` hook)

```rust
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder, MenuItemBuilder};

let show = MenuItemBuilder::with_id("show", "Show Lumen").build(&app)?;
let quit = MenuItemBuilder::with_id("quit", "Quit").build(&app)?;
let menu = MenuBuilder::new(&app)
    .item(&show)
    .separator()
    .item(&quit)
    .build()?;

TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .on_menu_event(|app, event| match event.id.as_ref() {
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    })
    .build(&app)?;
```

#### b) Intercept window close → hide to tray

```rust
if let Some(window) = app.get_webview_window("main") {
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = app.save_window_state(StateFlags::all() & !StateFlags::DECORATIONS);
            let _ = window.hide();
        }
    });
}
```

> **Note:** In Tauri v2, `on_window_event` receives `&WebviewWindow`, so `window.hide()` is called on the event target directly. No need to capture `handle` separately.

#### c) Prevent app exit when last window closes

Tauri exits when all windows are closed by default. Since the tray keeps the app alive, this is already handled — the tray is not a window, so the app won't exit until `app.exit(0)` is called explicitly from the Quit menu item. No extra code needed.

#### d) Single-instance compatibility

`tauri-plugin-single-instance` already calls `window.show()` + `set_focus()` in its callback (see `main.rs:299-311`). When the main window is hidden to tray and the user launches Lumen again, it will restore the window automatically. **No changes needed.**

#### e) Window-state plugin — save before hide

`tauri-plugin-window-state` normally saves geometry on window close. Since we now **prevent** close, the plugin won't trigger its save routine. To avoid losing window position/size across restarts, call save explicitly before hiding:

```rust
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

// Inside CloseRequested handler:
api.prevent_close();
let _ = app.save_window_state(StateFlags::all() & !StateFlags::DECORATIONS);
let _ = window.hide();
```

Without this, the main window might reappear at default position after restart if the user never "really" closes it.

### 4. Icon file

Ensure `src-tauri/icons/icon.ico` exists (it already does for the Windows bundle). The tray needs a small icon; 32×32 or 64×64 `.ico` works. On macOS, a 32×32 `.png` is preferred.

### 5. Frontend — No changes required

| System | Why it works in background |
|--------|---------------------------|
| WebSocket server (`:8080`) | Rust-side, independent of windows |
| Module runtime | Rust-side, events emit via `app.emit()` |
| Device auth & streaming | Rust-side, signals dispatch via Tauri events |
| Secondary windows (media, overlay) | Created/shown on demand via `invoke()`, independent of main window visibility |
| Notifications | `tauri-plugin-notification` fires OS-level toasts, no window needed |
| Global shortcuts | `tauri-plugin-global-shortcut` works without windows |

The only frontend consideration: if the main window should show a badge or indicator when background activity occurs (e.g., "device connected"), the Rust backend can emit a `tray:badge` Tauri event that the tray menu or notification handles. This is optional and can be added later.

## Behavior Summary

| Action | Result |
|--------|--------|
| User clicks X (close) on main window | Window hides to tray. App continues running. |
| User clicks tray icon | Main window shows and focuses. |
| User right-clicks tray icon → "Show Lumen" | Main window shows and focuses. |
| User right-clicks tray icon → "Quit" | App exits completely. |
| External device connects via WebSocket | Works normally, backend handles it. |
| Module installs/uninstalls via CLI | Works normally, events emitted. |
| Media playback triggered remotely | Works normally, WebSocket server active. |
| Secondary window already open | Stays open and functional even if main window is hidden. |

## Future Improvements (Post-MVP)

- **Close confirmation dialog**: Instead of silently hiding to tray on X, show a dialog (React custom dialog or a separate Tauri window styled as a native dialog) with "Fechar / Segundo plano / Cancelar".
- **"Minimize to tray on close" setting**: User preference toggle.
- **Tray tooltip**: Show "Now Playing" or connected device count on hover.

## Future Extensions (Out of Scope)

- **Auto-launch on startup**: Add `tauri-plugin-autostart` or manual registry key.
- **Tray notifications**: Show native OS notification when a device connects or media starts.
- **Tray context menu with dynamic items**: Show "Now Playing" or connected device list in tray menu.
- **Badge/overlay on tray icon**: Change icon when streaming or recording.

## Estimated Effort

- **Rust**: ~50 lines in `main.rs`, 1 line in `Cargo.toml`, 5 lines in `tauri.conf.json` — **2–4 hours**
- **Frontend**: 0 lines — **0 hours**
- **Testing**: Close-to-tray, show-from-tray, quit, background socket functionality — **1 hour**
- **Total**: **3–5 hours** for a developer familiar with Tauri
