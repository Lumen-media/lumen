# Module Theme Add API

## Goal

Give Lumen modules a way to register a background image into the app's themes library — the same library the operator populates by downloading images manually in the background picker. A module can hand the host either a remote image URL or a file from its own sandboxed data directory; the host downloads/copies the image into `lumen/files/media/themes/`, inserts a row into the `theme_files` table in `lumen.db`, and returns the persisted metadata.

From the operator's perspective there is no difference: the image shows up in the background picker alongside every other theme, is served through the same `lumen-module://__theme/id/{id}` protocol, and can be deleted through the same UI.

The immediate pressure is modules that ship branded backgrounds or fetch artwork at runtime, but the contract is generic image registration.

## Current State

- The Lumen app repo has an internal `ThemesHostAPI` in `src/modules/types.ts` and implements it in `src/modules/apis/domain.ts`. It is read-only plus apply: `current()`, `list()`, `apply()`, `defaultBackground()`, `onDefaultBackgroundChange()`.
- There is no existing module-facing way to persist a background. The only insertion path is shell-internal (`LyricBackgroundModal.handleDownload`, `lyric-background-modal.tsx`), which does `writeFile` into the themes folder plus `mediaDbService.insertTheme`.
- `host.fs` is sandboxed to the module's own data directory (`scoped_module_path` in `src-tauri/src/module_runtime/mod.rs`), so a module can never write into the shared themes folder by itself.
- The `@lumen-media/module-sdk` repo does not currently expose `addBackground` on `ThemesHostAPI`.

## SDK Coordination

This is a cross-repository change. The Lumen app cannot ship the final `host.themes.addBackground` contract alone because modules compile against `@lumen-media/module-sdk`.

Required SDK work in `Lumen-media/module-sdk`:

- Add `ThemeAddInput`, `ThemeAddResult`, and the `ThemeAddSource` union to the SDK types.
- Add `addBackground(input: ThemeAddInput): Promise<ThemeAddResult>` to `ThemesHostAPI`.
- Update SDK docs and examples so module authors know the API exists.
- Release a new SDK version, then update the Lumen app dependency/contract to match.

Required Lumen app work:

- Update the app's internal module host types to match the SDK (already done in `src/modules/types.ts`).
- Implement `addBackground` through a Tauri command backed by Rust (already done in `src-tauri/src/module_runtime/themes.rs`).
- Keep app docs aligned with the SDK public contract.

## Decision

Make `host.themes.addBackground(input)` the primary public API, implemented through the Tauri command `module_theme_add`.

```txt
module code
  -> host.themes.addBackground({ source })
  -> Tauri invoke (module_theme_add)
  -> Rust resolves + downloads/copies the image bytes
  -> Rust writes the file into lumen/files/media/themes/
  -> Rust inserts a row into theme_files (lumen.db)
  -> Rust returns { id, name, path, extension } to the module
```

The shell's own Unsplash download flow (`LyricBackgroundModal`) and this API converge on the same storage layout, so both produce identical rows in `theme_files`.

## Design Principles

- Operator-identical: the resulting file + DB row must be indistinguishable from a manual download.
- Sandbox-respecting: file sources resolve inside the module's own data dir only; path traversal is blocked at the Rust boundary.
- Permission-respecting: URL sources are validated against the module manifest `permissions.network` allowlist before any network call.
- Safe by default: HTTPS only, private hosts blocked, size capped, only known image types accepted.
- Deterministic naming: sanitized names plus a numeric suffix to avoid collisions; no overwrites of unrelated files.
- Idempotent: re-registering the same path overwrites the file and reuses the existing row.

## SDK Shape

```ts
export type ThemeAddSource =
  | { type: 'url'; url: string }
  | { type: 'file'; path: string };

export interface ThemeAddInput {
  source: ThemeAddSource;
  name?: string;
}

export interface ThemeAddResult {
  id: number;
  name: string;
  path: string;
  extension: string;
}

interface ThemesHostAPI {
  // ...
  addBackground(input: ThemeAddInput): Promise<ThemeAddResult>;
}
```

## Behavior

### URL source

```ts
const theme = await host.themes.addBackground({
  source: { type: 'url', url: 'https://example.com/artwork.jpg' },
  name: 'My Background',
});
```

