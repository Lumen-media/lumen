# Store — Architecture Design

## Overview

The **store** is the first-class, end-user-facing way to discover, install, update, and uninstall Lumen modules. Unlike the developer-facing surfaces (sideload and dev mode), the store is built for **non-developers**: it ships as an **app inside the Commander** (the command palette), Raycast-style — the user opens the Commander, picks "Store", and lands in a full catalog of modules with search, tag filters, per-module detail pages, and one-click install/update.

The store reuses the exact installation and runtime plumbing that already exist: `module_runtime` validates, extracts, and registers `.lumenpack` bundles; the Injector hot-activates modules without a restart. The store adds the **catalog layer** on top — where module metadata comes from, how the app learns about new versions, and how the user-facing UI is structured.

The distribution model is **GitHub-decentralized**, as documented in [module-system-architecture.md](./module-system-architecture.md):

- Lumen hosts an **index** (the catalog) — a single `modules.json` in a public repo, `Lumen-media/community-modules`.
- Each module's executable `.lumenpack` lives on the **author's own GitHub repo**, attached to a GitHub Release.
- The Lumen app fetches the index, renders the catalog, and downloads a module's `.lumenpack` straight from the author's latest release.

This keeps the Lumen team's hosting footprint at **zero** (one public repo is the entire backend), lets authors own their own distribution, and uses GitHub Releases for versioning and asset hosting — the same model Obsidian uses at scale.

```
┌────────────────────────────────────────┐      ┌──────────────────────────────────┐
│  Lumen-media/community-modules        │      │  Author's GitHub repo           │
│  (source of truth for the catalog)    │      │  github.com/<author>/<repo>     │
│  modules.json          ──────────────►│      │                                  │
│  verifies + reviews each entry        │      │  Releases:                      │
│                                        │      │   v1.0.0 → raffle-1.0.0.lumenpack
│                                        │      │   v1.1.0 → raffle-1.1.0.lumenpack
└───────────────┬────────────────────────┘      └──────────────┬───────────────────┘
                │ fetched as raw                              │ fetched via
                │ (raw.githubusercontent.com)                 │ GitHub Releases API
                ▼                                             ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                        Lumen app                            │
        │  Store app inside the Commander                              │
        │   (open palette → "Store" → full catalog view)               │
        │   · reads modules.json → renders catalog as app pages        │
        │   · Install  → download .lumenpack → module_install         │
        │   · Update   → compare versions → re-download + reinstall   │
        │   · Manage installed → enable/disable/uninstall (local)     │
        └──────────────────────────────────────────────────────────────┘
```

---

## Goals & Non-goals

**Goals**
- A safe, easy install path for non-developer end users (no CLI, no manual files).
- Browsable catalog with search, categories/tags, and a per-module detail page.
- One-click install, update, enable/disable, and uninstall — all without restarting the app.
- Reuse `module_runtime` + the Injector exactly as-is; add only the catalog + UI layer.
- Transparent trust: the app clearly flags that store modules are community-vetted via the moderated index.
- Robust to network failure and GitHub's rate limits (cache metadata, graceful degradation).

**Non-goals**
- Hosting module binaries (authors do that on their own GitHub Releases).
- A backend API server, accounts, payments, or ratings at this stage (the index repo is the single point of truth; moderation is PR review).
- Sandboxed/Worker isolation for store modules in v1. Store modules run in the same context as sideloaded ones; trust is granted by the moderated index review. Worker isolation remains a future tier (see [module-system-architecture.md](./module-system-architecture.md), "Future work").
- Bundling modules into the installer (modules ship via the store at runtime).
- Native code inside modules (privileged work stays behind `host.*`).

---

## The index repository — `Lumen-media/community-modules`

The catalog is a single public repo that the app treats as an immutable, versioned artifact. The repo's primary content is `modules.json` plus the assets needed to render a rich catalog.

```
Lumen-media/community-modules/
├── modules.json            ← the catalog (single source of truth)
├── schema.json             ← JSON Schema for modules.json (used by CI + app)
├── icons/
│   └── <id>/icon.svg       ← icon assets referenced by the catalog
├── covers/
│   └── <id>/cover.png      ← optional hero/cover images for detail pages
├── README.md               ← contribution guide for authors
└── CONTRIBUTING.md         ← how to add/update an entry (submit a PR)
```

