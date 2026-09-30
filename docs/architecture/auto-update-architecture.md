# Auto-Update - Architecture Design

## Overview

Lumen ships its own auto-updater, built on the Tauri updater plugin but with **all orchestration on the Rust side**. The renderer never touches the updater plugin API directly — it calls Lumen's own commands and listens to Lumen's own events.

The reason for the indirection is the **"remind me later" flow**. The Tauri plugin exposes a low-level pair — `download() -> Vec<u8>` and `install(&[u8])` — and that split is what makes deferral possible: a *verified* artifact can be written to disk, survive a process restart, and be applied on a later launch without asking the endpoint again. Owning the orchestration in Rust is what allows that state to live on disk instead of in a JS closure that dies with the window.

```
┌──────────────────────────────────────────────────────────────────┐
│  Renderer (thin)                                                  │
│  splash.tsx · use-app-update.ts · update-dialog.tsx              │
│  app-update-service.ts  ── invoke() ──┐        listen() ◄──┐    │
└───────────────────────────────────────┼───────────────────┼────┘
                                        │                   │
                        app_update_boot  │  check_app_update │  app-update-progress
                        app_update_      │  install_app_    │  (state, version,
                        progress_state   ▼  update           │   downloaded, total, error)
                                ┌────────────────────────┐   │
                                │  updates.rs (Rust)     │◄──┘
                                │  · state machine       │
                                │  · 8s check timeout    │
                                │  · blake3 integrity    │
                                │  · defer / re-apply    │
                                └───┬────────────────┬───┘
                                    │                │
                    tauri_plugin_updater          updater.json
                    check / download / install    + {version}-{target}.bin
                                    │
                                    ▼
              https://github.com/Lumen-media/lumen/releases/latest/download/latest.json
```

**Design stance:** the frontend is a *view*. It renders whatever `UpdateProgress` says and forwards user intent. It never decides whether an update is safe to install, never writes state, and never talks to the network. If the renderer is compromised, the worst case is a wrong label on a dialog — the artifact is still verified and applied by Rust.

---

## Goals & Non-goals

**Goals**
- A signed artifact is verified before it is ever written to disk, and re-verified before it is applied.
- "Not now" is a first-class outcome, not a dismissal — the download still happens, and the update lands on a later launch.
- An interrupted install must never produce a boot loop. A failed attempt cleans itself up on the next start.
- The splash screen is never held hostage by a third-party endpoint. A slow or hanging network call cannot trap the user behind a loader.
- One place to reason about updater behavior: `src-tauri/src/updates.rs`.

**Non-goals**
- Differential (binary) patching. Full-artifact replacement only.
- Auto-install without user consent. The first update always surfaces a dialog; only *deferred* installs are silent, and only because the user already said yes once.
- Rollback to a previous version. There is no version pinning; a bad release is fixed by shipping a newer one.
- **Authenticode code signing (out of scope, deliberate).** The updater signature proves the artifact came from the key we control, but the Windows binary itself is unsigned. SmartScreen may warn on the first install of any new version. This is tracked as a known limitation, not an oversight — see "Deferred".

---

## The trust chain

| Layer | What it does | Failure mode |
|-------|--------------|--------------|
| **minisign signature** | Tauri verifies `latest.json`'s signature against `plugins.updater.pubkey` before trusting any URL, version, or digest it contains | A tampered manifest is rejected outright; the check never returns an update |
| **blake3 digest** | The downloaded bytes are hashed and stored alongside the pending artifact | A corrupted or swapped file on disk is detected and discarded on the next boot |
| **version match** | A deferred artifact is only applied if the endpoint still advertises that exact version | A superseded artifact is dropped rather than installing an older build |
| **`installing` flag** | Set immediately before handing bytes to the platform installer | If the process dies mid-install, the next launch sees the flag and discards the partial attempt |

> The digest is **defense in depth, not the primary control.** The minisign signature on the manifest is what establishes provenance; the digest catches a local truncation or bit-rot between download and install, which is a real failure mode for a multi-hundred-megabyte file sitting on disk for hours.

### The public key

```
plugins.updater.pubkey  in  src-tauri/tauri.conf.json
```

