# Presentation Engine — Integration Plan

## Problem

`@aiden0z/pptx-renderer` (the current native PPTX renderer) is no longer maintained. While functional, it has limited fidelity and no future updates. Users who have Microsoft Office or LibreOffice installed get a subpar rendering experience despite having capable software available.

## Goal

Introduce a **pluggable presentation engine** that:

1. **Primary:** Uses Microsoft Office (COM) or LibreOffice (CLI) to export slides as PNG images, delivering maximum fidelity
2. **Fallback:** Uses the native `@aiden0z/pptx-renderer` when no external engine is available
3. **Unified UX:** The user controls everything through Lumen's existing UI — slides, thumbnails, navigation — regardless of which engine is active
4. **Zero runtime dependency:** Office/LibreOffice are invoked only during export and shut down immediately after

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Frontend (React)                           │
│                                                                  │
│  reveal-presentation.tsx                                         │
│    ├─ engine.type === 'native'   → <PptxViewerNative />          │
│    └─ engine.type === 'external' → <img src="slide-{n}.png" />   │
│                                                                  │
│  presentation.tsx (preview)                                      │
│    └─ thumbnails are just scaled PNGs from the export            │
│                                                                  │
│  presentation-store.ts (unchanged)                               │
│    └─ events: load, set-slide, slide-changed (engine-agnostic)   │
└──────────────────────┬───────────────────────────────────────────┘
                       ↕ events (existing)
┌──────────────────────┴───────────────────────────────────────────┐
│                      Rust Backend (Tauri)                        │
│                                                                  │
│  presentation_engine/                                            │
│    ├─ mod.rs          — Engine enum, detection, orchestration    │
│    ├─ libreoffice.rs  — soffice detection + --convert-to png     │
│    ├─ office_com.rs   — PowerPoint COM detection + PowerShell    │
│    └─ cache.rs        — Temp directory & slide cache management  │
│                                                                  │
│  presentation.rs (+ new commands)                                │
│    ├─ get_presentation_engine() → "libreoffice" | "office" |     │
│    │                              "native"                       │
│    └─ render_presentation_slides(path) → Vec<SlideImage>         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Engine Detection

### Auto-Detect Priority

When the user setting is `"auto"`, Lumen runs detection once per session (on first presentation open) following this priority:

```
1. Office COM (Windows only)  → best fidelity, user's likely preference
2. LibreOffice (all platforms) → good fidelity, free, cross-platform
3. Native (always available)   → no external dependency
```

The result is cached in `app.manage()` and rechecked only if the user explicitly triggers a re-scan.

### Detection Methods

| Engine | Detection Method | Platform |
|--------|-----------------|----------|
| Office COM | Try `CoCreateInstance` of `PowerPoint.Application` or check `HKCR\PowerPoint.Application\CLSID` | Windows only |
| LibreOffice | Test `soffice --version` via PATH + common install locations | All |
| Native | Always available (no detection needed) | All |

### Detection Implementations

```rust
pub enum EngineType {
    OfficeCom,
    LibreOffice,
    Native,
}

pub struct Engine {
    pub r#type: EngineType,
    pub version: Option<String>,
}

fn detect_engine(setting: &str) -> Engine {
    match setting {
        "office" => try_office(),
        "libreoffice" => try_libreoffice(),
        "native" => Engine { r#type: EngineType::Native, version: None },
        _ => {
            // auto: try office first, then LO, fallback to native
            try_office()
                .or_else(|| try_libreoffice())
                .unwrap_or(Engine { r#type: EngineType::Native, version: None })
        }
    }
}

#[cfg(target_os = "windows")]
fn try_office() -> Option<Engine> {
    // Try creating the COM object
    // If it succeeds, PowerPoint is installed
    None // stub
}

#[cfg(not(target_os = "windows"))]
fn try_office() -> Option<Engine> {
    None // Office is Windows-only
}

fn try_libreoffice() -> Option<Engine> {
    // Check PATH: where soffice (Windows) / which soffice (macOS/Linux)
    // Check common locations:
    //   Windows: C:\Program Files\LibreOffice\program\soffice.exe
    //   macOS: /Applications/LibreOffice.app/Contents/MacOS/soffice
    //   Linux: /usr/bin/soffice
    if std::process::Command::new("soffice")
        .arg("--version")
        .output()
        .is_ok()
    {
        Some(Engine { r#type: EngineType::LibreOffice, version: None })
    } else {
        None
    }
}
```

## Slide Export Flow

### LibreOffice

