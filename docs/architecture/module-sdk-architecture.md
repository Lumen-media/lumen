# Module SDK — Architecture Design

## Overview

The Module SDK is the **public contract** for building Lumen modules. It is the typed surface community developers program against, and the typed surface the Lumen app implements. Both sides depend on it; neither side depends on the other.

The SDK lives in a **separate repository** from the Lumen app — `Lumen-media/module-sdk` — and ships as **four independently versioned npm packages** under the `@lumen/` scope. This gives community developers a stable, evolvable contract decoupled from the Lumen app's internal codebase, and gives the Lumen team a single place to coordinate breaking changes.

The separation is deliberate: a community contributor opening a PR against the SDK should not need to clone the Lumen app, run Tauri, or learn the host's internals. The SDK builds and tests with `pnpm` and `tsc` alone. The trade-off — a host-API addition becomes a coordinated two-repo change instead of a single commit — is paid in exchange for that lower contribution barrier.

```
                      ┌──────────────────────────────────┐
                      │   Lumen-media/module-sdk         │
                      │   (npm: @lumen/* packages)       │
                      │                                  │
                      │   - LumenHost interface          │
                      │   - LumenPlugin base class       │
                      │   - Host service types           │
                      │   - Vite build plugin            │
                      │   - CLI binary                   │
                      └─────────┬───────────────┬────────┘
                                │               │
                  import types  │               │  import runtime + build
                                ▼               ▼
        ┌─────────────────────────────┐   ┌─────────────────────────────┐
        │  Lumen app                  │   │  Community module author    │
        │  (Lumen-media/lumen)        │   │  (anyone, anywhere)         │
        │                             │   │                             │
        │  implements LumenHost       │   │  extends LumenPlugin        │
        │  in TypeScript              │   │  uses host APIs by type     │
        │  runs the Injector          │   │  ships .lumenpack           │
        └─────────────────────────────┘   └─────────────────────────────┘
```

This document describes the SDK's own architecture: repo layout, package boundaries, versioning, dev-mode coordination with the Lumen app, and release flow. The **shape** of what the SDK exposes — `LumenHost`, `LumenPlugin`, host service interfaces — is defined in [module-system-architecture.md](./module-system-architecture.md).

---

## Goals & Non-goals

**Goals**
- Single source of truth for the module API contract.
- Independent release cycle from the Lumen app — SDK can ship without an app release, app can ship without an SDK release.
- Stable typed API with semver discipline. The `manifest.api` field on each module references the SDK version it targets.
- Modular install: developers install only the packages they need (runtime types vs build vs CLI).
- Discoverable on npm; documented; example-rich.

**Non-goals**
- Implementing `LumenHost`. The SDK only **declares** the interface; the Lumen app implements it.
- Bundling Tauri or any platform-specific code. The SDK is pure TypeScript / Node.
- Running modules. The Injector lives in the Lumen app, not in the SDK.
- Hosting the community store index. That is `Lumen-media/community-modules`, separate again.

---

## Repo & package layout

The SDK is a pnpm monorepo using **Changesets** for versioning and release coordination.