The matching private key is a release secret and **must never be committed**. It lives only in the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` (with `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` protecting it). `.gitignore` blocks `*.key` while explicitly allowing `*.key.pub`, so a public key can be committed but a private one cannot be added by accident.

---

## Tauri commands

All five are registered in `src-tauri/src/main.rs` and exposed to the frontend. The `splashscreen` and `main` labels are both listed in `capabilities/default.json`, so either window may call any of them.

| Command | Returns | Purpose |
|---------|---------|---------|
| `app_update_boot()` | `BootUpdateState` | Called **once** by the splash. Applies a previously deferred artifact before the main window is allowed to appear. |
| `check_app_update(force?)` | `UpdateInfo \| null` | Hits the endpoint. `null` means up-to-date *or* dismissed-and-unchanged; `force` bypasses the dismissal filter (used by the manual "Check for updates"). |
| `install_app_update()` | `()` | Downloads **and** installs immediately. The process is replaced on Windows. |
| `defer_app_update()` | `()` | Downloads in the background, writes the artifact to disk, and returns at once. Applied on a later launch. |
| `app_update_progress_state()` | `UpdateProgress` | Reads the current progress snapshot. The event is authoritative; this exists so a window that mounts late can catch up. |

### `UpdateProgress` — the state machine

A single struct is both the event payload and the pollable snapshot. `state` is a plain string so the renderer can switch on it without a discriminated union crossing the IPC boundary.

| `state` | Meaning | Set by |
|---------|---------|---------|
| `idle` | Nothing in flight | `check` when the found version was already dismissed |
| `checking` | Endpoint request in flight | `check_app_update` entry |
| `up-to-date` | Endpoint has nothing newer | `check_app_update` on `null` |
| `available` | An update is offered and awaiting user choice | `check_app_update` on a new version |
| `downloading` | Bytes in flight; `downloaded`/`total` are meaningful | download progress callback |
| `deferred` | Artifact is on disk, waiting for a later launch | `defer_app_update` return |
| `ready` | Download finished and the artifact is persisted | `defer_to_disk` |
| `installing` | Bytes handed to the platform installer | both install paths |
| `error` | Something failed; `error` carries the message | any failure path |

---

## Persistence

State lives in `{app_base}/lumen/updates/`, written as pretty JSON so a support engineer can read it over the user's shoulder.

```
{app_base}/lumen/updates/
├── updater.json                     ← the whole persisted state
│   {
│     "dismissedVersion": "0.4.7",  // user said "not now" — stop nagging
│     "pending": {                   // a verified artifact waiting for a launch
│       "version":     "0.4.7",
│       "target":      "x86_64-pc-windows-msvc",
│       "artifact":    "0.4.7-x86_64-pc-windows-msvc.bin",
│       "digest":      "<blake3 hex>",
│       "installing":  false         // true = an attempt died mid-flight
│     }
│   }
└── 0.4.7-x86_64-pc-windows-msvc.bin  ← the verified artifact
```

Two fields carry all the meaning:

- **`dismissedVersion`** suppresses repeat nagging. A user who clicks "Not now" on 0.4.7 does not see 0.4.7 again on every launch. It is cleared once a *different* version is offered, or once the deferred install is applied.
- **`pending.integrity`** — the `installing` flag is the anti-boot-loop guard. It is set immediately *before* the platform installer is invoked. If the process is killed during the install (which is exactly what Windows does), the flag is still `true` on the next launch, and `app_update_boot` discards the artifact instead of retrying forever.

---

## Update flows

### Immediate — "Update now"

```
1. check_app_update()          → available
2. install_app_update()
     ├─ download_with_progress()    → emits "downloading" per chunk
     ├─ emit "installing"
     └─ update.install(&bytes)      → Windows: installer launches, process exits
                                     other:   app.restart()
```

### Deferred — "Not now", applied next launch

```
launch N:
  1. defer_app_update()            → returns immediately
  2. spawn: download bytes  → write {version}-{target}.bin
                              → hash blake3
                              → persist {dismissedVersion, pending}
                              → emit "ready"

