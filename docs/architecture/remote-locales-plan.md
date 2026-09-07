# Remote Locales — Feature Plan

## Overview

Lumen currently bundles its translations inside the app source (`src/locales/{en,pt}/translation.json`, imported statically at build time). This plan moves translation *content* into a **separate open-source repository** (`Lumen-media/lumen-locales`) and makes the app consume them at **runtime** — downloading locale files over a CDN, caching them locally, and applying them without an app reinstall.

`lumen-locales` is the **source of truth** for translations. Editing a translation or adding a language happens there (PR on the locale repo), never requiring a Lumen release. The Lumen repo keeps only a bundled fallback for offline/first-run.

This follows the same mental model as the existing tool download system (yt-dlp / ffmpeg): "check remote → download → cache → status in Settings".

## Current State

| Piece | Where | Notes |
|---|---|---|
| Translation store | `src/lib/i18n.ts` | Zustand store; flat key→string maps; `resolve()` falls back `dict → en → key`. |
| Locale files | `src/locales/*/translation.json` | Imported at build (`import en from '@/locales/en/translation.json'`). Becomes fallback only. |
| Language selector | `src/components/settings/theme-section.tsx` | List hardcoded: `en`, `pt-BR`. New language requires app update. |
| Tool download | `src-tauri/src/download/` | `github.rs` (release fetch), `dependencies.rs` (`tools_dir`, `versions.json`, `DependencyStatus`), frontend `download-service.ts` + Downloads section. |
| Media/Cover strategies | — | No runtime content pipeline for locales yet. |

## Delivery Model

- **Source of truth:** OSS repo `Lumen-media/lumen-locales` with:
  - `locales/en.json` — **canonical** (keys are English text, same schema as today).
  - `locales/pt-BR.json` + future languages.
  - `languages.json` — index of available languages (`code`, `name`, `nativeName`). Powers the selector, so a new language shows up **without an app update**.
  - Releases: git tags (`vYYYY.MM.DD`). On tag, CDN publishes immutable URLs.
- **Editing flow:** translations are changed via **PRs to `lumen-locales`** — no Lumen release involved. On merge, CI validates and auto-tags → CDN updates.
- **Transport:** **jsDelivr** (`https://cdn.jsdelivr.net/gh/Lumen-media/lumen-locales@<tag>/...`) — free CDN over GitHub, no GitHub API rate limits for downloads, immutable-per-tag URLs (safe caching / cache busting).
- **Cache:** downloaded files stored in `{app_data_dir}/locales/`, with a `sync.json` recording last synced tag + per-locale applied state (mirrors `versions.json`/`ToolVersions`).
- **Fallback:** the current bundled `en`/`pt-BR` JSON stays as a **first-run offline safety net** until the first successful sync.

```
app startup (background, non-blocking)  or  Settings > Idiomas > "Verificar atualizações"
  -> check latest tag (cheap GitHub API call; bail silently on failure)
  -> if tag changed: download languages.json + locales/*.json from jsDelivr
  -> validate each file (size + JSON + key-parity vs canonical en bundled)
  -> cache to {app_data_dir}/locales/ + write sync.json
  -> emit event -> frontend reloads dictionary, language selector list updates
```

## Locale Repository (`Lumen-media/lumen-locales`)

- Files: `locales/en.json`, `locales/pt-BR.json`, … + `languages.json`.
- `en.json` is authoritative; every other locale must contain **all** en keys (no missing, no extra required).
- **CI on PRs** (GitHub Actions, plain node — no deps):
  - JSON parses.
  - Key-parity: locale keys ⊇ en keys.
  - Values are strings, flat map, no nested objects/HTML/script patterns.
  - Size per file ≤ 1 MB.
- **Auto-release:** a workflow tags `main` on merge (`v<date>.<n>` — per-day counter), so CDN picks up community PRs automatically; every release is unique (no same-day stale cache).

## Architecture

### Rust — `src-tauri/src/locales.rs` (mirrors `download/dependencies.rs`)

State & persistence:
- `locales_dir(app)` = `app_data_dir/locales`.
- `sync.json` — `{ last_synced_tag, synced_at, bundle_revision }` (like `versions.json`).
- Files on disk: `en.json`, `pt-BR.json`, … `languages.json`.

Commands (registered in `main.rs`):
- `check_locales` → latest tag (GitHub API `releases/latest` via existing `fetch_release` helper in `github.rs`) + installed state per language.
- `sync_locales` → download `languages.json` + every `locales/*.json` from jsDelivr at the latest tag → validate → write to `locales_dir` → update `sync.json`.
- `list_locales` → per installed language: `{ code, name, applied, translated_keys, last_synced_tag }`.
- `apply_locale(lang)` → sets the active language (persisted), returns the locale JSON.

Validation (before `sync.json` is updated / locale is applied):
- Size cap (1 MB/file).
- JSON parse → flat `Record<string, string>`.
- **Key-parity gate:** locale keys must contain the bundled canonical en keys; otherwise reject that file (a bad PR cannot brick the UI).
- Optional: reject values containing `<script` or `javascript:`.

### Frontend

- `src/lib/i18n.ts`:
  - Keep the store + `t()`/`useTranslation()` contract unchanged.
  - Replace the single static import with a **runtime dictionary**: on startup (and on locale events) read cached files from `locales_dir` via Tauri fs; `resolve()` chain becomes `runtime dict → bundled fallback → key`.
  - Add `applyLocale(lang)` and subscription to locale-sync events.
