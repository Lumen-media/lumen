# Presenter PPT/PPTX — Architecture

## Overview

PowerPoint (.ppt/.pptx) presentation system using `pptx-browser` for canvas rendering and `reveal.js` as the navigation deck. Text extraction for search is handled via Rust (Tauri command) at import time.

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Rendering | `pptx-browser` (JS) | Parses PPTX and renders slides to Canvas |
| Deck/Navigation | `@revealjs/react` + `reveal.js` | Transitions, keyboard nav, fullscreen |
| Text extraction | Rust (`quick-xml`) | Extracts slide text from XML to index in DB |
| Persistence | SQLite (existing) | `content` column stores extracted text for search |
| Visual storage | Blob URLs (memory) | Thumbnails and slides are canvas → blob URL, no disk cache |
| Cross-window comm | Tauri Events | Main window ↔ Media window |

## Data Flow

### File import

```
User → MediaPanel → FileMgmtService → Rust (extract_presentation_metadata)
                                         │
                                         ├── Open ZIP
                                         ├── Read ppt/presentation.xml → title
                                         ├── Count ppt/slides/slide*.xml → slide_count
                                         └── Extract text from <a:t> tags → slides[{index, text}]
                                         │
                                         ▼
                                      SQLite
                                         INSERT INTO media_files (content = concatenated text)
```

### Opening a presentation

```
MainWindow                              MediaWindow
    │                                        │
    ├── presentationStore.load(path)          │
    ├── Tauri 'presentation:load' ──────────► │
    │                                        ├── readFile(path) → Uint8Array
    │                                        ├── PptxRenderer.load()
    │                                        ├── renderAllSlides(1920) → canvases
    │                                        ├── canvas.toBlob() → blob URLs
    │                                        ├── <Deck> with <Slide backgroundImage={url}>
    │                                        ├── Generate thumbs (320px) → blob URLs
    │◄── Tauri 'presentation:thumbnails-ready' ──┤
    │◄── Tauri 'presentation:slide-changed' ────┤
    │                                        │
    ├── presenter-controls updates UI        │
    └── _layout/presentation.tsx shows       │
        thumbnail strip                      │
```

### Navigation

```
User → PresenterControls → setSlide(index) → Tauri 'presentation:set-slide'
                                                              │
                                                              ▼
                                                         MediaWindow
                                                              │
                                                         deckRef.slide(index)
                                                              │
                                                         onSlideChange
                                                              │
                                              Tauri 'presentation:slide-changed' ◄──
                                                              │
                                                              ▼
                                                         MainWindow
                                                              │
                                              presenter-controls + _layout update
```

### Closing

```
User → PresenterControls → clearPresentation() → Tauri 'presentation:clear'
                                                              │
                                                              ▼
                                                         MediaWindow
                                                              │
                                                         renderer.destroy()
                                                         Remove RevealPresentation from DOM
                                                         Revoke blob URLs
                                                              │
                                              Tauri 'presentation:slide-changed' {0, 0} ◄──
```

## File Structure

### New files

| File | Description |
|------|-------------|
| `src/components/reveal-presentation.tsx` | React component integrating pptx-browser + reveal.js |
| `src/stores/presentation-store.ts` | Zustand store for presentation state |
| `src-tauri/src/presentation.rs` | Rust command for text/metadata extraction from PPTX |

### Modified files

| File | Change |
|------|--------|
| `src/services/types.ts` | Add `'presentation'` to `MediaType` union |
| `src/services/file-management-service.ts` | `EXTENSION_MAP.presentation = ['.ppt', '.pptx']` |
| `src/services/file-init-service.ts` | Add `'presentation'` to `MEDIA_TYPES` |
| `src/services/media-db-service.ts` | Indexes `idx_mf_content` + `idx_mf_type_content` + wire extraction in `syncMediaType`/`insertFile` |
| `src/components/file-list-item.tsx` | `Presentation` icon for the type |
| `src/components/media-panel.tsx` | "Presentation" grid item + double-click handler |
| `src/components/presenter-controls.tsx` | Replace fallback slides with real store data |
| `src/app/media-window.tsx` | Add presentation mode + render `<RevealPresentation>` |
| `src/app/_layout/presentation.tsx` | Hybrid implementation (file selector ↔ thumb strip) |
| `src-tauri/src/main.rs` | Register `mod presentation` and the command |
| `src-tauri/Cargo.toml` | Add `quick-xml` |