launch N+1 (splash screen, before main is shown):
  3. app_update_boot()
       ├─ pending.installing?  → discard, clean state      (interrupted attempt)
       ├─ file missing?        → discard, clean state
       ├─ digest mismatch?     → discard, clean state
       ├─ endpoint no longer advertises this version?
       │                       → discard, clean state      (superseded)
       └─ set installing = true
          emit "installing"
          spawn: install(bytes)
  4. return { applying: true }     → splash holds itself open
```

`defer_app_update` is the reason `app_update_boot` exists at all. The download already happened, so applying it later must not re-consult the user's intent — but it *must* re-verify the bytes, because they have been sitting on disk for an arbitrary amount of time.

### Why the splash screen is involved

`app_update_boot` runs before the main window is visible, which is the only moment where the process can be replaced without the user losing work. The splash is the natural place to hold the UI: the artifact is already downloaded, so applying it is fast, and the app is going to restart regardless.

This coupling is also a hazard, which is why `check_with_timeout` exists. `updates.rs` documents the reason directly:

> The endpoint is a third party and the splash screen waits on this, so never let the request outlive a short window.

`CHECK_TIMEOUT_SECS = 8` bounds the call, and `splash.tsx` applies its own `BOOT_DEADLINE_MS = 5000` so the UI gives up independently of the backend. Neither layer trusts the other to return.

---

## Frontend

The renderer is deliberately thin. It holds no updater logic worth the name.

| File | Role |
|------|------|
| `src/services/app-update-service.ts` | Typed `invoke()` wrappers and the event listener. The **only** place that names an updater command. |
| `src/stores/app-update-store.ts` | zustand store mirroring the last `UpdateProgress`. Pure display state. |
| `src/hooks/use-app-update.ts` | Automatic check on mount + manual `checkNow()`. |
| `src/components/updates/update-dialog.tsx` | The "Update now" / "Not now" prompt. |
| `src/app/splash.tsx` | Calls `app_update_boot()` once; holds the splash while `applying` is true; closes itself on a deadline. |
| `src/app/__root.tsx` | Mounts the watcher and dialog on the main windows only. |

```
src/
├── services/app-update-service.ts
├── stores/app-update-store.ts
├── hooks/use-app-update.ts
├── components/updates/update-dialog.tsx
└── app/splash.tsx
```

Strings live in `src/locales/en/translation.json` and `src/locales/pt/translation.json`. Manual checks are reachable from **Settings → About** and from **Help → Check for Updates**.

### The splash close condition

`splash.tsx` closes the splash — which is also what reveals the main window — when **either** the status reel finishes **or** the boot deadline passes:

```ts
if (!bootResolvedRef.current && Date.now() < deadline) return;
if (bootResolvedRef.current && elapsed < total) return;
```

Both guards must fall through. A hung `app_update_boot` cannot hold the app on the loader, and a fast backend cannot cut the animation short.

> **The `applying` path is the one condition that blocks indefinitely**, and that is correct: a deferred install replaces the process, so the splash *is* the loading state. The guard against it living forever is the backend timeout plus the interrupted-attempt cleanup in `app_update_boot` — not a frontend timer.

---

## Release pipeline

`createUpdaterArtifacts: true` in `src-tauri/tauri.conf.json` makes the bundler emit `latest.json` (a signed manifest) alongside the installers.

- **Endpoint:** `https://github.com/Lumen-media/lumen/releases/latest/download/latest.json` — GitHub's stable `latest` redirect, so a release is live the moment it is published.
- **`installMode: "passive"`** on Windows: the installer runs without a confirmation dialog and never steals focus. Lumen's own dialog already asked.
- **Draft first.** The workflow produces a **draft** release. `latest.json` is not reachable until a human publishes it, which makes publishing the explicit final step.

`.github/workflows/build-installers.yml` fails fast when the signing secrets are absent, so a release can never be published unsigned by accident:

```
1. verify TAURI_SIGNING_PRIVATE_KEY is set          → fail early if missing
2. pnpm build
3. pnpm tauri build  (createUpdaterArtifacts: true)
4. sign .bin + latest.json with the private key
5. upload to a DRAFT GitHub release
6. a human publishes it
```

