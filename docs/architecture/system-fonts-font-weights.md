# System Fonts & Font Weights — Architecture Design

## Overview

Lumen needs to enumerate installed system fonts and, for module UIs, know which **font weights** (e.g., 100–900) are available per font family so modules can render a weight selector (regular, bold, etc.).

Today `get_system_fonts` (`src-tauri/src/main.rs`) returns only **family names** as `Vec<String>`, using the `font_loader` crate:

```rust
fn get_system_fonts() -> Vec<String> {
    let mut families: Vec<String> = font_loader::system_fonts::query_all();
    families.sort_unstable();
    families.dedup();
    families
}
```

The `font_loader` crate on Windows enumerates fonts via GDI (`EnumFontFamiliesExW`) and **discards per-face metadata** — `query_all()` / `query_specific()` return `Vec<String>` with no `weight`/`style`/`stretch`. This makes it impossible to answer "what weights does this family have?" with the current dependency.

---

## Requirements

- Cross-platform: the app targets **Windows, macOS, and Linux**.
- Modules need, per font family: list of available **weights** and **styles**.
- Low risk: ideally no breaking change to the existing `FontsAPI.list()` contract consumed by modules.
- Minimal performance impact: font enumeration happens once on demand, not on every render.

---

## Evaluated Options

### 1. `fontdb` crate (pure Rust, cross-platform)

- Adds `fontdb` to `Cargo.toml`; depends on `ttf-parser`, `log`, `memmap2`, `walkdir`, `libm` — the latter four are **already** in the lockfile. Only new crate: `ttf-parser`.
- `Database::load_system_fonts()` + `.faces()` yields `family`, `weight` (100–900), `style`, `stretch`.
- Same crate used by the resvg/usvg ecosystem.
- **Trade-off:** enumerates by **scanning font files on disk** rather than querying the OS font catalog — felt "heavy/indirect" compared to a native API. Impact is negligible (one-time scan), but this was the deciding factor against proceeding now.

### 2. Native APIs per OS (Windows: DirectWrite, macOS: CoreText, Linux: fontconfig)

- No new crate on Windows — the `windows` crate is already a dependency; would add the `Win32_Graphics_DirectWrite` feature and ~60–80 lines of COM/`unsafe` code.
- `IDWriteFontCollection::GetFontFamily` → `IDWriteFont::GetWeight()` (1–999), `GetStyle()`, `GetStretch()`.
- **Trade-off:** Windows-only unless implemented per-OS (CoreText on macOS, fontconfig on Linux). More code, more maintenance.

### 3. `font_loader` extended / alternative crate

- Current `font_loader` (v0.11) cannot expose weights — rejected.
- Other crates were not evaluated as better than `fontdb`.

### 4. JS-only: `queryLocalFonts()` (WebView2/Chromium)

- Exposes `family`, `weight`, `style` in the browser.
- **Trade-off:** requires a secure context **and a user permission prompt**, which is unreliable inside the Tauri WebView. Rejected.

---

## Decision (as of now)

**Deferred — not implemented.** The only cross-platform pure-Rust option (`fontdb`) scans font files directly instead of using the native OS font catalog, which was not deemed worth it for a weight selector. No code was changed; the existing `get_system_fonts` remains `Vec<String>`.

If the weight-selector feature becomes a priority, the preferred path is **native APIs per OS** (DirectWrite on Windows + fontconfig on Linux + CoreText on macOS), keeping `font_loader` only when font **bytes** are needed, and exposing a new `FontsAPI.listDetailed()` alongside the existing `list()` to avoid breaking modules.

---

## Contract Considerations (future work)

Changing `get_system_fonts` to return objects instead of `string[]` is a **breaking change** for the module contract:

- Lumen consumers: `src/modules/apis/fonts.ts`, `src/hooks/use-local-fonts.ts`.
- Installed modules (e.g., bible-module) call `fonts.list()` at `main.ts` and `store.ts`.
- A new command `get_system_fonts_detailed` (or a new `FontsAPI.listDetailed()` method) is the additive, non-breaking route: old modules keep working, new ones use the rich shape.

Proposed rich shape:

```ts
interface FontFamilyInfo {
  family: string;
  weights: number[];   // e.g. [100, 400, 700]
  styles: string[];    // e.g. ["normal", "italic"]
}
```