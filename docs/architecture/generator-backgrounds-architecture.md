# Generator Backgrounds — Architecture

> Status: **implemented, with pending items** — see [§18 Status](#18-status-shipped-vs-pending) for what is live and what is still a plan.
> Related: [Feature plan](./generator-backgrounds-plan.md) · [Phase 0 spike](./generator-backgrounds-spike.md) · [Usage guide](../usability/generator-backgrounds-usage.md)

## 1. Constraints from the current code

These facts drive every decision below.

1. **Backgrounds are strings today.** `DefaultBackground { type, src, name }` (Rust, `profiles.rs`), lyric metadata `globalBackground: String`, per-slide `background: Option<String>` (`<!-- bg: ... -->`), and `SlideUpdate.background: Option<String>` (`streaming/html_server.rs`). Any new type must either fit this shape or extend it compatibly.
2. **Backgrounds render in the webview.** `MarkdownPresentation` renders `<img>` layers behind DOM text; the presenter module renders `<img>`/`<video>`; the HTML server applies a CSS `url(...)`. Slides and lyrics are DOM, so a background layer must sit **inside the same webview, behind the DOM**.
3. **The same background must appear in several windows.** Main preview, media/output window, presenter backdrop, mobile HTML page, and WebRTC capture. Duplicated rendering is expected; the design must keep the cost bounded.
4. **WebRTC mirrors window pixels.** `app_preview_producer` captures the app window, so anything drawn in the media window is streamed automatically, with no extra integration.
5. **Tauri commands are snake_case and return serde types.** Profiles are JSON files under `<base>/config/profiles/`. Presets should follow the same pattern.
6. **No audio pipeline exists and none is wanted.** Everything is time-driven.

## 2. Render host decision

The requirement "logic in Rust" and the requirement "background behind DOM text" pull in different directions. The realistic options:

### Option A — Shader host in the webview (WebGL2), definitions in Rust

Rust owns the effect catalog, parameter schema, shader prelude/assembly, validation and presets. The webview compiles the shader and draws it to a `<canvas>` behind the DOM.

| Pros | Cons |
|---|---|
| Works with DOM/text/slides with zero compositing work | Per-frame rasterization is not executed by Rust |
| Cross-platform (WebView2, WKWebView, WebKitGTK) | Each surface renders independently |
| Works in the mobile HTML page with the same shader | Tier 2 simulations are awkward (many passes) |
| 4K60 fine for fragment-shader effects | Requires a WebGL2 → GLSL path |

### Option B — Rust renders offscreen (wgpu) and ships frames to the webview

Rust renders every frame, then the webview displays it (shared memory + canvas upload, or an encoded stream).

| Pros | Cons |
|---|---|
| Rust truly renders every frame | 4K RGBA is ~33 MB/frame → ~2 GB/s at 60 fps; not viable over IPC |
| Single renderer shared by all surfaces | Encoding/decoding adds latency and artifacts |
| Tier 2 easy | Defeats the "no video pipeline" constraint |

### Option C — Native wgpu surface behind a transparent webview

A Rust-owned native layer is placed behind the media window's transparent webview, so DOM text composites over it.

| Pros | Cons |
|---|---|
| Best performance and quality; Tier 2 trivial | Platform-specific window/child-HWND handling |
| Single renderer | Transparent webview + native surface is fragile across OSes |
| | Does not solve the mobile HTML page at all |

### Recommendation

**Option A for v1.** It satisfies every surface (including mobile), keeps the DOM model intact, and is cheap for Tier 0/Tier 1. Rust remains the source of truth for effect definitions, parameters, presets, shader assembly and timing. Option C stays as a Phase 3+ "pro output" path if Tier 2 effects or 4K multi-surface cost demand it, reusing the same WGSL sources.

If a future version needs Rust executing per-frame simulation logic, the middle ground is **Rust compiled to WASM** inside the webview: the shader draws, the WASM module owns particle/agent state. That is a Phase 3 option for Tier 2, not part of v1.

### Shader language

- Author effects in **WGSL** (future-proof for a native `wgpu` host).
- Validate and convert to **GLSL ES 3.00** with the `naga` crate at runtime (cached for the session). The frontend receives GLSL and compiles it in WebGL2.
- Fallback: if a shader fails conversion/compilation, the effect is marked unavailable with a readable error and the surface keeps the previous background.
- The Phase 0 spike must verify naga conversion quality on at least 5 effects before this is locked. If it proves flaky, author in GLSL ES 3.00 and treat WGSL as the future path instead; the rest of the architecture is unchanged.

> WebGPU may be used as an optimization when the platform exposes it, but it is **not** the baseline. WebGL2 is the guaranteed target.

## 3. System overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Rust (src-tauri)                                                          │
│                                                                           │
│  backgrounds/      → catalog, WGSL sources, GLSL compilation               │
│    schema.rs       → EffectDef, ParamSpec, ParamValue, PassDef            │
│    prelude.wgsl    → shared uniforms + noise/palette helpers              │
│    effects/*.wgsl  → effect body per effect                               │
│    compile.rs      → naga validate + WGSL → GLSL ES 3.0 (cached)          │
│    mod.rs          → catalog + bundle generation                          │
│                                                                           │
│  background_presets.rs     → user presets under config/background-presets/│
│  streaming/html_server.rs → media backgrounds; generator → palette poster │
│  profiles.rs              → DefaultBackground extended (media + generator)│
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ example: cargo run --example bg_compile
                                │ writes:  src/backgrounds/generated/catalog.ts
┌───────────────────────────────▼───────────────────────────────────────────┐
│ Frontend (React)                                                          │
│                                                                           │
│  backgrounds/                                                             │
│    types.ts        → Background union (media | generator)                 │
│    generated/catalog.ts → effect catalog + GLSL emitted by Rust           │
│    gl-engine.ts    → WebGL2 renderer (program cache, FBOs, uniforms)      │
│    params.ts       → default filling + clamping from the catalog          │
│    clock.ts        → shared phase helpers (not wired yet)                 │
│    uri.ts          → encode/decode lumen-bg:// refs + mediaSrcOf          │
│    presets.ts      → calls into Rust preset commands                      │
│    presets-store.ts→ shared preset list (zustand)                         │
│    components/BackgroundLayer.tsx    → canvas + rAF loop                  │
│    components/GeneratorSurface.tsx   → live surface + static poster       │
│                                                                           │
│  components/generator-presets-dialog.tsx → Tools → Generators             │
│  components/lyric-background-modal.tsx   → presets in the Themes tab      │
│                                                                           │
│  Used by: MarkdownPresentation, presenter backdrop, notices, edit,        │
│           settings preview, media-window, module presenter slot           │
└───────────────────────────────────────────────────────────────────────────┘
```

## 4. Effect model

An effect is **data**, not a trait object. This keeps the catalog serializable to the frontend and trivially extensible. The effect list itself (Tiers 0–2, parameters per effect) lives in [Section 5 of the plan](./generator-backgrounds-plan.md#5-effect-catalog).

```rust
// backgrounds/schema.rs

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EffectDef {
    pub id: &'static str,            // "aurora"
    pub name: &'static str,          // "Aurora"
    pub category: Category,          // Gradients | Particles | Geometry | ...
    pub tier: u8,                    // 0 = fragment only, 1 = feedback, 2 = simulation
    pub version: u32,                // bump when params/shader change
    pub passes: &'static [PassDef],  // 1 for Tier 0
    pub params: &'static [ParamSpec],
    pub cost: CostHint,              // Low | Medium | High (drives defaults)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PassDef {
    pub id: &'static str,            // "main", "update", "display"
    pub source: &'static str,        // WGSL body (include_str!)
    pub feedback: bool,              // reads the previous frame's target
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParamSpec {
    pub key: &'static str,           // "speed"
    pub label: &'static str,         // "Speed"
    pub kind: ParamKind,             // Float | Int | Bool | Color | Enum | Seed
    pub default: ParamValue,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub scale: ParamScale,           // Linear | Log (slider mapping)
    pub group: ParamGroup,           // Motion | Shape | Color | Advanced
    pub uniform: &'static str,       // "u_speed"
    pub options: &'static [EnumOption], // for Enum
}
```

The catalog is a `static CATALOG: &[EffectDef]` in `catalog.rs`. Shaders live in `.wgsl` files and are embedded with `include_str!`, so they ship inside the binary and can never be swapped at runtime by user content.

### Shader assembly

Each effect body is prepended with a shared prelude by Rust:

```wgsl
// backgrounds/prelude.wgsl (conceptual)
struct Params {
  u_time: f32,
  u_dt: f32,
  u_resolution: vec2<f32>,
  u_seed: f32,
  u_speed: f32,
  u_scale: f32,
  u_intensity: f32,
  u_color_a: vec4<f32>,
  u_color_b: vec4<f32>,
  u_extra: array<vec4<f32>, 4>,
};
@group(0) @binding(0) var<uniform> P: Params;

fn hash11(n: f32) -> f32 { /* ... */ }
fn noise2(p: vec2<f32>) -> f32 { /* simplex/value noise ... */ }
fn palette(t: f32) -> vec3<f32> { /* mix(u_color_a, u_color_b) ... */ }
```

The assembled string is what gets converted to GLSL and compiled. This is where Rust adds value beyond a static GLSL blob: shared noise, palette handling, uniforms and validation live in one place.

### Tiers

| Tier | Definition | Examples | Host cost |
|---|---|---|---|
| 0 | Single fragment pass, stateless | aurora, waves, starfield | Low |
| 1 | Ping-pong feedback between two textures | smoke, trails, pixel sorting | Medium |
| 2 | Many-pass simulation / agent state | reaction-diffusion, boids, fluid | High — Phase 3 |

## 5. Parameter model

### Common parameters (engine-injected)

Every effect gets these without declaring them; they appear in the UI and map to reserved uniforms.

| Key | Uniform | Kind | Default | Range | Group |
|---|---|---|---|---|---|
| `speed` | `u_speed` | Float | 1 | 0–4, log | Motion |
| `scale` | `u_scale` | Float | 1 | 0.1–4, log | Shape |
| `intensity` | `u_intensity` | Float | 1 | 0–1.5 | Shape |
| `seed` | `u_seed` | Seed | random | 0–9999 | Advanced |
| `colorA` | `u_color_a` | Color | theme-aware | — | Color |
| `colorB` | `u_color_b` | Color | theme-aware | — | Color |

Theme-aware defaults mean a generator drops into light and dark profiles without looking wrong.

### Effect-specific parameters

Declared per effect and auto-rendered:

- **Float** → slider (linear or log), with min/max/step.
- **Int** → stepped slider or stepper.
- **Bool** → switch.
- **Enum** → segmented control.
- **Color** → color picker.
- **Seed** → number + dice button.

Custom values are packed into `u_extra` (4 `vec4`, i.e. 16 floats) in declaration order. If an effect needs more, another `vec4` array is added; the prelude caps it and validation rejects overflow at startup.

### Slider semantics

- `Linear` maps the slider 1:1 to the uniform.
- `Log` maps the slider position exponentially; used for speed/scale/density where perceptual change is multiplicative.
- Values are always clamped to `[min, max]` before upload and before persistence.
- Persisted values are validated against the current schema on load. Unknown keys are dropped; missing keys fall back to defaults. This makes effect `version` bumps safe.

## 6. Runtime: time, seeds, feedback

### Time

> **Shipped vs planned:** today each surface integrates its own phase inside its rAF loop (`phase += dt * speed`). The shared-clock protocol below exists as helpers in `src/backgrounds/clock.ts` but is **not emitted or consumed yet**, so previews and the output are not phase-locked.

- A single **shared phase** is authoritative in the main window: `phase += dt * speed`.
- Every second (and immediately on any change) the main window emits:

```ts
// event: background:clock
{ phaseSeconds: number, speed: number, sentAt: number }
```

- Surfaces compute `t = phaseSeconds + ((performance.now() - sentAt) / 1000) * speed`.
- This keeps preview and output visually aligned and makes speed changes smooth (no phase jump).
- Tier 0 effects are fully deterministic per `(seed, t)`.
- Tier 1+ effects integrate per surface using a **fixed timestep accumulator** (e.g. 1/60 s), so different frame rates do not change the simulation behavior. Stateful simulations are not guaranteed phase-identical across windows; the UI should not imply they are.

### Seeds

- Seed is part of the background ref and persisted.
- "Randomize" produces a new seed; the same seed reproduces the same look on every surface and after reload.
- Seeds are integers (0–9999 in the UI, full `u32` internally).

### Feedback / anti-degeneration

Tier 1 effects use two render targets and swap each frame. Infinite runtime means they can drift or saturate. Every Tier 1 effect must declare one strategy:

| Strategy | Use |
|---|---|
| `decay` | Blend previous frame at `1 - decay`; keeps trails from filling |
| `normalize` | Periodic pass that rescales range |
| `reseed` | Softly restart every N seconds (invisible fade) |
| `inject` | Add low-amplitude noise so cellular/stable systems keep moving |

The strategy is part of `PassDef`/effect metadata, not something the UI exposes (except maybe a "reset" button).

## 7. Frontend renderer

### `<BackgroundLayer>`

A single component replaces every current `<img>`/`<video>` background call site:

```tsx
<BackgroundLayer
  effectId={background.effect}
  params={background.params}
  seed={background.seed}
  maxFps={60}
  resolutionScale={1}
  paused={blackoutActive}
  className="absolute inset-0 z-0"