Required repository secrets:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | the minisign private key, full contents |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | that key's passphrase |

---

## Error handling

Every failure is terminal for the user and non-fatal for the app.

| Failure | Behavior |
|---------|----------|
| Endpoint unreachable / slow | 8s timeout → `error`; the app is otherwise unaffected. The splash closes on its own deadline. |
| Malformed or unsigned `latest.json` | Rejected by the plugin; `check` returns an error. No artifact is fetched. |
| Download interrupted | `error`; the partial file is never written (bytes are held in memory until complete). |
| Artifact corrupted on disk | blake3 mismatch at boot → discarded, state cleared, user sees nothing. |
| Install fails to launch | `installing` is reset to `false` so the next launch retries. |
| Process killed mid-install | `installing` is still `true` at next boot → artifact discarded rather than looped. |
| Unknown or changed payload shape | `serde_json` parsing fails → `UpdaterState::default()`, i.e. a clean idle state. |

There is no path where a failed update prevents the app from starting. That is the single most important property of this design.

---

## Deferred / Out of Scope

- **Authenticode code signing.** The Windows binary is unsigned, so SmartScreen shows a warning on first install of each new version. The updater's minisign signature proves *provenance*; it does not satisfy SmartScreen, which wants an Authenticode chain. This is the main rough edge left.
- **Delta updates.** Every update is a full artifact. Fine at current installer sizes; revisit when a release is large enough for users to notice.
- **Rollback.** No way to pin a previous version.
- **Release channels** (beta / nightly). The endpoint is a single `latest`.
- **Automatic download in the background.** Downloads happen only after the user sees the dialog, so we never spend a user's bandwidth on a choice they may decline.

---

## Implementation checklist

- [x] `src-tauri/src/updates.rs` — the whole orchestrator, state machine, and persistence
- [x] `src-tauri/src/main.rs` — register the updater plugin, `UpdateState`, and the five commands
- [x] `src-tauri/tauri.conf.json` — `plugins.updater` (pubkey, endpoint, `installMode`), `bundle.createUpdaterArtifacts`
- [x] `src-tauri/capabilities/default.json` — `updater:default`, plus `splashscreen` in the window list
- [x] `src-tauri/Cargo.toml` — `tauri-plugin-updater` **must** be a dependency, or the build script fails with `Permission updater:default not found` and no command works
- [x] Frontend service, store, hook, dialog, splash wiring, `__root.tsx` mount
- [x] i18n strings (en + pt)
- [x] `.github/workflows/build-installers.yml` — signing secrets + artifact generation + fail-fast verification
- [x] `.gitignore` — `*.key` ignored, `*.key.pub` allowed
- [ ] Generate the production key pair and populate the two GitHub secrets
- [ ] End-to-end test against a real published signed release (deferred path included)

---

## Troubleshooting

**Every command returns `Command not found`.**
The ACL was never generated, so *all* IPC is dead — not just updater commands. The cause is a capability referencing a permission whose plugin is not a dependency: `capabilities/default.json` lists `updater:default`, so `tauri-plugin-updater` must be present in `Cargo.toml`. The build script fails with:

```
Permission updater:default not found, expected one of ...
```

That error is easy to miss because the build still produces a *stale* binary, which then fails at runtime with a confusing `Command not found`.

**`Found version mismatched Tauri packages`.**
The npm packages and Rust crates must sit on the same major/minor: `tauri` (Rust) `2.12.0` vs `@tauri-apps/api` (npm) `2.11.1` is the classic shape. Bump the npm side to match.

**`can't find crate for '<dep>'` / `failed to run custom build command`.**
Not a project problem. Smart App Control (Windows 11) blocks unsigned binaries, including cargo's own `build-script-build.exe` under `target/debug/build/`. The log says `did not meet the Enterprise signing level requirements`. Unlike SmartScreen, SAC has no "Run anyway" — it has to be turned off in Settings → Windows Security → App & browser control, or the affected binaries must be signed. Symptom on a healthy checkout: `cargo build` fails on a dependency that has not changed in weeks.