- The manifest's `permissions.network` allowlist is enforced with the same rules as `host.net.request` (`check_url_allowed` in `src-tauri/src/module_runtime/net.rs`).
- The extension is derived from the response `Content-Type` when possible, otherwise from the URL path, otherwise defaults to `.jpg`.
- The response must be a known image type and is capped at 50 MB.

### File source

```ts
const theme = await host.themes.addBackground({
  source: { type: 'file', path: 'assets/background.png' },
});
```

- `path` is resolved with `scoped_module_path` against the module's own data directory (same scoping as `host.fs`).
- The extension is derived from the file name.

### Naming

- `name` is optional. When omitted, the stem is derived from the URL path or the file name.
- Filename-unsafe characters are sanitized, and trailing dots/spaces are stripped.
- If the destination already exists on disk, a suffix is appended (`name (1)`, `name (2)`, …).
- If a `theme_files` row already references the destination path, the file is overwritten and the existing row is reused (idempotent).

### Supported types

`gif`, `jpg`, `jpeg`, `png`, `webp`, `svg`, `bmp`, `avif`. Anything else fails with `unsupported image type`.

## Security

- File sources cannot escape the module sandbox (`scoped_module_path`).
- URL sources are validated against `permissions.network`; localhost, loopback, link-local and private IP hosts are blocked; only `https` is allowed.
- Image size is capped at 50 MB.
- Only known image extensions/types are accepted, so the themes folder cannot be used to plant arbitrary executables or content.
- The theme serving protocol (`handle_theme_request` in `protocol.rs`) already canonicalizes paths and refuses anything outside the themes folder.

## Rust Implementation Sketch

`src-tauri/src/module_runtime/themes.rs` exposes:

```rust
#[tauri::command]
pub async fn module_theme_add(
    app: AppHandle,
    module_id: String,
    input: ModuleThemeAddInput,
) -> Result<ModuleThemeAddResult, String>
```

Implementation pieces:

- `ModuleThemeSource` / `ModuleThemeAddInput` / `ModuleThemeAddResult` serde types.
- Module registry lookup + enabled check.
- `check_url_allowed` reuse from `net.rs` for URL sources.
- Shared `reqwest::Client` from `ModuleRuntime` for downloads.
- `scoped_module_path` reuse for file sources.
- MIME/extension resolution, filename sanitization, collision-free destination pick.
- Write to `{base}/files/media/themes/`, then `INSERT OR IGNORE` into `theme_files`, then `SELECT id` back by path.
- Shared `app_base_dir()` helper in `module_runtime/mod.rs` (also used by `protocol.rs`).

## Error Model

`addBackground` rejects with a plain string error when:

- the module is not found or not enabled;
- the URL fails permission checks or is not HTTPS/private-host-safe;
- the download fails or returns a non-2xx status;
- the response exceeds the size cap or is not a known image type;
- the file source escapes the module sandbox or does not exist;
- the file cannot be written or the DB row cannot be inserted.

## Examples

```ts
import { LumenPlugin, type LumenHost } from '@lumen/module-sdk';

export default class Backgrounds extends LumenPlugin {
  async onload(host: LumenHost) {
    const theme = await host.themes.addBackground({
      source: { type: 'url', url: 'https://example.com/artwork.jpg' },
      name: 'Artwork',
    });
    host.log.info('registered background', theme.id, theme.name);
  }
}
```

## Open Questions

- Should a future `apply(id | path)` setter let modules switch the active background directly, or should that remain an operator action in the picker?
- Should `addBackground` accept raw bytes as a third source type, or is `file` (write via `host.fs` first) enough?
- Should registration notify an event bus topic so other windows can refresh their themes list immediately?

## Implementation Checklist

- [x] Add `addBackground` to the app's `ThemesHostAPI` (`src/modules/types.ts`).
- [x] Implement `module_theme_add` Rust command (`src-tauri/src/module_runtime/themes.rs`).
- [x] Register the command in `src-tauri/src/main.rs` invoke handler.
- [x] Add `addBackground` to the dev-mode SDK stub (`scripts/vite-plugin-lumen-host-modules.ts`).
- [x] Document the app-side contract in `docs/module-api-reference.md`.
- [ ] Promote `ThemeAddInput` / `ThemeAddResult` / `addBackground` into `@lumen-media/module-sdk`.
- [ ] Add Rust unit tests for scoped path rejection, size cap, and naming collisions.