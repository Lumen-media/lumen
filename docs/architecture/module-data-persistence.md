# Module Data Persistence

How a module stores its own data: a JSON document, a SQLite database, and a filesystem sandbox. All three are scoped per module id on the Rust side.

Source: `src-tauri/src/module_runtime/mod.rs`
Frontend surface: `src/modules/types.ts` (`DataAPI`, `DataJsonAPI`, `SqliteHandle`, `Migration`, `FsAPI`)

---

## Storage layout

Everything a module persists lives under the app data directory, one directory per module id:

```
<app_data_dir>/modules/
  {moduleId}/
    data.json      ← DataJsonAPI
    data.sqlite    ← SqliteHandle
  catalog.json     ← store cache
  releases/        ← store release cache
  packs/           ← downloaded .lumenpack staging
```

The module's *code* lives elsewhere, under the modules directory managed by the installer. This is data only.

Paths are built by `module_data_json_path`, `module_data_sqlite_path` and `scoped_module_path` in `mod.rs`. All of them `create_dir_all` the module directory on first use, so a module never has to prepare its own storage.

---

## JSON store

| Command | Notes |
|---|---|
| `module_data_json_load` | Reads and parses `data.json` |
| `module_data_json_save` | Overwrites `data.json` with the given value |
| `module_data_json_set` | Reads, mutates one key, writes back |
| `module_data_json_delete` | Removes one key |

`load`/`save` take and return the whole document. `get`/`set`/`delete` on the TypeScript side are thin wrappers over the same file — there is no separate per-key store, so concurrent writes from two code paths in the same module can lose an update. The module owns its own write scheduling.

Exposed as `DataJsonAPI` in `host.data.json`.

---

## SQLite

### Connection cache

```rust
pub struct SqliteConnectionCache {
    connections: Mutex<HashMap<String, rusqlite::Connection>>,
}
```

One open connection per module id, kept for the process lifetime. `with_sqlite_conn` looks the connection up, opening it on first use:

```rust
conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
```

Two pragmas are set on every open:

- `journal_mode=WAL` — readers do not block the writer
- `foreign_keys=ON` — SQLite does **not** enforce foreign keys by default, so without this a module's `REFERENCES` clauses would be silently ignored

`module_data_sqlite_close` removes the entry from the map and drops the connection. Nothing calls it automatically — a module that opens and closes repeatedly pays the reopen cost, and connections for unloaded modules are held until the app exits.

### Serialization

`with_sqlite_conn` holds the `Mutex` for the entire duration of the operation, including the caller's closure. This serializes all database access across every module, not just within one. The comment in the source justifies it: Tauri commands for a single module queue naturally, so there is no concurrent write contention to lose.

The practical consequence is that a long-running query in one module blocks the others. This is fine for the workloads modules actually run (settings and caches, not analytics).

### Migrations

`module_data_sqlite_migrate(versions: Vec<Migration>)` runs against the module's connection:

1. Creates `_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))` if absent
2. For each migration **in the order the caller passed it**, checks whether that `version` is already recorded
3. If not, runs `migration.up` as a batch and records the version

Two consequences worth knowing before writing migrations:

- **Order is the caller's responsibility.** The runtime iterates the array as given; it does not sort by `version`. Passing `[v2, v1]` on a fresh database applies v2 first.
- **A migration is not wrapped in a transaction by the runtime.** `execute_batch` and the `_migrations` insert are two separate statements. If `up` succeeds and the insert fails, the schema change is applied but unrecorded, and the migration will re-run next time. DDL that cannot be repeated idempotently will then fail.

Each `Migration.up` is raw SQL. It may contain multiple statements, since it goes through `execute_batch`.

---

## Filesystem sandbox

`host.fs` is the one API that takes a caller-supplied path, so it is the one that validates. `scoped_module_path` in `mod.rs`:

```rust
let base = app.path().app_data_dir()?.join("modules").join(module_id);
let full = base.join(relative);

if !full.starts_with(&base) {
    return Err("path traversal attempt blocked".into());
}
```

A relative path that would escape the module's directory is rejected. This is a **lexical** `starts_with` check on the joined path, not a `canonicalize` — a path containing `..` that happens to normalize back inside the base is allowed, and one that escapes is caught before any filesystem call.

The four commands are `module_fs_read`, `module_fs_write`, `module_fs_exists`, `module_fs_list` and `module_fs_remove`.

**This check does not apply to pack installation.** The `.lumenpack` extractor in `install.rs` has its own path handling and does not call `scoped_module_path` — see the traversal note in [module-store.md](./module-store.md).

---

## Data isolation

Each module gets a directory keyed by its manifest id, and every path in the three subsystems is built from that id on the Rust side. A module cannot name another module's id in any API it is given: `module_id` comes from the host, not from the frontend call.

The consequence for a module author: the id in `manifest.json` is what determines where data lands, so changing the id orphans the existing data. Uninstalling removes the entry and its data.