/>
```

The layer renders **generators only**; media backgrounds keep their existing `<img>` / `<video>` call sites, and `GeneratorSurface` / `GeneratorPoster` wrap the layer for the generator cases.

Responsibilities (shipped):

- For generators: mount a `<canvas>`, acquire WebGL2, compile/cache the program, run the rAF loop.
- Pause on `paused` and when `document.hidden`.
- Resize via `ResizeObserver`, capped by `devicePixelRatio` and `resolutionScale`.
- `webglcontextlost` hides the canvas and leaves the palette gradient; `webglcontextrestored` re-initializes resources.

Still planned:

- IntersectionObserver / minimized / blackout-aware pausing beyond the `paused` prop.
- Crossfade between the previous and next background (~250 ms).
- A `quality` prop (auto | high | balanced | performance) driving `resolutionScale` and `maxFps`.
- Retry-after-loss beyond the single restore event.

### `gl-engine.ts`

| Responsibility | Detail |
|---|---|
| Context | `webgl2`, `{ alpha: false, antialias: false, desynchronized: true, powerPreference: 'high-performance' }` |
| Geometry | Full-screen triangle (one draw call) |
| Program cache | Keyed by effect id + version |
| Uniforms | Common block + `u_extra` packed from params |
| FBOs | Ping-pong pair for feedback passes, sized to `resolutionScale` |
| FPS cap | rAF accumulator against `maxFps` |
| Adaptive quality | Measure frame time; drop `resolutionScale` one step after sustained over-budget frames |
| Failure | No WebGL2 → static poster (palette gradient), log once, never throw in render |

### Resolution convention

Shaders receive normalized UVs; `u_resolution` is provided for aspect correction. Effects must use `uv * vec2(aspect, 1.0)` (or equivalent) so the look is resolution- and aspect-independent. QC must check 16:9, 16:10 and ultrawide.

## 8. Rust engine

### Commands

| Command | Returns | Notes |
|---|---|---|
| `bg_effect_list()` | `Vec<EffectDef>` incl. assembled GLSL | Cached per session in Rust and in the frontend registry |
| `bg_preset_list()` | `Vec<Preset>` | Reads `config/background-presets/*.json` |
| `bg_preset_save(preset)` | `()` | Same pattern as profiles |
| `bg_preset_delete(id)` | `()` | Silent when missing |

If the payload grows (many effects), switch to a custom protocol `lumen-bg://effect/<id>.glsl`; for 10–30 effects a one-shot IPC list is enough.

### Compilation

```
WGSL body ──► prelude + body ──► naga parse/validate ──► GLSL ES 3.00 ──► frontend compile
```

- Validation happens once at startup (and in tests), so a broken shader fails in CI, not on stage.
- The converted GLSL is cached in a `OnceCell`/`Mutex<HashMap>` keyed by effect id + version.
- Errors are surfaced as an unavailable effect with a reason; the rest of the catalog still works.

### Presets

- Stored as pretty-printed JSON, one file per preset, under `<base>/config/background-presets/`.
- Shape mirrors the frontend: `{ id, name, effect, params, seed, createdAt }`.
- Built-in presets live in the binary and are merged with user presets (user wins on id).
- Presets never embed shader code.

## 9. Persistence and data model

### Frontend

```ts
// backgrounds/types.ts

export type ParamValue = number | boolean | string;

export type MediaBackground = {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
};

export type GeneratorBackground = {
  type: 'generator';
  effect: string;                        // registry id
  params: Record<string, ParamValue>;    // only overrides; defaults filled on load
  seed: number;
  name: string;                          // display name, derived or custom
  preset?: string;                       // optional origin preset
};

export type Background = MediaBackground | GeneratorBackground;
```

`SelectedBackground` in `src/modules/types.ts` and `lyric-background-modal.tsx` is extended with the same union, so modules and pickers keep working.

### Rust

Replace the flat struct with a tagged enum that remains backward compatible:

```rust
#[derive(Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Background {
    #[serde(rename = "theme")]
    Theme { src: String, name: String },
    #[serde(rename = "image")]
    Image { src: String, name: String },
    #[serde(rename = "video")]
    Video { src: String, name: String },
    #[serde(rename = "generator")]
    Generator {
        effect: String,
        params: serde_json::Map<String, serde_json::Value>,
        seed: u32,
        name: String,
        #[serde(default)]
        preset: Option<String>,
    },
}
```

Old profile files (`{ "type": "image", "src": "...", "name": "..." }`) deserialize into the matching variants unchanged.

> **Shipped:** the tagged enum above was not needed. `DefaultBackground` in `profiles.rs` was extended in place — `src`/`name` stay, plus optional `effect`, `params`, `seed` and `preset` — so old profile files deserialize unchanged and generators fit the existing struct. Profile defaults and per-slide generators both work; the lyric/stream boundaries keep carrying a `lumen-bg://` URI.

### String-only boundaries

Lyric files and stream payloads still carry a **string**. A URI encodes the generator ref:

```
lumen-bg://generator/<effect>?v=1&seed=<u32>&p=<base64url(JSON params)>
```

- `effect` is URL-safe and validated against the registry.
- `p` is base64url-encoded JSON; keeps the format opaque to lyric/stream plumbing.
- `name` is not encoded; it is derived from the effect definition.
- `decode()` is tolerant: unknown/malformed parts fall back to no background, never to an exception.

Used in:

| Boundary | Field |
|---|---|
| Lyric metadata | `globalBackground` |
| Lyric slide | `<!-- bg: lumen-bg://... -->` |
| Stream push | `SlideUpdate.background` |
| HTML server payload | `background` |

Profiles and app state use the structured object; the URI exists only where the transport is a string.

### Migration

- No file rewrite. Old values parse as before.
- Frontend `parseBackground(value)` centralizes "string → Background"; every render site uses it.
- Rust validates stream payloads before forwarding (clamp params, reject unknown effects).
- Analyzer/test: a fixture set of old profiles and lyric files must load with identical behavior.

## 10. Surfaces

| Surface | Instance | Resolution | FPS | Notes |
|---|---|---|---|---|
| Main window previews (edit, presentation, settings, notices) | own | min(960, container) | 30 | Low cost, many mounted |
| Media/output window | own | display resolution (cap 1440p by default) | 60 | Full quality |
| Presenter module backdrop | own | container | 30 | Only when a module is presenting |
| HTML server (mobile) | — | — | — | **Out of v1 scope.** No WebGL runtime; a generator ref degrades to a static gradient/theme poster |
| WebRTC app preview | captured | capture config | capture FPS | Free once the window renders |
| WebRTC main stream | captured | capture config | up to 60 | Free |

### HTML server integration (poster only)

Generators stay **desktop-only**. The HTML server keeps rendering media backgrounds with its current CSS `url(...)`.

- `SlideUpdate.background` stays a string. A `lumen-bg://` value is never proxied or interpreted as a URL by the page: `generatorPoster()` in `html_server.rs` decodes the `p` payload and renders a **static CSS gradient poster** from `colorA`/`colorB`, or the profile theme color when no palette is present.
- No WebGL runtime, no `/bg/*` routes and no shader payload in v1, so mobile battery and the limited HTML page runtime stay untouched.
- The stream payload stays small: the URI (plus palette) is the only generator data on the wire.
- The full mobile runtime design (serve `/bg/runtime.js` + `/bg/effect/<id>`, gradient fallback) is deferred with the rest of the mobile work (Section 17).

### WebRTC

No change. Window capture already includes the canvas. Mobile WebRTC preview is 1 fps by design, so generators look choppy there; the HTML server is the right path for smooth mobile previews.

## 11. Performance strategy

| Lever | Action |
|---|---|
| Render duplication | Only the output window runs full resolution; previews are capped and lower-res |
| Resolution scale | 0.5 / 0.75 / 1.0 per surface, auto-tuned from frame time |
| FPS cap | 30 preview / 60 output / configurable mobile |
| Visibility | Pause when hidden, minimized, blackout, or off-screen |
| Effect cost hint | `Low/Medium/High` sets default scale and FPS |
| Context loss | Recover once, then fall back to poster |
| Long sessions | Tier 1 effects must declare an anti-degeneration strategy (Section 6) |
| Thermal | "Performance" quality mode reduces scale/FPS globally |

Target budget at 1080p: **< 4 ms GPU per surface** for Tier 0, so two surfaces fit comfortably in 60 fps. The spike measures this before Phase 1.

## 12. Security

- Shaders ship inside the app binary. User content (lyric files, profiles, stream payloads) can only reference **known effect ids** and numeric/boolean/color params.
- No `eval` of shader source from files or network.
- All params are clamped to the schema before upload and before persistence.
- The HTML server serves no shader runtime in v1: it only renders media backgrounds and a static gradient for generator refs.
- If third-party effect packs are ever added (Phase 3+), they must be signed/validated like modules.

## 13. File layout

### New — Rust

| File | Purpose |
|---|---|
| `src-tauri/src/backgrounds/mod.rs` | Module root, Tauri commands |
| `src-tauri/src/backgrounds/schema.rs` | `EffectDef`, `ParamSpec`, `PassDef`, `ParamValue` |
| `src-tauri/src/backgrounds/catalog.rs` | Static effect catalog |
| `src-tauri/src/backgrounds/compile.rs` | naga validation + GLSL emission + cache |
| `src-tauri/src/backgrounds/presets.rs` | Preset files |
| `src-tauri/src/backgrounds/prelude.wgsl` | Shared uniforms/noise/palette |
| `src-tauri/src/backgrounds/effects/*.wgsl` | One file per effect |

### New — Frontend

| File | Purpose |
|---|---|
| `src/backgrounds/types.ts` | `Background` union, `ParamValue` |
| `src/backgrounds/generated/catalog.ts` | Bundle generated by Rust: catalog + GLSL |
| `src/backgrounds/gl-engine.ts` | WebGL2 renderer |
| `src/backgrounds/params.ts` | Default filling and clamping |
| `src/backgrounds/clock.ts` | Shared-phase helpers (not wired yet) |
| `src/backgrounds/uri.ts` | `lumen-bg://` encode/decode + `mediaSrcOf` |
| `src/backgrounds/presets.ts` | Preset IPC client |
| `src/backgrounds/presets-store.ts` | Shared preset list (`zustand`) |
| `src/backgrounds/components/BackgroundLayer.tsx` | Generator canvas layer |
| `src/backgrounds/components/GeneratorSurface.tsx` | Live surface + static poster |
| `src/components/generator-presets-dialog.tsx` | Tools → Generators (presets + editor) |

### Modified

| File | Change |
|---|---|
| `src-tauri/src/profiles.rs` | `DefaultBackground` → tagged `Background` enum |
| `src-tauri/src/streaming/html_server.rs` | Serve `/bg/*`; parse generator URIs |
| `src-tauri/src/main.rs` | Register background commands |
| `src-tauri/Cargo.toml` | Add `naga` |
| `src/components/lyric-background-modal.tsx` | Presets in the Themes tab, union type |
| `src/components/markdown-presentation.tsx` | Use `<BackgroundLayer>` |
| `src/components/presenter-controls.tsx` | Use `<BackgroundLayer>` |
| `src/components/notices-dialog.tsx` | Use `<BackgroundLayer>` |
| `src/app/_layout/edit.tsx` | Use `<BackgroundLayer>` |
| `src/app/media-window.tsx` | Pass parsed background to layer |
| `src/modules/components/PresenterSlot.tsx` | Use `<BackgroundLayer>` |
| `src/modules/types.ts` | Extend `SelectedBackground` |
| `src/services/lyric-service.ts` | Tolerate generator strings |
| `src/stores/profile-store.ts` | Union type |
| `src/services/profile-service.ts` | Union type |

## 14. API surface

```ts
// src/backgrounds/uri.ts
export function parseBackground(value: string | Background | null): Background | null;
export function encodeBackgroundUri(bg: Background): string;
export function decodeBackgroundUri(uri: string): GeneratorBackground | null;
export function isGeneratorUri(value: string): boolean;
export function mediaSrcOf(value: string | Background | null): string | null;

// src/backgrounds/components/GeneratorSurface.tsx
export function generatorOf(value: string | Background | null): GeneratorBackground | null;

// src/backgrounds/clock.ts
export function useBackgroundClock(): () => number; // not consumed yet
```

Module API (`src/modules/types.ts`):

```ts
export type SelectedBackground =
  | { type: 'theme' | 'image' | 'video'; src: string; name: string }
  | { type: 'generator'; effect: string; params: Record<string, ParamValue>; seed: number; name: string };
```

Modules get the **full generator surface in v1**: the union above plus `ui.openBackgroundPicker(...)` handing back a `SelectedBackground`. What stays out of v1 is *authoring* — modules cannot ship shaders or extend the catalog.

## 15. Implementation phases

### Phase 0 — Spike (go/no-go)

Detailed tasks, gates and measurement protocol: [generator-backgrounds-spike.md](./generator-backgrounds-spike.md).

1. `<BackgroundLayer>` with a WebGL2 renderer; 3 Tier 0 effects (aurora, waves, starfield) plus Tier 1 probes (smoke, trails).
2. Hardcoded param schema mirroring the future Rust `EffectDef`.
3. Shared clock between the main and output windows.
4. Measure two simultaneous surfaces at 1080p; record GPU/frame time, idle cost and a 60-minute soak.
5. Validate WGSL → GLSL via naga on the 5 effects plus 2 edge cases (loops, `fract`/`sin` heavy), including UBO/std140 layout.
6. Decide: proceed with Option A, author GLSL directly, or pivot to Option C.

### Phase 1 — Engine and UX

1. Rust schema/catalog/compile/commands; 10 MVP effects plus the two Tier 1 effects (smoke, trails) validated by the spike.
2. Shared prelude with noise + palette.
3. Registry, clock, URI codec.
4. Preset cards in the **Themes** tab with live previews, generated sliders, presets (no separate Generators tab).
5. Persistence in profile + lyric global + per-slide; migration tests.
6. Replace all `<img>`/`<video>` background call sites with `<BackgroundLayer>`.

### Phase 2 — Distribution

1. Stream payload URI + validation.
2. Presenter module backdrop (prototyped in the spike).
3. Crossfade, adaptive quality, visibility pause.
4. Shared clock event and phase verification between windows.
5. Mobile: static gradient fallback for generator refs (no WebGL runtime in v1).

### Phase 3 — Depth

1. Remaining Tier 1 effects (pixel sorting, ink, glitch feedback) with anti-degeneration. Smoke and trails ship in v1 (Phase 1).
2. Thumbnails/poster rendering for pickers and fallbacks.
3. Optional Tier 2 (reaction-diffusion first; boids/fluid only if justified).
4. Optional native `wgpu` host or WASM simulations.
5. Optional module/third-party effect packs.

## 16. Testing

| Test | What it proves |
|---|---|
| `cargo test` shader validation | Every catalog shader parses, validates and converts |
| Golden-frame hash (fixed seed/time/res) | Tier 0 determinism across runs |
| DOM/unit tests for `uri.ts` | Encode/decode round-trip, malformed input tolerance |
| Migration fixtures | Old profiles/lyrics load unchanged |
| Manual perf matrix | 1080p/1440p/4K, integrated + discrete GPU, 2 surfaces |
| Visibility/memory soak | Multi-hour run: no leaks, no feedback saturation |
| Mobile fallback | WebGL2 disabled → gradient poster, no errors |

## 17. Locked decisions (v1)

| Decision | v1 |
|---|---|
| Render host | **WebGL2 in the webview (Option A)**. Rust owns the catalog, schema, WGSL assembly, validation and presets |
| Shader language | **WGSL → GLSL ES 3.00 via `naga`**. If the spike's shader gate fails, author GLSL ES directly; Rust assembly/validation is unchanged |
| Surface scope | **Every surface**: lyric global, per-slide, notices, profile default, module/presenter backdrop, output window. The picker applies generators from the **Themes** tab — there is no separate Generators tab |
| Mobile HTML | **No generators.** A `lumen-bg://` ref degrades to a static gradient/theme poster |
| Clock | **Shared phase** emitted by the main window is the target; `sentAt` would use epoch `Date.now()` because each window has its own `performance.now()` origin. **Not wired yet** — each surface integrates its own phase |
| Module API | **Full generator support in v1**: `SelectedBackground` union + `ui.openBackgroundPicker` |
| v1 effects | **42 in the catalog**: 36 Tier 0 plus 6 Tier 1 (smoke, trails, pixel sorting, ink bloom, glitch feedback, reaction-diffusion) |
| Presets | Built-in + user presets under `config/background-presets/` |
| Versioning | Presets carry `version` but are **migrated to the current schema**: unknown keys dropped, missing keys defaulted |

### Deferred

- Shared clock event between windows, crossfade (~250 ms) and the Auto/High/Balanced/Performance quality setting.
- Mobile WebGL runtime (`/bg/runtime.js`) and smooth phone previews.
- Remaining Tier 1 effects (pixel sorting, ink, glitch feedback), Tier 2 simulations and the native `wgpu` host.
- Third-party effect packs.
- `backgroundId` + side table if params outgrow the URI.
- Still open: **quality default** (`Auto` per surface vs one global setting) and **thumbnails** (live low-res vs build-time) — both are Phase 2 calls, the spike measures with `Auto`.

## 18. Status: shipped vs pending

### Shipped

| Area | State |
|---|---|
| Catalog | 42 effects (36 Tier 0 + 6 Tier 1) authored in Rust (`backgrounds/`), assembled with the shared prelude, converted WGSL → GLSL ES 3.00 with `naga`, emitted to `src/backgrounds/generated/catalog.ts` by `cargo run --example bg_compile` |
| Renderer | `gl-engine.ts` + `BackgroundLayer.tsx`: WebGL2, full-screen triangle, program cache, ping-pong FBOs, fps cap, `resolutionScale`, `document.hidden` pause, context loss/restore |
| Components | `GeneratorSurface` (live) and `GeneratorPoster` (palette gradient) |
| Picker | Generator presets merged into the existing **Themes** grid (virtualized, 4 per row), live preview at 15 fps / 0.5 scale, name on hover; tabs are Themes + Images |
| Presets | `background_presets.rs` + `bg_preset_list` / `bg_preset_save` / `bg_preset_delete`, `presets-store.ts`, Tools → Generators dialog (Presets + Editor) |
| Persistence | `background_presets` files, `DefaultBackground` extended with `effect`/`params`/`seed`/`preset`, `lumen-bg://` URI in lyric files, stream payloads and the HTML payload |
| Surfaces | Lyric global + per-slide + notices + profile default + aside panel + Settings preview + edit previews + media/output window + presenter backdrop + module API (`SelectedBackground`) |
| Mobile | `generatorPoster()` in `html_server.rs` renders a palette gradient from the URI payload |

### Pending

| Item | Where |
|---|---|
| Shared clock (`background:clock`) between windows | `clock.ts` exists, nothing emits or consumes it |
| Quality setting (Auto / High / Balanced / Performance) | No setting; call sites pass fixed `maxFps` / `resolutionScale` |
| Crossfade (~250 ms) between backgrounds | Not implemented |
| Pause on intersection / minimized / blackout | Only the `paused` prop and `document.hidden` |
| Adaptive quality from frame time | Not implemented |
| Retry after `webglcontextlost` beyond the restore event | Single restore attempt only |
| Remaining Tier 1 effects (pixel sorting, ink, glitch feedback), Tier 2, mobile WebGL runtime | Phase 3 |
