# Generator Backgrounds — Feature Plan

> Status: **draft for review**
> Related: [Architecture](./generator-backgrounds-architecture.md) · [Phase 0 spike](./generator-backgrounds-spike.md) · [Usage guide](../usability/generator-backgrounds-usage.md)

## 1. Problem

Today every background in Lumen is a **static asset**: an image, a video or a theme file referenced by `{ type, src, name }` and rendered with `<img>` / `<video>`. That forces the operator to:

- ship large files (a 4K 60s loop is often 50–150 MB),
- accept whatever loop, palette and speed the file happens to have,
- restart the loop and live with visible seams,
- keep a separate asset per look (bright/dark, warm/cool, calm/energetic).

Live events need backgrounds that can run **forever**, adapt to the moment and be tuned in a second — without asset management.

## 2. Concept

A **generator** is a procedural background: a shader (plus optional simulation state) driven by a time value and a small set of parameters. The operator picks an effect and adjusts it with sliders; the result renders **in real time, indefinitely**.

```
background = effect(id) + params + seed + time
```

No video is ever generated or written to disk. The same generator definition powers the app preview, the output window, the HTML/mobile preview and the live stream.

## 3. Locked decisions

These were agreed before writing this plan and shape everything below:

| Decision | Value |
|---|---|
| Rendering | Real time, infinite, time-driven |
| Audio reactivity | **Out of scope** — no FFT, no system audio capture |
| Video export | **Out of scope** — no encoding, no frame dump, no determinism-for-export |
| Effect logic | Owned by **Rust** (definitions, shaders, parameters, presets, validation, timing) |
| Controls | Sliders generated from a parameter schema, grouped per effect |
| Outputs | Every surface that renders a background today must support generators |
| Compatibility | Existing image/video/theme backgrounds must keep working unchanged |
| Render host | **WebGL2 in the webview** (Option A); shaders authored in **WGSL** and converted with `naga` |
| Surface scope (v1) | **Lyric global background** and **module/presenter backdrop**; profile default and per-slide keep assets |
| Mobile (v1) | **No generators on the HTML server**; a generator ref falls back to a static gradient poster |
| Module API (v1) | **Full generator support** through `SelectedBackground` and `ui.openBackgroundPicker` |
| Effects (v1) | 10 Tier 0 **plus smoke and trails** (Tier 1) |
| Presets | Built-in + user presets in `config/background-presets/` |
| Versioning | Presets carry a version but migrate to the current effect schema |
| Clock | One shared phase emitted by the main window |

## 4. Where backgrounds appear today

These are the integration points the feature must cover (confirmed in the current codebase):

| Surface | Current rendering | Impact |
|---|---|---|
| Profile default (`defaultBackground`) | `src` path, `<img>` | Deferred in v1 (keeps assets) |
| Lyric metadata (`globalBackground`) | string path in the file | Encode generator as a URI |
| Per-slide (`<!-- bg: ... -->`) | string path in the file | Deferred in v1 (keeps assets) |
| Main app previews (edit, presentation, settings, notices) | `<img>` / `<video>` | Replace with shared `<BackgroundLayer>` |
| Presenter module backdrop (`PresenterSlot`) | `<img>` / `<video>` | Reuse `<BackgroundLayer>` |
| Media / output window (`MarkdownPresentation`) | `<img>` layers | Reuse `<BackgroundLayer>` |
| HTML server (mobile, port 8090) | CSS `url(...)` | Serve a small WebGL runtime + shader |
| WebRTC streams | window capture (`app_preview_producer`) | Works automatically once the window renders it |

> **v1 scope:** generators apply to the **lyric global background** and the **module/presenter backdrop**. Profile default and per-slide are deferred and keep the current asset behavior. Notices use the lyric document's `globalBackground`, so they are covered. The shared types stay backward compatible so widening the scope later is additive.

The important consequence: the background must render **inside the webview, behind the DOM**, because slides/lyrics are DOM. A native surface cannot be composited behind text without platform-specific tricks, so v1 renders in the webview (see the architecture document for the full trade-off).

## 5. Effect catalog

This is the working list of effects, grouped by implementation cost. Parameters marked with **\*** are common to every effect and are defined once below; the tables list only effect-specific ones.

### Common parameters

| Key | UI | Range | Notes |
|---|---|---|---|
| `speed` | Speed | 0–4 (log) | Global time multiplier |
| `scale` | Scale | 0.1–4 (log) | Feature size |
| `intensity` | Intensity | 0–1.5 | Contrast/brightness of the effect |
| `seed` | Seed | 0–9999 | Reproducible variation |
| `colorA` | Color A | palette | Theme-aware default |
| `colorB` | Color B | palette | Theme-aware default |