```
Lumen-media/module-sdk/
├── packages/
│   ├── module-sdk/              → @lumen/module-sdk
│   ├── module-build/            → @lumen/module-build
│   ├── module-cli/              → @lumen/module-cli
│   └── create-module/           → @lumen/create-module
├── examples/
│   ├── minimal/                 — one panel, one command, host.data.json (the "hello world")
│   ├── with-presenter/          — registers in both windows, uses host.bus + host.presentation.project
│   └── with-sqlite/             — host.data.sqlite migrations + a list panel reading from the DB
├── docs/                        — README, guides, API reference
├── .changeset/                  — pending version bumps
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

Each package under `packages/` has its own `package.json`, `tsconfig.json`, build script, and CHANGELOG.md. Releases are independent — a CLI bugfix does not bump the SDK runtime.

Intra-monorepo dependencies use pnpm's `workspace:*` protocol (e.g. `@lumen/module-cli` declares `"@lumen/module-build": "workspace:*"`). When Changesets publishes, the workspace ranges are rewritten to concrete semver ranges in the published `package.json`, so downstream consumers see normal semver dependencies.

---

## Package responsibilities

### `@lumen/module-sdk` — runtime + types

The most-installed package. Pure TypeScript, no platform deps, tree-shakeable.

**Exports**
- `LumenPlugin` base class with `onload(host)` / `onunload()` contract.
- `LumenHost` and every host service interface as types: `PanelSpec`, `CommandSpec`, `QueueHostAPI`, `LyricsHostAPI`, etc.
- `Disposable` type and helpers.
- React hooks that bridge `host.*` services into React reactivity: `useHost`, `useBus`, `useTheme`, `useSetting`, `useQueue`, `useSlideState`.
- `manifest.schema.json` — the canonical JSON Schema for module manifests. Re-exported as both a JSON file and a TypeScript type so that `@lumen/module-build` (build-time validation) and the Lumen app's Rust `module_runtime` (install-time validation) consume the same definition.
- Subpath export `@lumen/module-sdk/testing` with `createMockHost()` and friends, for module authors to unit-test their plugin. Exposed via the package's `exports` field so editors and bundlers resolve subpath types correctly.

**Dependencies** — `react` and `react-dom` as peer dependencies. No runtime deps. For v1 every module is assumed to have at least one UI surface, so the peer-dep is unconditional; a `@lumen/module-sdk/core` split for headless modules is parked under future work.

**Audience** — every module author installs this.

### `@lumen/module-build` — Vite build plugin

Heavyweight; used only at build time.

**Exports**
- Default export: `lumenModule({ manifest })` — a Vite plugin that:
  - Bundles `src/main.ts` into one ESM `main.js`.
  - Externalizes `react`, `react-dom`, `@lumen/ui`, `@lumen/module-sdk` (see Runtime resolution below).
  - Copies `manifest.json`, `styles.css`, `assets/` to `dist/`.
  - Validates the manifest against the JSON Schema (from `@lumen/module-sdk`) at build time.
  - Warns on CSS selectors that are not namespaced under `.lumen-mod-{id}`.
  - Preserves source maps; integrates with hot reload via the dev CLI.

**Dependencies** — `vite`, `esbuild`, JSON schema validator, plus shared schema from `@lumen/module-sdk`.

**Audience** — module authors who use the recommended Vite-based build. Authors with custom build setups can bypass this and implement the same outputs by hand.

**Runtime resolution of externalized packages.** A module's `main.js` references `react`, `react-dom`, `@lumen/ui`, and `@lumen/module-sdk` as bare imports but does not bundle them. At runtime, the Lumen app injects a browser **import map** into the renderer pointing each name to the shell's own copy:

```html
<script type="importmap">
{
  "imports": {
    "react":              "/__lumen/react.js",
    "react-dom":          "/__lumen/react-dom.js",
    "@lumen/ui":          "/__lumen/ui.js",
    "@lumen/module-sdk":  "/__lumen/module-sdk.js"
  }
}
</script>
```

This guarantees every module shares the host's exact React version (no duplicate React causing hook-mismatch errors) and the host's design-system implementation. The `/__lumen/*` paths are served by Rust over the same custom protocol as module assets, scoped to the host's bundled copies. Modules cannot override these imports.

### `@lumen/module-cli` — the `lumen-module` binary

The developer-facing entry point. Installed once per project as a dev dependency.

**Exports** — a `bin` entry exposing `lumen-module` (so `pnpm exec lumen-module …` and `npx lumen-module …` both work):

| Subcommand              | Action                                                                  | Needs running app? |
|-------------------------|-------------------------------------------------------------------------|--------------------|
| `dev [path]`            | Watch a module folder; tell the running Lumen instance to load it; reload on changes | yes (Developer mode on) |
| `build`                 | Run the Vite build with `@lumen/module-build` configured                | no                 |
| `pack`                  | Run `build`, then zip `dist/` into `{id}-{version}.lumenpack`           | no                 |
| `validate [path]`       | Schema-check the manifest, lint CSS namespacing, verify host API usage  | no                 |
| `publish` (future)      | Open a PR against `Lumen-media/community-modules` with the index entry pre-filled | no       |

The build / pack / validate subcommands are standalone — an author who prefers their own editor and manual reload loop never needs to run `dev` or have the Lumen app open.

**Dependencies** — `@lumen/module-build`, file watcher (`chokidar`), HTTP client.

**Audience** — most module authors. Optional: a developer with a fully custom workflow can skip this and run the underlying Vite build directly.

### `@lumen/create-module` — scaffolder

Used once per project via `pnpm create @lumen/module <name>`.

**Exports** — a `create` binary that:
1. Prompts for module id, name, description, author.
2. Copies a starter template (manifest, src/main.ts, src/ui/, vite.config.ts, tsconfig.json, package.json with the right deps).
3. Optionally runs `pnpm install`.

**Dependencies** — minimal, scaffolder-only deps. Not installed into the resulting module.

**Audience** — every author, but only at bootstrap time. After scaffolding, this package is gone from the project.

### Summary table

| Package                  | Size class | Installed by author | When             |
|--------------------------|------------|---------------------|------------------|
| `@lumen/module-sdk`      | small      | always              | runtime + types  |
| `@lumen/module-build`    | medium     | usually             | build time       |
| `@lumen/module-cli`      | medium     | usually             | dev tooling      |
| `@lumen/create-module`   | tiny       | one-shot            | scaffolding only |

---

## Type ownership

The SDK is the **only** place where the `LumenHost` interface and every host service interface is defined. The Lumen app implements those interfaces; community modules consume them.

```
                  @lumen/module-sdk
                  ┌─────────────────────────────────────┐
                  │  export interface LumenHost { ... } │
                  │  export interface QueueHostAPI {...}│
                  │  export class LumenPlugin {...}     │
                  └─────────┬─────────────────┬─────────┘
                            │                 │
            import type     │                 │     import runtime
                            ▼                 ▼
              ┌──────────────────────┐   ┌───────────────────────┐
              │  Lumen app           │   │  Author's module      │
              │                      │   │                       │
              │  class HostImpl      │   │  export default       │
              │    implements        │   │    class extends      │
              │    LumenHost { ... } │   │    LumenPlugin { ... }│
              └──────────────────────┘   └───────────────────────┘
```

Consequences:

- **App and module are decoupled.** They both depend on the SDK, not on each other. The app can refactor its host implementation freely as long as the implemented interface stays compatible.
- **Adding a new host service is a coordinated change.** New interface added in the SDK → new SDK release → app implements → app release ships. Modules can adopt the new API by bumping their SDK peer-dep range.
- **Breaking changes go through the SDK.** If a host service signature changes, the SDK majors; the app and modules align via that major bump.

---

## Versioning discipline

The SDK follows strict semver. The `manifest.api` field on each module references the SDK version range the module targets.

| Change to SDK                                       | Bump   | Effect on existing modules                          |
|-----------------------------------------------------|--------|-----------------------------------------------------|
| New optional method on a host service               | minor  | Compatible — modules ignoring it keep working       |
| New host service                                    | minor  | Compatible — old modules don't depend on it         |
| New hook in `@lumen/module-sdk`                     | minor  | Compatible                                          |
| Adding a required argument to an existing method    | major  | Breaking — modules using that method must update    |
| Removing or renaming any exported type or function  | major  | Breaking                                            |
| Changing the shape of an existing host service      | major  | Breaking                                            |
| Bug fix that does not change types or contracts     | patch  | Always compatible                                   |

The Lumen app declares which SDK majors it supports:

```ts
// in the app
const SUPPORTED_SDK_API = '^1.0.0';
```

The Injector compares each module's `manifest.api` against this range at install time. Mismatches surface as a clear "module requires SDK 2.x, this app supports 1.x" error rather than a runtime crash.

**Living with this discipline.** Adding capabilities is cheap (minor bumps). Removing or restructuring is expensive (major bumps). Bias toward additive changes. Keep deprecated APIs working through at least one full major.

---

## Dev mode — how the CLI talks to the running Lumen app

When a developer runs `pnpm lumen-module dev .`, the CLI is a Node process. The Lumen app is a Tauri process. They need a way to coordinate: "load this module folder, watch for changes, reload on edit."

The chosen mechanism is a **local HTTP server** exposed by the Lumen app in dev mode only. The app binds `127.0.0.1` on a fixed port (default `5179`, configurable). The CLI POSTs to it.

```
┌────────────────────────────┐                  ┌────────────────────────────┐
│  module-cli (Node)         │                  │  Lumen app (Tauri)         │
│                            │                  │                            │
│  pnpm lumen-module dev .   │                  │  binds 127.0.0.1:5179      │
│         │                  │                  │  (dev-mode only)           │
│         ▼                  │  POST /modules   │                            │
│  HTTP client ──────────────┼────────────────► │  module_runtime::install   │
│  watch ./src/**            │   { path,        │    with devMode flag       │
│         │                  │     devMode }    │                            │
│         ▼ file changed     │                  │                            │
│  HTTP client ──────────────┼─POST /modules/   │  Injector unload+reload    │
│                            │       reload     │                            │
└────────────────────────────┘                  └────────────────────────────┘
```

**Endpoints (app-side, dev mode only)**

| Endpoint                      | Action                                                          |
|-------------------------------|-----------------------------------------------------------------|
| `POST /modules`               | Install a module by local path with `devMode: true`             |
| `POST /modules/{id}/reload`   | Unload and reload the module (file-changed signal)              |
| `POST /modules/{id}/disable`  | Disable without uninstalling                                    |
| `DELETE /modules/{id}`        | Uninstall                                                       |
| `GET /modules`                | List installed modules with state                               |

**Security posture for dev mode.** The server only binds `127.0.0.1`. In production builds (the official installed Lumen app) the port is **not** bound by default — the user opts in by toggling **Settings → Developer → Enable developer mode**, after which the endpoint starts accepting connections. Source builds of Lumen (running `pnpm tauri dev`) bind automatically. This means community plugin authors do not need the Lumen source tree to develop — installing the official app and toggling the setting is enough. There is no auth on the loopback endpoint; the trust model is "the developer who toggled the setting is the only one expected to be on this loopback." For shared dev machines, a token can be added later.

**Hot reload semantics.** A reload is an unload + re-import of the module. The plugin instance is destroyed and reconstructed. Anything held in plugin instance state — `useState`, refs, intervals not registered via the host, in-memory caches — is lost. State the module wants preserved across reloads must be written to `host.data.json` before unload (and re-read in `onload`) or routed through `host.bus`. This matches production unload/load semantics; dev mode is intentionally the same path.

---

## Build & release

**Tooling**
- pnpm workspaces for the monorepo
- Changesets for tracking version bumps and changelogs
- TypeScript with `tsc --build` for typed package outputs
- Vitest for unit tests

**Release flow**

```
1. Developer opens PR with a changeset file (.changeset/<name>.md)
   describing the change and intended bump (patch/minor/major).
2. CI runs build + tests across all packages.
3. PR merged into main.
4. Changesets bot opens an automated "Version Packages" PR
   bumping affected versions and updating CHANGELOGs.
5. Merging the Version Packages PR triggers npm publish via CI.
```

This keeps releases deliberate (Version Packages PR is reviewed before publish) and avoids accidental majors.

**Pre-1.0 phase.** While the SDK is `0.x.y`, breaking changes go in minor bumps (per Changesets convention). The first major (`1.0.0`) freezes the API for compatibility guarantees. The Lumen app will not declare third-party support until `1.0.0` ships.

---

## Testing strategy

**Unit tests for SDK internals** — Vitest, run on every PR.

**Mock host for module-author tests.** The `@lumen/module-sdk/testing` subpath exports `createMockHost(overrides)` that returns a fully-typed `LumenHost` with stubbed methods. Module authors write tests like:

```ts
import { createMockHost } from '@lumen/module-sdk/testing';
import RafflePlugin from '../src/main';

test('raffle.draw command emits raffle:draw on bus', async () => {
  const host = createMockHost();
  const plugin = new RafflePlugin();
  await plugin.onload(host);

  host.commands.invoke('raffle.draw');

  expect(host.bus.emit).toHaveBeenCalledWith('raffle:draw', expect.anything());
});
```

**Integration tests against a real app** — out of scope for the SDK repo. The Lumen app's own test suite covers Injector ↔ SDK interaction.

---

## Cross-repo coordination

When the Lumen app needs a new host capability (e.g., a new method on `host.queue`):

```
1. Author proposes the API change in an SDK PR.
2. PR adds the type to @lumen/module-sdk + changeset (minor bump).
3. PR merged → automated Version Packages PR → minor SDK release.
4. Lumen app bumps the @lumen/module-sdk dep in its package.json.
5. App PR implements the new method on HostImpl.
6. App release ships with implementation.
7. Modules wanting the new API set `"api": "^X.Y.0"` in their manifest.
```

When **a module author** needs a new API, they file an SDK issue with the use case. The Lumen team decides whether to add it (and to what surface).

This decoupling means the SDK can lead the app — a new API can land in the SDK before the app implements it — but modules cannot actually use it until both have released. The mismatch is caught by the `api` range check at install time.

---

## Documentation

Initial scope (at first release):

- **Repo README** — overview, install commands, link to architecture doc and examples.
- **Architecture doc** — this file, copied or linked from the repo.
- **Examples directory** — three concrete working modules under `examples/`, kept building in CI.
- **Inline TSDoc** on every exported symbol. Sufficient for editor hover.

Later, when the SDK reaches `1.0.0`:

- A static documentation site (TypeDoc + Astro / Nextra / docs.page) auto-generated from TSDoc and hosted at `docs.lumen.dev/sdk` or similar.
- A "Build your first module" tutorial walking through the scaffold, dev loop, and store publish.

---

## Future work

- **Manifest LSP** — VS Code extension that validates `manifest.json` against the schema in real time and autocompletes contributes/permissions.
- **Codemod migrations between majors.** When the SDK goes `1.x → 2.0`, ship a `lumen-module migrate` codemod that rewrites known breakages.
- **Per-host-service public types.** As more domain services land, consider splitting types out (`@lumen/module-sdk/lyrics`, `@lumen/module-sdk/queue`) for tree-shaking. Only worth doing if bundle sizes show it matters.
- **Plugin telemetry SDK helpers.** When the app gains module observability, the SDK can expose `host.telemetry` helpers (`reportError`, `reportTiming`) on the contract.
- **Marketplace tooling.** A `lumen-module publish` command that handles the GitHub Release + the community-modules PR in one flow.

---

## Open questions

- **Should `@lumen/module-cli` and `@lumen/module-build` merge?** They are tightly coupled — the CLI essentially shells out to the build. Two packages give independent versioning but cost duplication. Revisit after the first six months of real-world use.
- **`@lumen/ui` in module unit tests.** The SDK's `testing` subpath provides a mock `LumenHost`, but mocking `@lumen/ui` components for tests that mount module React is not handled yet. Ship a `@lumen/module-sdk/testing/ui` mock layer (lightweight render-only stubs) when the first module hits the wall in its tests.

---

## Repository checklist (for when implementation begins)

- [ ] Create `Lumen-media/module-sdk` repo
- [ ] Set up pnpm workspace + Changesets + tsc build
- [ ] Scaffold the four packages with stub exports matching the contract in [module-system-architecture.md](./module-system-architecture.md)
- [ ] Wire CI: build, test, lint, type-check across all packages
- [ ] Wire automated publish via Changesets action
- [ ] First `0.1.0` release with type-only `@lumen/module-sdk`
- [ ] Implement `@lumen/module-build` Vite plugin against `0.1.0`
- [ ] Implement `@lumen/module-cli` against the dev-mode HTTP endpoints in the app
- [ ] Implement `@lumen/create-module` with the starter template
- [ ] Three examples building green in CI
- [ ] Public README + link to architecture
