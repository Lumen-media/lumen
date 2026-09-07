# Keyboard Shortcuts — Architecture

> **Status: implemented** — the central registry, titlebar menu wiring, scoped registration and the read-only reference sheet are shipped. **User-customizable key bindings** are a future proposal (see [Future Work](#future-work--user-customizable-key-bindings)) — not implemented.

## Overview

Lumen's keyboard shortcuts are centralized into a single registry powered by **TanStack Hotkeys** (`@tanstack/react-hotkeys`, alpha `^0.10.0`). The registry is the single source of truth for:

- Titlebar menu shortcut hints and their actual key bindings (they can never diverge).
- Global and window/route-scoped shortcut registration.
- A read-only "Keyboard Shortcuts" reference sheet that auto-populates from the registry.

This doc describes the current architecture and the plan to let users **customize their own key bindings**, persisted in the app config and loaded when each webview opens.

## Architecture (implemented)

### Registry — single source of truth

`src/lib/shortcuts/`:

| File | Responsibility |
|---|---|
| `default-shortcuts.ts` | `SHORTCUTS: ShortcutDefinition[]` — all shortcut definitions |
| `types.ts` | `ShortcutScope`, `ShortcutGate`, `ShortcutDefinition`, `HotkeyMeta` augmentation (`group`) |
| `useScopedShortcuts.ts` | The single registration mechanism — registers definitions for any scope (`global`, window/route); actions injected by the owning component, `def.enabled` gates evaluated via `gates` |
| `utils.ts` | `formatShortcutForDisplay`, `hotkeyDisplayTokens`, `isMacPlatform`, `menuShortcut`, `shortcutAction` |
| `index.ts` | Barrel export |

`ShortcutDefinition`:

```ts
{
  id: string
  keys: Hotkey[]            // TanStack format, e.g. 'Mod+N', 'F5', 'ArrowRight'
  name: string              // display label (also used as i18n key)
  description?: string
  group: string             // File, Edit, Presentation, App, Help, Editor, Media, Overlay
  scope: ShortcutScope      // global | editor | media-window | overlay-window | markdown-presentation
  enabled?: boolean | ((gates: ShortcutGate) => boolean)
  action?: () => void
}
```

### Registration model

Single mechanism — `useScopedShortcuts(scope, actions?, options?, gates?)` registers all definitions for a scope. There is no separate global registrar abstraction.

- **Global** — `useScopedShortcuts('global', ...)` called directly in the main window root (`__root.tsx`, non-auxiliary windows only) via a thin `ShortcutRegistrar` mount; it computes the presenter gate (`lyricPath || imagePath || presenterViewId || presentationActive`) from stores and passes it as `gates`.
- **Scoped** — `useScopedShortcuts(scope, actions, options)` registers definitions for one window/route; the owning component injects the actions. Used by `media-window`, `module-overlay-window`, the editor (`/edit`), and `markdown-presentation`. Mutual exclusion is handled via `conflictBehavior: 'allow'` + `enabled` gates.
- All registrations carry `meta` (`name`, `description`, `group`) so the manager/devtools can feed a shortcuts dialog.

### Consumers

- **Titlebar menus** (`titlebar/default-menus.ts`) resolve hints and actions from the registry via `menuShortcut(id)` / `shortcutAction(id)` — click and keypress always trigger the same action.
- **Sheet** (`components/shortcuts-sheet.tsx`) maps `SHORTCUTS` into grouped sections, rendering each key as individual `Kbd` chips (OS-adapted: `Ctrl+K` on Windows, `⌘K` on macOS) with `or` between alternatives.
- **Long menu labels** (e.g. "New Presentation") show their shortcut in a styled base-ui `Tooltip` instead of an inline hint that wraps (`DropdownMenuItem` handles `title` the same way `Button` does).
- **i18n** — all labels pass through `t()`; en + pt translations live in `src/locales/{en,pt}/translation.json`. Display of keys is OS-adapted (`Mod` → Command on macOS, Ctrl elsewhere) via `formatForDisplay`.

### Current shortcut inventory

| Group | Shortcuts |
|---|---|
| File | New Presentation `Mod+N`, Open `Mod+O` |
| Edit | Undo/Redo/Cut/Copy/Paste/Select All — **registered but disabled** (`enabled: false`), native clipboard/undo preserved |
| Presentation | Start `F5`, Stop `Esc`, Next/Prev Slide `→`/`←` (gated on active presenter) |
| Presenter toggles | Wallpaper `F8`, Lyrics `F9`, Blackout `F10` (emit Tauri events consumed by the media window) |
| App | Command Palette `Mod+K`, Open Chat `Mod+Shift+C` |
| Live | Unbound (listed for the future dialog) |
| Help | Keyboard Shortcuts `Mod+Shift+K` (opens the sheet) |
| Editor (scoped) | Select Next/Prev Slide `↓`/`↑`, `→`/`←` |
| Media window (scoped) | Fullscreen `F11`, Wallpaper `F8`, Lyrics `F9`, Blackout `F10`, Exit `Esc`, slide navigation |
| Overlay (scoped) | Fullscreen `F11`, Close `Esc` |
| Markdown (scoped) | Slide navigation |

## Future Work — User-Customizable Key Bindings

> Not implemented. Proposal — the checkboxes below are unchecked on purpose.

### Goal

Let users rebind keys per shortcut (edit in the sheet or a settings section), with conflict detection and a reset-to-default. The registry was designed for this: menus, hints, and the sheet already derive from it, so rebinding updates every consumer reactively.

### Persistence — app config (Rust)

Single source of truth **shared by all windows**, unlike `localStorage` (per-webview JS contexts):

- New `config/shortcuts.json` alongside `streaming.json` (`src-tauri/src/streaming/config.rs` pattern).
- Shape: `{ "version": 1, "overrides": { "<shortcutId>": ["Mod+O"] } }` — keys stored in TanStack format; OS display (`Ctrl`/`⌘`) is derived at render time.
- Commands mirroring the streaming config pattern: `get_shortcut_overrides` (boot) and `update_shortcut_overrides` (commit from the edit UI).

### Hydration timing (key decision)

Shortcut hooks register on mount, so overrides must be available before (or reconciled right after) registration:

- Preferred: turn the static `SHORTCUTS` array into a **zustand store** that hydrates async from config; `useHotkeys` re-registers when keys change (the library reconciles by index + normalized hotkey).
- Alternative: the root awaits `get_shortcut_overrides` before mounting the shortcut components.
- Each window (main, media, overlay) fetches the same file at boot — no divergence.

### Recorder & validation (library-provided)

- `useHotkeyRecorder()` / `useHotkeySequenceRecorder()` for the capture UI (record, cancel).
- `validateHotkey()` + `HotkeyManager.isRegistered()` for duplicate/conflict detection.
- Always keep at least one key per action; reject empty bindings.

## Phased Roadmap

### Phase 1 — Dynamic registry
> No behavior change. Prepares the seam.

- [ ] `SHORTCUTS` static array → zustand `shortcuts-store` (definitions + `overrides` map).
- [ ] `menuShortcut`/`shortcutAction`, `useScopedShortcuts` and the sheet read from the store.
- [ ] `getKeys(id)` applies the override; consumers react to changes.

### Phase 2 — Config persistence
> Single source of truth in Rust, loaded on webview boot.

- [ ] `ShortcutConfig` (version + overrides) + `load`/`save` (`config/shortcuts.json`).
- [ ] `get_shortcut_overrides` / `update_shortcut_overrides` commands.
- [ ] Async hydration of the shortcuts store in the main window and auxiliary windows.

### Phase 3 — Edit UI
> The user-facing rebinding surface.

- [ ] Edit mode in the sheet (or settings section): list → record → save/reset.
- [ ] Conflict detection and empty-binding rejection.
- [ ] Reset single + reset all; versioned schema for future migrations.

## Verification

1. Rebind `Mod+N` → other keys: menu hint and sheet update immediately.
2. Rebind survives a restart; applies in the media window too (same config file).
3. Assigning an already-used key is blocked with a warning.
4. Reset restores defaults.
5. After restart, overrides are applied before the first keypress.

## Risks

- **TanStack Hotkeys alpha**: the recorder API may change between versions — pin the version.
- **Per-window JS contexts**: each window must hydrate from the same config file.
- **Disabled stubs** (Edit menu) are excluded from customization (no action).
- **Scoped shortcuts** edited from the main window must keep their scope mapping.
- **Binding validity**: reject invalid/duplicate keys; keep at least one key per action.