### Tiers

| Tier | Meaning | Rendering |
|---|---|---|
| **0** | Stateless fragment shader | One pass, no history |
| **1** | Feedback between frames | Two textures, ping-pong |
| **2** | Simulation / agent state | Compute-like multi-pass or WASM |

### Tier 0 — Stateless shaders

#### Gradients and soft fields

| Effect | Description | Extra parameters |
|---|---|---|
| **Aurora** | Flowing ribbons of light over a dark field | `bands` (2–8), `flow` (0–1), `glow` (0–1), `hueShift` (0–1) |
| **Mesh gradient** | Soft color blobs drifting and blending | `points` (3–8), `warp` (0–1), `blur` (0–1), `saturation` (0–1) |
| **Plasma** | Classic sine-interference color field | `frequency` (1–12), `warp` (0–2), `detail` (1–4) |
| **Nebula** | Layered noise clouds with depth | `layers` (2–6), `coverage` (0–1), `drift` (0–2) |
| **Clouds** | fBm cloud field with soft edges | `coverage` (0–1), `detail` (1–6), `drift` (0–2) |
| **Marble** | Turbulent veins, stone-like | `veins` (1–10), `turbulence` (0–2), `scaleDetail` (1–6) |
| **Caustics** | Water-like light patterns | `sharpness` (0–1), `depth` (0–1), `causticScale` (1–8) |

#### Waves and motion

| Effect | Description | Extra parameters |
|---|---|---|
| **Waves** | Layered sine bands, the classic | `layers` (1–6), `amplitude` (0–1), `frequency` (1–12), `slope` (−1–1) |
| **Ripples** | Concentric waves from a center | `centerX`/`centerY` (0–1), `frequency` (1–20), `decay` (0–1) |
| **Flow field** | Lines/streaks following a noise field | `density` (0–1), `lineWidth` (0–1), `turbulence` (0–2), `glow` (0–1) |
| **Ribbons** | Flowing bezier-like strands | `strands` (2–16), `width` (0–1), `turbulence` (0–2), `glow` (0–1) |
| **Lissajous** | Intersecting harmonic curves | `ratioA` (1–9), `ratioB` (1–9), `phase` (0–1), `lineWidth` (0–1), `trail` (0–1) |
| **Neon tunnel** | Rings receding into the center | `rings` (2–16), `twist` (0–2), `glow` (0–1), `vignette` (0–1) |
| **Retro sun** | Synthwave sun with stripes and horizon | `sunSize` (0–1), `stripeCount` (2–20), `horizon` (0–1), `scroll` (0–2) |

#### Particles and points

| Effect | Description | Extra parameters |
|---|---|---|
| **Starfield** | Star points with depth and drift | `density` (0–1), `twinkle` (0–1), `warp` (0–1), `depth` (0–1) |
| **Star twinkle** | Sparse stars gently pulsing | `density` (0–1), `sizeVariance` (0–1), `twinkleSpeed` (0–2) |
| **Snowfall** | Falling flakes with wind | `density` (0–1), `wind` (−1–1), `size` (0–1), `blur` (0–1) |
| **Rain** | Angled streaks | `density` (0–1), `angle` (−45–45), `length` (0–1), `splash` (0–1) |
| **Floating dust** | Slow drifting motes | `density` (0–1), `size` (0–1), `drift` (0–2), `bokeh` (0–1) |
| **Bokeh** | Large out-of-focus circles | `count` (1–64), `size` (0–1), `blur` (0–1), `drift` (0–2) |
| **Fireflies** | Wandering glowing points | `density` (0–1), `wander` (0–2), `glow` (0–1), `blink` (0–1) |
| **Embers** | Sparks rising with flicker | `spawnRate` (0–1), `rise` (0–2), `flicker` (0–1), `glow` (0–1) |

#### Geometry and patterns