```
1. Build temp dir: os::temp_dir() / "lumen-presentation-{uuid}"/
2. Spawn: soffice --headless --convert-to png --outdir "{temp_dir}" "{file_path}"
3. Wait for process to complete (with timeout: 30s)
4. Read generated PNG files from temp_dir
5. Return sorted list: ["slide-1.png", "slide-2.png", ...]
```

`soffice --convert-to png` generates files named `{basename}-1.png`, `{basename}-2.png`, etc.

**Edge cases:**
- `.ppt` (old format): LO handles conversion automatically
- Password-protected files: LO will fail gracefully → fallback to native engine
- Corrupted files: LO error output is captured and surfaced to user

### Office COM (Windows)

Since `windows-rs` 0.58 does not include PowerPoint type library bindings, use a PowerShell bridge:

```powershell
# embedded as a resource string in Rust, extracted to temp at runtime
param([string]$Path, [string]$OutDir)

$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = $false
$pres = $ppt.Presentations.Open($Path, $true, $false, $false)
$count = $pres.Slides.Count

for ($i = 1; $i -le $count; $i++) {
    $filename = Join-Path $OutDir "slide-$i.png"
    $pres.Slides($i).Export($filename, "PNG")
}

$pres.Close()
$ppt.Quit()

Write-Output "Exported $count slides"
```

**Rust invocation:**

```rust
fn export_via_office(path: &str, out_dir: &Path) -> Result<Vec<PathBuf>> {
    let script = extract_embedded_ps1()?;
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-File", &script, path, out_dir.to_str().unwrap()])
        .output()?;
    // Parse output, read slide PNGs from out_dir
}
```

**Edge cases:**
- PowerPoint not installed: detection skips this engine
- PowerPoint already open by user: opening a second instance may fail → fallback to LibreOffice or native
- File opened read-only: PowerPoint may show a dialog — use `WithWindow: = msoFalse` and suppress alerts

### Caching

Exporting all slides on every open is wasteful. Implement a simple content-addressable cache:

```rust
struct SlideCache {
    /// Key: hash of file content (blake3)
    /// Value: path to cached PNG directory
    store: HashMap<String, PathBuf>,
}
```

- On `render_presentation_slides(path)`: compute `blake3::hash(file_bytes)` → check cache → export if miss
- Cache lives in `{app_data}/presentation-cache/`
- LRU eviction: max 500MB of cached slides
- Cache entries are invalidated when file content changes (hash mismatch)

## Frontend Changes

### `reveal-presentation.tsx`

Becomes an adapter that renders based on engine type:

```tsx
interface PresentationEngine {
  type: 'native' | 'external';
  slides: string[];       // PNG data URLs or file paths
  slideCount: number;
}

function PptxPresentation({ filePath, initialSlide }: Props) {
  const engine = usePresentationEngine(filePath);

  if (engine.type === 'native') {
    return <PptxViewerNative filePath={filePath} />; // current implementation
  }

  // External engine: display pre-rendered PNGs
  const [current, setCurrent] = useState(initialSlide);
  return (
    <div className="h-full w-full bg-black flex items-center justify-center">
      <img
        src={engine.slides[current]}
        className="max-h-full max-w-full object-contain"
        alt={`Slide ${current + 1}`}
      />
    </div>
  );
}
```

### `presentation.tsx` (preview)

With external engines, thumbnails are trivial — just use the same PNGs at a smaller scale. No need for `PptxViewer.open()` + `html-to-image` conversion. The thumbnails are ready immediately after export.

When using native fallback, keep the existing thumbnail generation logic.

### `presentation-store.ts`

No changes needed. Events (`presentation:load`, `presentation:set-slide`, `presentation:slide-changed`) are engine-agnostic.

## New Tauri Commands

```rust
#[tauri::command]
fn get_presentation_engine() -> EngineInfo;
// Returns: { type: "libreoffice" | "office" | "native", version: Option<string> }

#[tauri::command]
async fn render_presentation_slides(path: String) -> Result<Vec<SlideImage>, String>;
// Returns: [{ index: 0, data_url: "data:image/png;base64,..." }, ...]
// or: [{ index: 0, path: "/tmp/lumen/.../slide-1.png" }, ...]

#[tauri::command]
fn clear_presentation_cache() -> Result<(), String>;
// Clears all cached slide images
```

## Settings

### Settings UI

Add a **Presentation Engine** dropdown in the settings modal under a "Presentations" section:

```
┌──────────────────────────────────────────────────┐
│  Presentations                                    │
│                                                   │
│  Presentation Engine  [ Auto (Office)      ▼ ]    │
│                        ┌─────────────────────┐   │
│                        │ Auto (Office)       │   │
│                        │ Auto (LibreOffice)  │   │
│                        │ Auto (Native)       │   │
│                        │ Office              │   │
│                        │ LibreOffice         │   │
│                        │ Native              │   │
│                        └─────────────────────┘   │
│                                                   │
│  ✓ Office detected (PowerPoint 2021)              │
│                                                   │
│  [Clear slide cache (3.2 MB)]                     │
└──────────────────────────────────────────────────┘
```

The dropdown shows **both** the selected mode and the resolved engine in parentheses. Below it, a status line indicates what was detected:

| Status Message | Meaning |
|----------------|---------|
| ✓ Office detected (PowerPoint 2021) | Office found, being used |
| ✓ LibreOffice detected (24.2.4) | LO found, Office not available |
| ○ Using native renderer (no external engine detected) | Fallback active |
| ✓ Office detected | Overridden to Office via manual selection |
| ✓ LibreOffice detected | Overridden to LO via manual selection |
| ○ Using native renderer | Manual selection of native |

### Settings Backend

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `presentation_engine` | string | `"auto"` | `"auto"` / `"office"` / `"libreoffice"` / `"native"` |
| `presentation_cache_enabled` | bool | true | Cache exported slides on disk |

When set to `"auto"`, the `detect_engine()` function runs and resolves to the best available engine. The resolved engine is exposed to the frontend via `get_presentation_engine()` so the UI can display the effective engine.

### Re-Detection

The user can trigger re-detection by:
1. Changing the dropdown to a specific engine (immediate switch)
2. Changing back to `"auto"` (re-runs detection)
3. Clicking a "Re-scan system" button in settings

Re-detection is useful when the user installs Office/LO while Lumen is already running.

## Migration Path

1. **Phase 1** — Add the engine abstraction + detection logic. The native renderer remains the only engine. No functional change yet.
2. **Phase 2** — Implement LibreOffice `--convert-to png` export. Detect LO, use it as primary on supporting systems.
3. **Phase 3** — Implement Office COM via PowerShell bridge. Windows-only, secondary priority.
4. **Phase 4** — Add cache layer + settings UI for engine preference + detection status.

## File Changes Summary

| File | Change | Est. Lines |
|------|--------|------------|
| `src-tauri/src/presentation_engine/mod.rs` | **New** — Engine enum, detection, dispatch | ~80 |
| `src-tauri/src/presentation_engine/libreoffice.rs` | **New** — LO detection + CLI export | ~180 |
| `src-tauri/src/presentation_engine/office_com.rs` | **New** — COM detection + PowerShell bridge | ~200 |
| `src-tauri/src/presentation_engine/cache.rs` | **New** — File hash, temp dir, LRU cache | ~80 |
| `src-tauri/src/presentation.rs` | **Modify** — Add 2-3 new commands | ~+100 |
| `src-tauri/src/main.rs` | **Modify** — Register `presentation_engine` module | ~+5 |
| `src/components/reveal-presentation.tsx` | **Modify** — Adapter for native vs image-based rendering | ~80 |
| `src/app/_layout/presentation.tsx` | **Modify** — Thumbnails from PNGs when external engine | ~30 |
| `src/stores/presentation-store.ts` | No change | 0 |

**Total Rust additions: ~550-650 lines**
**Total Frontend changes: ~100 lines**

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `soffice` not in PATH or not installed | LO engine unavailable | Detection fails gracefully, falls back to native |
| LibreOffice home dir lock (`~/.libreoffice/.~lock.*`) | Export hangs | Pass `-env:UserInstallation=file:///{tempdir}` to use isolated profile |
| PowerPoint shows modal dialog during export | Export hangs | Use `$ppt.DisplayAlerts = $false` in PowerShell |
| Large presentation (100+ slides) export time | Slow open (~15-30s) | Show progress bar + export on background thread; cache avoids repeat cost |
| Office COM fails on non-Windows | Engine unavailable | Conditional compilation: `office_com` module is Windows-only |
| User uninstalls Office/LO between sessions | Cached slides stale but engine now unavailable | Re-detect on cache miss, not on app start |
| User installs Office/LO while Lumen is running | Engine not detected until restart | "Re-scan system" button in settings triggers re-detection |
| Corrupted PPTX crashes `soffice` | Export fails | Catch process exit code, parse stderr, fallback to native |
| User forces an engine that isn't installed | Export fails every time | Validate setting on change: show warning if selected engine is unavailable |