### `modules.json` schema (v1)

Every entry is deliberately **metadata only** — no module bytes. Each entry identifies the **author's repo**; the app fetches the actual `.lumenpack` from that repo's latest release.

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-01-15T10:00:00Z",
  "modules": [
    {
      // must equal the module's own manifest.id (reverse-DNS, globally unique)
      "id": "com.example.raffle",

      // display metadata
      "name": "Raffle",
      "tagline": "Quick draws and giveaways during live events.",
      "description": "Longer markdown description shown on the detail page.",
      "tags": ["utility", "engagement"],
      "author": { "name": "Gabriel Santos", "url": "https://github.com/gabrielSantos1101" },
      "license": "MIT",

      // where to fetch the executable artifact
      "repo": "gabrielSantos1101/lumen-raffle",

      // catalog assets (optional; omitted → the app shows generated placeholders)
      "icon": "icons/com.example.raffle/icon.svg",
      "cover": "covers/com.example.raffle/cover.png",

      // first-party / Lumen-verified badge (optional; reviewed during the PR)
      "lumenVerified": true,

      // no readme field here — the detail page always renders the author's repo
      // README (README.md + README.<locale>.md variants), see "Localized READMEs".

      // admission
      "status": "approved",
      "approvedAt": "2026-01-10T00:00:00Z"
    }
  ]
}
```

**Field rules**
- `id` must match the module's `manifest.json` `id`. CI enforces this by fetching the author's release manifest during review.
- `schemaVersion` lets the app reject catalogs it doesn't understand instead of mis-rendering.
- `status` is reserved for future moderation states (`approved` is the only value at v1; `removed`/`deprecated` land later). For v1, entries present in the file are approved.
- `repo` is the only field the app uses to talk to GitHub's API.
- `lumenVerified` is an optional bool granted by the Lumen team during review — it renders a "Verified by Lumen" badge in the list and detail views. It does not grant extra permissions; it is purely a trust signal on top of the moderated index.

### Serving + versioning

- The app fetches `https://raw.githubusercontent.com/Lumen-media/community-modules/main/modules.json`.
- **`main` is mutable, which is fine for v1** because the catalog is small and non-critical; the app treats a fresh fetch as authoritative and patches its local cache. A pinned immutable index (a tag like `v1-b837a2`) can be introduced later if distribution integrity ever needs offline pinning. The author-facing PR review is the real gate, not byte-pinning.

---

## App-side catalog client

The store talks to **four** remote endpoints; everything else is local. All remote reads go through the Rust side via Tauri commands so the app controls timeouts, redirects, size caps, and caching — never a raw browser `fetch` from the renderer.

| What | URL | Used for |
|------|-----|----------|
| Catalog index | `raw.githubusercontent.com/Lumen-media/community-modules/main/modules.json` | Browse, search, tags, versions info |
| Latest release | `api.github.com/repos/<owner>/<repo>/releases/latest` | Resolve the newest `.lumenpack` asset URL for install/update |
| Module asset | `github.com/<owner>/<repo>/releases/download/<tag>/<file>.lumenpack` | Download the executable bundle |
| Module README | `raw.githubusercontent.com/<owner>/<repo>/<branch>/README.md` (+ `README.<locale>.md` variants) | Render the detail page description (author repo root convention) |
| Counters + votes — **deferred** | `lumen.dev/counts` (or similar serverless service) | Per-module download counts, likes and dislikes shown in the catalog |

### `module_runtime` commands to add

The existing runtime has `module_install(path, dev_mode)`, `module_list_installed`, `module_get`, `module_enable`, `module_disable`, `module_uninstall`. The store needs a small set of **network-facing** commands in a new `store.rs` under `module_runtime/`:

| Command | Purpose |
|---------|---------|
| `store_fetch_catalog()` | Fetch + cache `modules.json`, returning the parsed list |
| `store_get_release(repo)` | Resolve the latest GitHub release for a repo (cached, rate-limit aware) |
| `store_download_module(asset_url, dest_dir)` | Download a `.lumenpack` to a staging dir, size-capped |
| `store_install(repo, tag)` | Download the asset for the given tag and install it via the existing `Installer` |
| `store_get_readme(repo, branch, locale)` | Probe + fetch `README.<locale>.md` (falling back to `README.md`) from the author's repo root via raw.githubusercontent.com; cached |