| Effect | Description | Extra parameters |
|---|---|---|
| **Voronoi** | Animated cells with glowing edges | `cells` (4–40), `edgeGlow` (0–1), `warp` (0–1), `shade` (0–1) |
| **Halftone** | Dot grid with size modulation | `dotSize` (0–1), `angle` (0–180), `contrast` (0–1), `animate` (0–1) |
| **Hex grid** | Hex lattice with pulse | `hexSize` (4–40), `pulse` (0–1), `glow` (0–1), `lineWidth` (0–1) |
| **Grid pulse** | Lines with traveling energy | `spacing` (4–40), `waveSpeed` (0–2), `lineWidth` (0–1), `fade` (0–1) |
| **Topographic** | Contour lines over noise | `contourCount` (2–20), `scaleDetail` (1–6), `drift` (0–2), `lineWidth` (0–1) |
| **Moiré** | Interference rings/patterns | `rings` (10–100), `offset` (0–1), `rotation` (0–360), `blend` (0–1) |
| **Kaleidoscope** | Mirrored segments of a base pattern | `segments` (3–16), `rotation` (0–360), `zoom` (0.5–3), `source` (enum) |
| **Dither** | Ordered dithering of a gradient/noise | `pattern` (enum), `pixelScale` (1–8), `threshold` (0–1), `animate` (0–1) |
| **Wireframe terrain** | Perspective grid landscape | `amplitude` (0–1), `gridSize` (4–40), `fog` (0–1), `scroll` (0–2) |
| **SDF shapes** | Morphing signed-distance shapes | `shape` (enum), `morph` (0–1), `glow` (0–1), `spin` (0–1) |

#### Stylized / graphic

| Effect | Description | Extra parameters |
|---|---|---|
| **Glitch** | Block displacement and RGB split | `intensity` (0–1), `blockSize` (1–16), `rgbSplit` (0–1), `rate` (0–2) |
| **Holographic** | Iridescent sheen bands | `bands` (1–12), `angle` (0–360), `saturation` (0–1), `shine` (0–1) |
| **Liquid metal** | Chrome-like flowing surface | `turbulence` (0–2), `contrast` (0–1), `sheen` (0–1), `angle` (0–360) |
| **Vignette pulse** | Breathing light falloff | `vignette` (0–1), `pulse` (0–1), `centerX`/`centerY` (0–1) |

### Tier 1 — Feedback effects

These keep a previous-frame texture. Each must declare an anti-degeneration strategy (see architecture, Section 6).

| Effect | Description | Extra parameters | Strategy |
|---|---|---|---|
| **Smoke** | Advected noise smoke | `viscosity` (0–1), `buoyancy` (0–1), `dissipation` (0–1), `detail` (1–6) | `decay` |
| **Trails** | Motion-blurred flowing shapes | `trailLength` (0–1), `blur` (0–1), `turbulence` (0–2) | `decay` |
| **Pixel sorting** | Rows/columns sorted by brightness | `threshold` (0–1), `direction` (enum), `sortSpeed` (0–1) | `reseed` |
| **Ink / paint bloom** | Organic ink spreading | `spread` (0–1), `bleed` (0–1), `density` (0–1) | `decay` |
| **Glitch feedback** | Recursive displacement | `intensity` (0–1), `zoom` (0.9–1.1), `offset` (0–1) | `normalize` |
| **Reaction-diffusion** | Organic Turing patterns | `feed` (0–0.1), `kill` (0–0.1), `diffusionA/B` (0–1) | `inject` |

Reaction-diffusion sits at the boundary between Tier 1 and Tier 2; it can run as a multi-pass fragment pipeline at reduced simulation resolution (e.g. 512×512) upscaled for display.

### Tier 2 — Simulations (Phase 3+)

Only pursue these if the MVP proves the framework and there is a concrete use case.

| Effect | Description | Why it is expensive |
|---|---|---|
| **Fluid** | Navier–Stokes velocity/dye field | Many passes, pressure solve |
| **Boids** | Flocking agents | Agent state in textures or WASM |
| **Cellular automata** | Game-of-Life-like rules | State texture + stable rule set |
| **Slime mold** | Agent-based trail following | Many agents, persistent field |
| **L-systems / growing vines** | Procedural growth over time | CPU/WASM growth + GPU draw |

### MVP selection

The MVP targets **Tier 0** effects — pure fragment shaders, no persistent state — plus **Smoke** and **Trails** from Tier 1, which the spike validates. Start with these ten Tier 0 effects, one visual family each:

| # | Effect | Why it is in the MVP |
|---|---|---|
| 1 | Aurora | Soft, premium look; great default |
| 2 | Mesh gradient | Broadly useful, very readable behind text |
| 3 | Waves | Matches the original idea; classic |
| 4 | Starfield | Distinct look, low cost |
| 5 | Floating dust / bokeh | Calm, works over dark slides |
| 6 | Flow field | Organic movement, strong identity |
| 7 | Halftone / dot matrix | Graphic/brand look |
| 8 | Voronoi | Modern, geometric |
| 9 | Grid pulse | Tech/energetic look |
| 10 | Retro sun / synthwave | High visual impact, niche event use |

They should fit the 4 ms/surface budget at 1080p.

