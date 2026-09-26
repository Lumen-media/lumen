# Module Store

How Lumen discovers, downloads and installs modules from the community catalog.

Source: `src-tauri/src/module_runtime/store.rs`, `install.rs`, `manifest.rs`, `registry.rs`
Frontend commands: `src/services/module-store-service.ts` (if present), invoked from the module store UI.

---

## Overview

The store is a thin client over a catalog published on GitHub. There is no server: Lumen reads a static `modules.json`, resolves each module's latest GitHub Release, downloads a `.lumenpack` archive, and installs it through the same path used for sideloading.

```
Lumen
  │
  ├─ GET  raw.githubusercontent.com/.../modules.json     (catalog)
  ├─ GET  api.github.com/repos/{owner}/{repo}/releases    (latest tag)
  ├─ GET  github.com/.../releases/download/{tag}.lumenpack  (pack bytes)
  │
  └─ Installer::install_from_pack()  →  modules/{id}/  +  registry entry
```

---

## Constants

| Name | Value | Purpose |
|---|---|---|
| `CATALOG_URL` | `raw.githubusercontent.com/Lumen-media/community-modules/main/modules.json` | Catalog source |
| `CATALOG_SCHEMA_VERSION` | `1` | Bumped on breaking catalog changes |
| `MAX_PACK_BYTES` | 100 MiB | Hard cap on pack download size |
| `MAX_README_BYTES` | 2 MiB | Hard cap on README fetch |
| `RELEASE_TTL` | 1 hour | Release metadata cache lifetime |
| `DEFAULT_BRANCHES` | `["main", "master"]` | Probed in order for README/manifest |

Defined at the top of `store.rs`.

---

## Commands

All six are `#[tauri::command]`s in `store.rs`.

### `store_fetch_catalog() -> StoreCatalogResponse`

Fetches `CATALOG_URL`, caches the parsed result at `store_dir/catalog.json`, and returns it. On network failure it falls back to the cached copy rather than erroring — the store must open offline.

### `store_get_release(repo, force?) -> StoreReleaseResponse`

Resolves the latest Release for one repository. Cached per-repo at `store_cache_subdir("releases")/{sanitized_repo}.json` with `RELEASE_TTL` (1 hour).

`force: true` bypasses the TTL. The cache is written on successful resolution only, so a failed lookup never poisons the cache.

### `store_download_module(repo, tag) -> String` (path)

Downloads the `.lumenpack` asset for an exact tag and returns the path where it was staged (`store_packs_dir`). Enforces `MAX_PACK_BYTES`.

### `store_install(repo, tag) -> InstalledModule`

Resolves the release, downloads the pack, and runs it through `Installer::install_from_path` with the pack's extension being `.lumenpack`. Returns the resulting `InstalledModule` including the manifest.

### `store_get_readme(repo, branch?, locale?) -> Option<StoreReadmeResponse>`

Fetches a rendered README for the store listing. Probes `DEFAULT_BRANCHES` in order. Bounded by `MAX_README_BYTES`.

### `store_get_manifest(repo, branch?) -> Option<ModuleManifest>`

Returns the `manifest.json` from a repository without installing anything. Used for the store's "about this module" view. Same branch probing as the README.

---

## Repo identifier validation

Every command that accepts a `repo` string runs it through `validate_repo` first:

```rust
let parts: Vec<&str> = repo.split('/').collect();
let ok = parts.len() == 2
    && parts.iter().all(|p| {
        !p.is_empty()
            && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    });
```

Exactly two segments, alphanumeric plus `.` `_` `-`. This is what stops a caller from smuggling a path, a scheme, or extra segments into the GitHub API URLs and cache filenames. `sanitize_repo` performs the same character filter when deriving the on-disk cache filename.

---

## Installation

`install.rs` exposes `Installer`, which holds a reference to the modules directory and the registry.

### `install_from_path(source_path, dev_mode)`

Dispatches on the extension:

- `.lumenpack` → `install_from_pack`
- a directory → `install_from_dir`
- anything else → `Err`, with the message naming both accepted forms

### `install_from_pack(pack_path)`

1. Opens the file as a `ZipArchive`
2. Extracts and validates `manifest.json` **before** writing anything
3. Destroys any existing `modules/{manifest.id}` directory
4. Extracts every archive entry
5. Inserts a `ModuleEntry` into the registry with `source: "sideload"`

The manifest is validated first on purpose: an archive with no valid manifest cannot choose a destination directory, so validation has to gate extraction.

### `install_from_dir(dir, dev_mode)`

With `dev_mode: true` the source directory is used **in place** and no copy is made — the registry points straight at the developer's folder so edits are picked up on reload. Otherwise the tree is copied to `modules/{manifest.id}` and the entry is recorded as `sideload`.

---

## Known gap: pack extraction does not check for path traversal

`install_from_pack` joins each archive entry name onto the destination directory without validating it:

```rust
let out_path = dest.join(file.name());
```

A `.lumenpack` containing an entry such as `../../../../somewhere/else.js` writes outside `modules/{id}/`, and the `create_dir_all(parent)` call will create the intermediate directories it needs.

The per-module filesystem API *does* guard this — `module_fs_*` rejects paths escaping the module root with `path traversal attempt blocked` (see [module-data-persistence.md](./module-data-persistence.md)) — but that check is in a different code path and does not run during pack extraction.

This matters because `store_download_module` and `store_install` fetch and extract packs automatically from a catalog that lives in a community repository. The extraction step should validate that the resolved output path stays inside `dest` before creating or writing anything, mirroring the check in `module_fs_*`.

---

## Registry

`registry.rs` persists one `ModuleEntry` per installed module:

| Field | Meaning |
|---|---|
| `id` | Manifest id |
| `version` | Manifest version |
| `source` | `bundled` \| `store` \| `sideload` \| `dev` |
| `enabled` | Whether the loader should boot it |
| `path` | Absolute path to the module directory |

`source` is what lets the UI distinguish a store install from a local sideload, and is why `install_from_dir` in dev mode records `dev` while a copy records `sideload`.

---

## Failure handling

- Catalog fetch failure falls back to cache; the store still opens offline.
- Release resolution caches only on success.
- A pack that fails manifest validation writes nothing.
- Install errors are returned as `String` to the frontend; the module is not added to the registry, so a failed install leaves no partial entry.