## Database

The existing `media_files` table already has a `content` column. We only add:

```sql
CREATE INDEX IF NOT EXISTS idx_mf_content ON media_files (content);
CREATE INDEX IF NOT EXISTS idx_mf_type_content ON media_files (media_type, content);
```

`slide_count` is **not stored in the DB** — it's obtained at runtime from `pptx-browser.renderer.slideCount` to avoid stale data if the file is modified externally.

Rust text extraction happens **once at import time** (`syncMediaType`/`insertFile`). The text is stored in the `content` column and used by the existing search (`LIKE` queries in `search-service.ts`). If the file is modified externally, the indexed text becomes stale until the next app restart (when `syncMediaType` runs again).

## Tauri Events

| Event | Direction | Payload | Triggered by |
|-------|-----------|---------|--------------|
| `presentation:load` | main → media | `{ filePath: string, fileName: string }` | `loadPresentation()` |
| `presentation:set-slide` | main → media | `{ index: number }` | `setSlide()`, `nextSlide()`, `prevSlide()` |
| `presentation:slide-changed` | media → main | `{ currentSlide: number, totalSlides: number }` | reveal.js `onSlideChange` |
| `presentation:thumbnails-ready` | media → main | `{ thumbs: string[] }` | `RevealPresentation` after generating thumbs |
| `presentation:clear` | main → media | `{}` | `clearPresentation()` |

## Rust Command

```rust
// src-tauri/src/presentation.rs

#[derive(Serialize)]
struct SlideText {
    index: u32,
    text: String,
}

#[derive(Serialize)]
struct PresentationMeta {
    slide_count: u32,
    slides: Vec<SlideText>,
    title: Option<String>,
}

#[tauri::command]
fn extract_presentation_metadata(path: String) -> Result<PresentationMeta, String>
```

- Opens the file as a ZIP archive
- Reads `ppt/presentation.xml` for the title
- Lists `ppt/slides/slide*.xml` for the count
- Extracts text from each `<a:t>` XML tag
- Concatenates texts separated by slide for `content` storage
- Returns metadata + slides

## RevealPresentation Component

```typescript
// src/components/reveal-presentation.tsx

interface RevealPresentationProps {
  filePath: string
}
```

**Lifecycle:**

1. `useEffect`: read file via `readFile` → `Uint8Array`
2. `PptxRenderer.load()` → `renderAllSlides(1920)` → `canvas.toBlob()`
3. Store blob URLs in local state + generate thumbnails (width=320)
4. Emit thumbnails via `'presentation:thumbnails-ready'`
5. Render `<Deck config={{ transition: 'slide', width: 1920, height: 1080 }}>`
6. Each slide: `<Slide backgroundImage={blobUrl} backgroundSize="contain" />`
7. Listener for `'presentation:set-slide'` → `deckRef.current.slide(index)`
8. `onSlideChange` → emit `'presentation:slide-changed'`
9. `onUnmount`: `renderer.destroy()` + revoke blob URLs

## Considerations

- **thumbnails vs icons**: the existing `thumbnailService` doesn't support PPTX (falls back to icon). Visual slide thumbnails are generated exclusively by pptx-browser on the frontend, converting a reduced canvas (320px) to a blob URL.
- **stale search data**: extracted text is only updated at import time. If the PPTX is modified externally, the indexed search data becomes stale. Acceptable for v1.
- **minimal Rust**: only text extraction + metadata. Visual rendering is 100% JS (pptx-browser).
- **no disk cache for slides**: rendered slides exist only as blob URLs in memory. Lost on app close, which is acceptable.