Smoke and Trails ship in v1 as the only feedback effects: they exercise ping-pong, the fixed-timestep accumulator and anti-degeneration without the multi-pass cost of Tier 2.

### Naming rules

- IDs are lowercase, hyphen-free where possible (`mesh-gradient`), stable and never reused.
- Display names are title case and translatable via the i18n layer later.
- `version` increments when the shader or parameter meaning changes; presets carry the version they were authored against.

## 6. UX summary

- Entry point: **titlebar menu → Tools → Generators**, opening the picker directly on the Generators tab, in addition to the picker sections.
- A new **Generators** tab is added to the existing background picker (next to Themes / Images / Video).
- The tab shows a grid of **live previews** (low-resolution, muted, capped FPS).
- Selecting an effect opens a parameter panel with auto-generated sliders grouped into **Motion / Shape / Color / Advanced**.
- Controls: apply, reset, randomize seed, save as preset, duplicate to profile/global/slide.
- Changing a parameter updates the preview instantly and pushes live to the output window; closing without applying reverts.
- A **quality** setting (Auto / High / Balanced / Performance) controls resolution scale and FPS per surface.

Detailed flows: [generator-backgrounds-usage.md](../usability/generator-backgrounds-usage.md).

## 7. Success criteria

| Criterion | Target |
|---|---|
| Frame rate | 60 fps at 1080p, one generator, integrated GPU |
| Output + preview | Same visual phase, no desync when speed changes |
| Parameter latency | Slider change visible in output in < 100 ms |
| Idle cost | Paused when hidden/minimized/blackout; near-zero CPU when paused |
| Memory | No growth over multi-hour sessions (feedback effects included) |
| Compatibility | Existing profiles, lyrics and slides load unchanged |
| Failure mode | No WebGL2 / driver issue → static poster, never a black screen crash |
| Mobile preview | Generator refs degrade to a static gradient; no WebGL on the HTML server in v1 |

## 8. Phases

| Phase | Scope | Outcome |
|---|---|---|
| **0 — Spike** | Detailed in [generator-backgrounds-spike.md](./generator-backgrounds-spike.md): WebGL2 host, 3 Tier 0 effects + 2 Tier 1 probes, hardcoded schema, shared clock, 2-surface measurement, naga/UBO validation. | Go/no-go on the render host |
| **1 — Engine** | Rust registry, schema, commands, presets, naga pipeline. Picker tab, generated sliders, lyric-global + module persistence. 10 Tier 0 effects + smoke/trails. | Usable feature end to end |
| **2 — Distribution** | Stream URI payloads, presenter backdrop, adaptive quality, clock sync, crossfade, mobile static fallback. | Works on every desktop surface |
| **3 — Depth** | Remaining Tier 1 (pixel sorting, ink, glitch feedback), thumbnails, profile/slide generators, mobile runtime, optional Tier 2. | Full catalog |

The spike must finish before committing to Phase 1; its main question is whether the webview shader host is good enough or whether a native `wgpu` host is required sooner.

## 9. Out of scope (v1)

- Audio-reactive effects.
- Exporting/generating video files or image sequences.
- User-authored shaders / third-party effect packs.
- Per-pixel collision with slide content, 3D scenes, or camera input.
- Syncing feedback simulation state between windows (visual phase is synced; stateful effects are per-surface).

## 10. Decisions locked for v1

| Question | Decision |
|---|---|
| Render host | **WebGL2 in the webview** (Option A). Rust owns definitions, params, presets, validation and timing |
| Shader language | **WGSL → GLSL ES 3.00 via `naga`**, with the spike gating conversion quality |
| Scoping | **Lyric global + module/presenter backdrop.** Profile default and per-slide deferred; the shared types stay additive so widening later is cheap |
| Presets | **Built-in + user presets** in `config/background-presets/` |
| Mobile HTML | **No generators** in v1; static gradient fallback from the palette |
| Module API | **Full generator support in v1** (`SelectedBackground` union + picker) |
| Effects | 10 Tier 0 **plus smoke and trails** |
| Clock | **One shared phase** from the main window, epoch `sentAt` |
| Versioning | Presets **migrate to the current schema** (unknown keys dropped, missing keys defaulted) |

Still open and intentionally decided during Phase 2, after the spike numbers exist:

1. **Quality default** — `Auto` per surface vs a single global setting. The spike measures with `Auto`.
2. **Thumbnails** — live low-res previews vs build-time posters.
3. **Stream payload growth** — the URI is compact today; add a `backgroundId` + side table only if params outgrow it.
4. **Remote controllers** — phones stay read-only on the existing slide payload; revisit with mobile generators.