> Store downloads are **first-class commands**, not re-uses of `host.net` from a module. A store downloader must be allowed to read the whole `.lumenpack` before `Installer` validates it; routing it through the module permission system (which blocks private hosts and requires an allowlist) is the wrong tool. The store commands are host-granted and independent of any module's permissions.

### Install / update flow (host-granted, not module-granted)

The keys point to a subtlety that matters for security: **the store is host code, not module code.** Store commands do **not** pass through `check_url_allowed` (that's enforced only on `host.net` when a *module* makes requests). The host restricts store commands by:

1. Only accepting `https` URLs.
2. Only ever downloading from the author repo + asset name **discovered from the fetched catalog**, not from an arbitrary caller-supplied URL. A malicious renderer string cannot inject a URL to `store_download_module`.
3. Enforcing a size cap (default 100 MB) on `.lumenpack` downloads.

```
install(repo, tag):
  1. catalog  = store_fetch_catalog()            // cached
  2. entry    = catalog.byRepo[repo]             // must exist & be approved
  3. release  = store_get_release(repo)          // cached, TTL 1h
  4. asset    = release.assetNamed(entry.id + '.lumenpack')
                 or release.assetNamed('<id>-<version>.lumenpack')
                 // matches the InstalledModule.manifest.id, NOT caller input
  5. pack     = store_download_module(asset.url, staging)
  6. module_install(pack)                        // existing Installer: validate + extract + register
  7. emit 'module:installed'                     // Injector hot-activates
```

**Update** is the same flow with `tag` resolved to "latest" and a pre-check that `release.tag` semver `>` the installed version. **Reinstall over an existing id** is handled by `Installer`, which already removes the existing dir before extracting — no changes needed there.

### Update checks

Two triggers, both rate-limit-safe:

- **On demand**: user clicks "Check for updates" — bypasses cache, checks every store-installed module.
- **Background**: on app start and every ~6h, staggered per module, using cached release data (TTL 1h).

When a newer version exists, the entry surfaces **"Update available"** with a one-click update. Modules whose `id` disappeared from the catalog keep running but stop receiving updates and show **"No longer in store"**.

### GitHub rate limits

GitHub unauthenticated API caps at **60 requests/hour/IP**; releases API calls are the main consumer. Mitigations (mirroring [module-system-architecture.md](./module-system-architecture.md)):

- Cache release metadata locally with TTL (default **1 hour**).
- Background checks run slowly and staggered, never in a burst.
- An optional GitHub **personal access token** field in settings raises the limit to 5000/h (never required).
- "Check for updates" (explicit user action) always bypasses the cache.

### Counters & votes — **deferred, not part of the current scope**

The catalog shows two kinds of **community signal** per module: download counts and **likes/dislikes**. GitHub does **not** expose download counts for release assets (removed from the API long ago) and has no voting surface for releases, so both have to come from our own source. The chosen approach is one **minimal serverless service** (Option A, decided):

- A tiny endpoint (Cloudflare Worker / Vercel function is enough) with:
  - `POST /counts/+1 { id }` — called by the Lumen app once per successful store install.
  - `GET /counts` — returns `{ id: { downloads, up, down }, … }`, merged into the catalog read by the app.
  - `POST /votes { id, dir: 'up' | 'down' | null, voterHash }` — vote like (up), dislike (down), or `null` to clear.
- **Voting identity.** The app generates a single anonymous per-install id (random UUID, stored locally — never an account, never tied to GitHub). The server hashes it and enforces **one vote per module per app install**; the same hash lets the user switch (up → down, or clear). Best-effort anti-abuse at v1 (per-hash cap + rate limit); it is not bot-proof and is documented as such.
- **Toggling.** A user can vote, change their mind, or retract their vote; the UI reflects the user's current state from a local cache of `{ id: voterHash, dir }`.
- Privacy by design: **no user data, no timestamps, no IP-derived identity** — only opaque aggregate numbers plus a hashed, revocable-per-app vote marker.
- The index repo remains the source of truth for the catalog; the counters/votes are aggregates the app fetches alongside it.

> **Status: deferred.** Registered in the architecture so the design is complete, but **intentionally not built now** (decision 2026). The store ships without download counts and without voting; the UI simply hides those columns cleanly. Both can be added later without touching the catalog schema or the install flow — only the `store_fetch_catalog` response gains `downloads` / `up` / `down` fields.

---

## Local catalog & metadata store

The app keeps a compact, offline-friendly cache in `{app_data}/lumen/` so the store renders instantly and degrades gracefully offline.

```
{app_data}/lumen/
├── catalog.json                  ← last fetched modules.json (cached)
├── store-cache/
│   ├── releases/<repo>.json      ← cached release metadata per repo (TTL+etag aware)
│   ├── readmes/<repo>.<locale>.md ← rendered README variants per repo+locale (optional)
│   └── packs/                    ← staged .lumenpack downloads (cleaned after install)
└── installed-modules.json        ← {id, version, source} for restore (existing file)
```

Reads are **cache-first**: render from `catalog.json`, then refresh in the background. If the fetch fails (offline / rate-limited), the app shows the cached catalog with a subtle "offline / stale" indicator instead of an empty shell.

`installed-modules.json` (already planned in [module-system-architecture.md](./module-system-architecture.md)) is what powers **restore**: on a fresh install, entries with `source: "store"` are offered for automatic reinstall from the store.

---

## UI structure — the Store app inside the Commander

The store is delivered as an **app** contributed to the Commander as a built-in `type: 'app'` command. This mirrors how Raycast organizes its ecosystem: the palette is the front door, and each distinct workspace (store, browse, installs, updates) is a full-screen app the user navigates into.

The Commander already supports exactly this affordance:

- A `CommandSpec` with `type: 'app'` + a `component` renders as a full app view inside the palette, receiving `CommanderAppProps`.
- `CommanderAppProps` gives the app its navigation surface: `onClose`, `onBack`, `query`/`setQuery`, `setSearchTrailing`, and `setBackHandler`. This is the basis for the Store's internal navigation (open a module detail → set a back handler → escape pops back to the catalog).
- A single module shell command hosts all store views rather than dozens of palette entries.

### Contributing the Store app

```ts
// built into the host (not a module), registered once at shell startup:
host.commands.add({
  id: 'store.open',
  title: 'Store',
  subtitle: 'Browse and install modules',
  type: 'app',
  keywords: ['modules', 'install', 'plugins'],
  component: StoreApp,          // receives CommanderAppProps
  commanderSearch: { placeholder: 'Search the store…' },
});
```

The user presses the palette shortcut, types "store", and opens the app. Because it is an `app`, it keeps the palette's search box (via `commanderSearch`) for filtering, and the Commander's header shows a back button (`setBackHandler`) when the user navigates into a module detail.

### Store app views

The Store app is a small single-window flow within the Commander:

```
Open palette → type "store" → StoreApp

StoreApp
├── Browse (root view)
│     · list of published modules — each row shows:
│         · module icon (or square photo) + name
│         · author avatar photo + author name
│         · download count + like/dislike counts (deferred; hidden until the counter/votes ship)
│         · installed state: "vX installed" / "Update available" badge
│     · ↑↓ navigate rows, Enter opens the module detail
│     · search box (commanderSearch) + tag/category chips filter the list
│     · default sort: by recency (see "Browse sorting")
│     · "Installed" entry separately lists installed modules (Manage view)
├── Module detail (pushed view, setBackHandler)
│     · hero image/cover + name + author + tags + license
│     · full README of the module (rendered from the author's repo — see "Localized READMEs")
│     · permissions — the manifest's allowed capabilities, shown legibly
│     · vote controls: 👍 like / 👎 dislike (deferred)
│     · primary action: Ctrl+Enter to install (or update)
│     · Esc / back button returns to Browse
└── Manage (installed modules)
      · list of installed modules: enable/disable/uninstall, per-module config
      · aggregate "Check for updates" + bulk apply
```

Interaction model (Raycast-style key-driven):

- **Enter on a store row** → enters the module detail. It does **not** install.
- **Install/Update is always explicit: `Ctrl+Enter`** (Cmd+Enter on macOS) on the detail view. The app shows the shortcut hint as a `Kbd` label next to the Install button.
- Because install requires the deliberate `Ctrl+Enter`, **no confirmation alert is needed** — an accidental Enter can never install. This replaces the "are you sure?" prompt entirely.
- `Ctrl+Enter` on an installed module that has an update triggers the update instead.

Navigation is **view-stack based** using the Commander's existing `setBackHandler` / `back` contract: opening a detail calls `onBack={() => void onBackAction()}` and registers a handler; Escape or the back button returns to Browse without closing the palette. Closing the palette (`onClose`) always terminates the app cleanly.

### Browse rows — what each entry shows

Each published module appears as a row (list, not grid, in the Raycast style) with:

| Element | Source |
|---------|--------|
| Module name | catalog `name` |
| Module icon / square photo | catalog `icon` / `cover` (`logo`); when omitted → generated placeholder (initials) |
| Author avatar photo | GitHub avatar from the author's GitHub URL: `https://github.com/<user>.png?size=64` (author is always a GitHub user because modules ship via GitHub releases) |
| Author name | catalog `author.name` |
| Download count | counter service — **deferred**; hidden until it ships |
| Like/dislike counts | vote service — **deferred**; hidden until it ships |
| Verified by Lumen badge | catalog `lumenVerified` (optional, granted during PR review) — renders a small badge next to the name |
| Installed / update badge | `useModuleStore` + release-version comparison |

### Browse sorting

- **Default sort: by recency.** The browse list is ordered by the module's **latest release date** (resolved via the cached `store_get_release` data), so recently updated modules surface first.
- **"New releases"** (recency by `approvedAt`) is a distinct secondary sort for newly added modules that haven't released since.
- Sorting keys are resolved from data already fetched+cached (release metadata + catalog fields); no new endpoint needed.

### Module detail view

The detail view (a pushed app view) shows:

- **Hero**: icon + cover square photo, module name, author (avatar + name), tags, license.
- **README**: the module's full README rendered as the detailed description, per the user's design ("a descrição mais detalhada com imagem... basicamente o readme do repo do módulo"). The description is **always the author's repo README**, not an index-hosted copy — the catalog carries no readme content (see "Localized READMEs").
- **Permissions**: the manifest's allowed capabilities rendered legibly (e.g. "Network access to: `*.youtube.com`, `api.google.com`") — surfaced before install, from the `permissions` block already validated by `Installer`.
- **Votes (deferred)**: 👍/👎 controls with counts. One vote per module per app install; clicking again clears it, clicking the other side switches. The user's own votes are cached locally so the buttons show the current state. Not tied to any account.
- **Primary action**: `Ctrl+Enter` to Install (or Update when an update exists). The hint is displayed as a `Kbd` next to the button. No confirmation alert.

### Localized READMEs (author repo root convention)

This is **a convention we define with the author**, not a GitHub feature — GitHub renders only the root `README.md` and has no native language selector. The convention exists so the store can offer localized descriptions with zero extra infrastructure:

```
README.md               ← canonical (required — every repo has it)
README.pt-BR.md         ← optional, one file per language the author offers
README.ja.md            ← optional
```

The author does **not** need a language selector or links in the README; the store just resolves the file by name. GitHub's UI will still show only `README.md`, but the store reads its own locale variant. On the author side it's a familiar, widely used naming pattern (`README.<locale>.md`).

- One file **per language the author wants to offer**, named `README.<locale>.md` at the repo root. Not translating is fine — if only `README.md` exists, the store shows it to everyone.
- **Rendering rule**: the app takes its **active locale** (e.g. `pt-BR`), probes `README.<locale>.md` on raw.githubusercontent.com (a cheap HEAD — raw is a CDN and does **not** count against GitHub's 60 req/h API rate limit), renders it if present, and falls back to `README.md` otherwise.
- Since raw fetches don't hit the rate limit, per-locale caching is optional; the existing `store-cache` can still hold the rendered variant with the same TTL patterns.
- The author's translation is thus **always current with the repo** — no index re-PR needed when the README or its translations change.

### Manage view & installed state

The "Manage" view aggregates the same surfaces today's `src/components/settings/modules-section.tsx` already exposes (status badge, enable/disable/reload/uninstall) plus store-specific state: **Update available**, **No longer in store**, and install/update download progress. It also holds the "Check for updates" trigger and the optional GitHub PAT field (rate-limit raised).

### Components / stores to create

```
src/
├── app/store/                         // the Store app (single Commander surface)
│   ├── store-app.tsx                  // `type: 'app'` component, receives CommanderAppProps
│   ├── store-browse.tsx               // root view: search + tags + module grid
│   ├── store-module-detail.tsx       // pushed view: detail + install/update CTA
│   └── store-manage.tsx               // installed modules: check updates, enable/disable/uninstall
├── services/store-service.ts          // wraps store_* Tauri commands
└── stores/modules-store.ts            // (zustand) catalog list, cache state, install progress
```

The `store-service.ts` exposes typed functions over the new `store_*` commands; the frontend uses **TanStack Query** (`@tanstack/react-query`) on top of those IPC calls for catalogs, releases, and README reads (stale/refetch/caching of the UI layer — network control and disk caching stay in Rust). The zustand store holds per-module install/update progress and reactive update flags. The Injector already handles the `module:installed` event to hot-activate — the Store app simply reflects `useModuleStore` state for the installed/update badge. A single command registration in the host wires the whole app into the Commander; the existing **Settings → Modules** list can keep its current management-only role (status, enable/disable, uninstall) without becoming a store.

---

## Trust, verification, and the v1 threat model

v1 policy (explicit, per the user's decision): **trust is granted by the moderated index review.** There is **no signature verification, no content hashing, and no worker isolation** for store modules at v1. Store modules run in the same execution context as the host — exactly like sideloaded modules today.

What mitigates risk at v1:

| Layer | What it does |
|-------|--------------|
| Index moderation | `modules.json` is edited only via PR; maintainers review id uniqueness, manifest validity, and a code/behavior review before merging |
| Manifest validation | `Installer` validates `manifest.json` (id reverse-DNS, required fields) and the `api` range against the host before running |
| Network allowlist | Modules only reach the network through `host.net`, which enforces `permissions.network` + https + private-host blocking |
| Crash quota | The Injector auto-disables a module after `CRASH_THRESHOLD` errors in a rolling window |
| Clean uninstall | `Installer`+registry: uninstall removes the module dir with no orphans; module data is scoped to its own dir |

**Why this is acceptable for v1** (mirrors [module-system-architecture.md](./module-system-architecture.md) "Threat model"): an operator running a live event is the highest-stakes user, and a single broken module must not take down a show. The Injector's failure isolation (per-panel error boundaries, per-callback wrapping, crash quota) keeps the shell alive. Full malicious-code isolation is deliberately deferred to the Worker-isolation tier, which is the right place to also introduce signed manifests and recorded sha256.

**When to revisit:** before the store grows beyond first-party/trusted community contributions, or the moment any module needs filesystem/network access beyond the documented allowlist, graduate those modules to the `isolation: 'worker'` tier and require signed, hashed releases. The catalog schema reserves `status` for this migration.

---

## Distribution

### The `.lumenpack` artifact

Unchanged from [module-system-architecture.md](./module-system-architecture.md). A built module ships as a single zip:

```
raffle-1.0.0.lumenpack          (zip)
├── manifest.json
├── main.js
├── styles.css        (optional)
└── assets/
    └── icon.svg
```

### Author publishing flow (human-friendly)

1. Build + pack locally: `pnpm lumen-module build && pnpm lumen-module pack`.
2. Push to their GitHub repo; create a **Release** tagged `v<semver>`, attaching the `.lumenpack` as a release asset.
3. Open a **PR against `Lumen-media/community-modules`** adding an entry to `modules.json` (id, name, tagline, tags, author, repo, license, icon/cover).
4. Maintainers review (id uniqueness, manifest validity, basic code review) and merge. Merging publishes the module to the store.

### App install flow (end user)

1. Open the **Commander** → type "store" → open the **Store** app; the app fetches + caches `modules.json`.
2. User presses **Enter** on a module row to open its detail, then **Ctrl+Enter** to install — the deliberate shortcut is the confirmation; no alert is shown.
3. App resolves the author's latest release, downloads the `.lumenpack` (size-capped, staged), hands it to `module_install`.
4. `Installer` validates + extracts to `{app_data}/lumen/modules/{id}/`, registers in `lumen.sqlite`; Injector hot-activates.
5. The module appears under **Installed** with its panels/commands live — no restart.

### Update / uninstall

- **Update**: surfaced under **Updates** or as a badge on the installed entry; one click re-runs the install flow against the latest release.
- **Uninstall**: existing `module_uninstall` path — removes the dir + registry entry, unloads the module. No restart.

### Store module restore

`installed-modules.json` records every installed module as `{id, version, source}`. `source: "store"` entries are reinstalled automatically from the store on a fresh install (no backup), or manually via the **Restore** flow, pulling the latest release that satisfies the recorded version.

---

## Future work

These are deliberately out of scope for v1, tracked here so the design has a clear path:

- **Worker isolation for store modules.** Graduate store modules to `isolation: 'worker'` (descriptor bridge) once the marketplace is truly open/uncensored. This is also where **signed manifests** and **recorded sha256** of release assets become meaningful.
- **Content hashing & pinning.** Record a per-version sha256 in `modules.json` (or a releases manifest) so the app can verify a download before extracting. Cheap win that can be added behind the existing `schemaVersion`.
- **Moderation states.** `status: removed | deprecated | flagged` in the catalog so the app can fire warnings ("This module was removed from the store") without breaking installed copies.
- **Account/payments/ratings.** Not planned; the personal-access-token field is the only auth-adjacent feature in v1.
- **Immutable index pinning.** A tag-based index (`v1-<hash>`) if offline byte-pinning or signed catalog distribution becomes necessary.
- **Featured collections (idea, outside current scope).** An editorial "Featured / Staff picks" section on the Browse root, driven by a `featured: [...]` list of module ids (ordered) in the index. Different from tags: tags are filtering taxonomy, featured is editorial curation. Deliberately not in v1; recorded here so the index schema reserves room later.

---

## Open questions

- **Release asset naming contract.** The app computes the expected asset name from the catalog `id` (`<id>-<version>.lumenpack`) but should stay tolerant to the author's actual filename (match by prefix + `.lumenpack` extension, or read the `Content-Disposition`). Decide whether the catalog should **require** a canonical filename (stricter, simpler code) or allow arbitrary names (looser, friendlier to existing release flows).
- **Icon/cover fallback.** Should the app render generated initials/silhouette placeholders when a catalog entry omits `icon`/`cover`, or should the index repo require assets at review time? Recommend placeholders + optional assets.

> **Decided (2026):** Module README is **always** the author's repo root README, with optional `README.<locale>.md` variants (see "Localized READMEs"); download counts **and** like/dislike voting via the minimal serverless service — **deferred** (see "Counters & votes").

---

## Repository / implementation checklist

- [ ] **Rust `src-tauri/src/module_runtime/store.rs`**: `store_fetch_catalog`, `store_get_release`, `store_get_readme`, `store_download_module`, `store_install`; wire into `lib.rs`/`main.rs` command registrations
- [ ] **Catalog cache**: read/write `catalog.json` + `store-cache/releases/*` with TTL + stale-if-error
- [ ] **Rate-limit miss corrigendum**: optional GitHub PAT setting feeds the `Authorization` header on release calls
- [ ] **`src/services/store-service.ts`**: typed wrappers over the store commands
- [ ] **`src/stores/modules-store.ts`**: catalog state, install progress, update badges
- [ ] **UI (Commander app)**: `src/app/store/store-app.tsx` (registers the `type: 'app'` command + `store.open` in the host), `store-browse.tsx` (list rows: icon, author avatar, download badge placeholder), `store-module-detail.tsx` (README + permissions + `Ctrl+Enter` install), `store-manage.tsx`
- [ ] **Restore**: reinstall `source: "store"` entries from `installed-modules.json`
- [ ] **CI**: a workflow in `community-modules` validating `modules.json` against `schema.json` (id uniqueness, schemaVersion, required fields) on every PR
- [ ] **i18n**: add store UI strings to `src/locales/*/translation.json` (en + pt-BR to match existing pairs)
- [ ] **Docs**: point the store/security notes in [module-system-architecture.md](./module-system-architecture.md) at this file

### Deferred (intentionally NOT built now — 2026)

- [ ] **Counters + votes service**: serverless `POST /counts/+1` + `POST /votes { id, dir, voterHash }` + `GET /counts`; the app POSTs a count after each store install, POSTs/votes on user action, and merges `{ downloads, up, down }` into the catalog response. Client keeps an anonymous per-install `voterHash` locally to dedupe votes and reflect the user's own vote. Catalog schema and install flow unaffected; only the UI columns + `store_fetch_catalog` shape change when it ships.