- `src/components/settings/theme-section.tsx`:
  - Language list from `list_locales`/`languages.json`, no longer hardcoded.
- **New "Idiomas" settings section** (mirrors Downloads):
  - Status: installed languages + applied state + last sync tag/time.
  - Buttons: "Verificar atualizações" (`check_locales`) and "Atualizar" (`sync_locales`).

### Source removal (goal of the plan)

- Once OTA is live, the Lumen repo no longer hosts translation *content* — only the bundled fallback copies (or, in a later phase, a minimal en-only fallback).
- Translation *changes* happen via PRs to `lumen-locales`, not in the Lumen repo.

## Settings & Status Surface

| Field | Type | Source | Notes |
|---|---|---|---|
| `locales_dir` | path | `app_data_dir/locales` | Cache location |
| `last_synced_tag` | string | `sync.json` | e.g. `v2026.09.07.1` |
| `synced_at` | timestamp | `sync.json` | |
| `languages[]` | list | `languages.json` + installed state | Powers selector |
| `applied` | bool | per language | Whether that language is applied |

## UI Changes

### `src/components/settings/theme-section.tsx`
- Language options ← remote index (not hardcoded).

### New `src/components/settings/locales-section.tsx`
- "Idiomas" section: per-language status, update buttons, sync metadata.

### `src/lib/i18n.ts`
- Runtime dictionary (read from disk), event-driven reload on sync.

## Phased Roadmap

### Phase 1 — Locales Repository
> Content + CI in the locale repo. — *content seeded, CI pending in repo setup*

- [x] Seed `locales/{en,pt-BR}.json` + `languages.json` in `Lumen-media/lumen-locales`
- [ ] CI: JSON parse, key-parity vs en, size/HTML guards
- [ ] Auto-release workflow (tag `v<date>-<commit>` on merge) so CDN updates on PR merge

### Phase 2 — Rust Locales Module
> Backend: check/sync/list/apply + validation + cache.

- [ ] `locales.rs`: `locales_dir`, `sync.json`, `load/save`
- [ ] `github.rs`: `fetch_latest_locales()` (reuse `fetch_release`)
- [ ] Commands `check_locales` / `sync_locales` / `list_locales` / `apply_locale`
- [ ] Validation gate (size, JSON shape, key-parity vs bundled en)
- [ ] Emit locale-sync events on completion

### Phase 3 — Frontend Consumption
> App reads translations from disk; selector + Languages section.

- [ ] `i18n.ts` runtime dictionary with bundled fallback
- [ ] `applyLocale` + event subscription
- [ ] `theme-section.tsx` language list ← `list_locales`
- [ ] New `locales-section.tsx` (status + update buttons)

### Phase 4 — Startup Sync & Fallback Strategy
> Background sync + fallback sizing.

- [ ] Background check on startup: non-blocking, downloads only if tag changed
- [ ] Silence failures: offline/exhausted → keep cache, no error dialog (status only)
- [ ] Decide strip vs keep bundled `pt-BR` fallback (en-only fallback candidate)

### Phase 5 — Validation
- [ ] First-run offline → bundled fallback works
- [ ] Sync applies; keys parity gate rejects a deliberately bad file
- [ ] New language in repo → appears in selector after sync (no app update)
- [ ] Old app + newer locale file still renders (en fallback per key)

## End-to-End Verification

1. **Fresh install, offline:** app shows bundled en/pt correctly
2. **Sync:** Settings → Idiomas → Atualizar → files land in `locales_dir`, `sync.json` written
3. **Applied:** switch language → UI updates without restart
4. **New language:** merge a new locale to the repo (auto-tag) → app sync → language appears in selector
5. **Bad file rejected:** corrupt/oversized/non-parity file → rejected locally, app keeps previous state
6. **Restart persistence:** locale survives restart (read from disk)
7. **Selector:** shows exactly the languages from the remote index, not the hardcoded 2

## Risks

- **Bad translation PR bricks UI** → key-parity + size/HTML gates before apply; rejected files leave last-good state.
- **App version vs locales drift** → old locale file may lack keys → fallback `en` (bundled) per key, never crashes.
- **GitHub API rate limit for "latest" tag** → only one cheap call per check; jsDelivr serves the actual files (no rate limit).
- **Offline first run** → bundled en/pt fallback until first sync.
- **CDN unavailable** → keep last-synced cache; bundled fallback still works.

## Decisions (locked)

1. **Model:** runtime download (OTA) — not build-time package, not submodule.
2. **Source of truth:** separate OSS repo `Lumen-media/lumen-locales`, served via jsDelivr by tag. Translations are edited there (PRs), **not** in the Lumen repo — a translation change never requires a Lumen release.
3. **Canonical locale:** `en.json`; key-parity gate enforces it.
4. **Fallback:** bundled `en`/`pt-BR` until first successful sync.
5. **Selector:** backed by remote `languages.json` so new languages appear without app update.
6. **Sync cadence:** background check at every startup (non-blocking, downloads only when the tag changes); manual button still available. Failures (offline, rate limit) are **silent** — app keeps the last-synced cache, never blocks launch, no error dialog.
7. **Tag format:** `v<date>.<n>` — per-day counter on the mirror repo (`v2026.09.07.1`, `.2`, …); every release is unique so CDN URLs are immutable.

## Open Questions

- Keep both bundled fallbacks or shrink to minimal en?