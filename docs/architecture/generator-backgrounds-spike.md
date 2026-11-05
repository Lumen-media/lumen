# Generator Backgrounds — Phase 0 Spike Plan

> Status: **ready to execute**
> Related: [Architecture](./generator-backgrounds-architecture.md) · [Feature plan](./generator-backgrounds-plan.md) · [Usage guide](../usability/generator-backgrounds-usage.md)
> Decisions locked for this spike: WebGL2 in the webview (Option A), WGSL converted with `naga`, shared clock, 3 Tier 0 + 2 Tier 1 effects.

## 1. Purpose

The spike answers one question: **can the webview host the generator catalog behind DOM text on two surfaces at 1080p, driven by Rust-compiled shaders, inside the 4 ms/surface budget?**

Secondary question: does `naga` produce reliable GLSL ES 3.00 for the shader idioms the catalog needs (loops, noise, `fract`/`sin`, feedback sampling)?

It is a throwaway build, not a product increment. Nothing here ships except the code that Phase 1 promotes (`src/backgrounds/*`) and the numbers in the report.

### Exit artifacts

| Artifact | Location |
|---|---|
| WebGL2 engine, clock, `<BackgroundLayer>` | `src/backgrounds/` (kept) |
| 5 effects authored in WGSL + Rust compile probe | `src-tauri/src/backgrounds_spike/`, `src-tauri/examples/bg_spike_compile.rs` |
| Hardcoded catalog mirroring the future `EffectDef` | `src/backgrounds-spike/catalog.ts` (throwaway) |
| Dev-only harness route | `src/app/spike-backgrounds.tsx` (throwaway) |
| Measurement CSV + filled gate table | linked in the PR description |
| Go/no-go decision | appended to Architecture §17 and Plan §10 |

## 2. Scope

### In

- 3 Tier 0 effects: **aurora, waves, starfield**.
- 2 Tier 1 probes: **smoke, trails** (ping-pong, fixed timestep, anti-degeneration).
- Shared phase emitted by the main window and consumed by the media window and presenter.
- `<BackgroundLayer>` wired into `MarkdownPresentation` (behind the lyrics) and `PresenterSlot` backdrop.
- Minimal adaptive quality: resolution scale, FPS cap, visibility pause, context-loss recovery.
- Per-effect params hardcoded in the TS catalog, same shape as the future Rust `ParamSpec`.

### Out (do not build here)

- Rust catalog, Tauri commands, presets, persistence (`bg_effect_list`, `config/background-presets/`).
- Picker UI, Generators tab, presets panel, crossfade, thumbnails.
- `lumen-bg://` URI codec, lyric-file writes, stream payload changes.
- HTML server / mobile runtime (desktop-only in v1).
- Module API surface (the spike only renders a backdrop; types stay local).
- Profile default and per-slide generators (deferred in v1).

## 3. Go/no-go gates

All gates run on the output window scenario unless noted. A gate fails only if it misses the threshold on the **median of three runs**.

| Gate | What is measured | Pass threshold | If it fails |
|---|---|---|---|
| **G1 — Tier 0 perf** | GPU time per surface + frame p95, output 1080p + preview 960 wide, same effect | Output ≤ 4 ms GPU, preview ≤ 2 ms, p95 frame ≤ 20 ms, average ≥ 55 fps | Cap preview first (720p / 24 fps / scale 0.5). If output still misses, evaluate a hybrid Option C for the output window |
| **G2 — Tier 1 perf** | Smoke and trails at 1080p output, `resolutionScale = 0.75`, 512×512 feedback buffer | ≤ 8 ms GPU per surface, average ≥ 50 fps, fixed-timestep steps ≤ 2 per frame | Ship Tier 0 only in v1; move smoke/trails back to Phase 3 (needs product sign-off) |
| **G3 — Shader pipeline** | 5 effect shaders + 2 edge-case shaders (dynamic loops; heavy `fract`/`sin`) through `naga` → GLSL ES 3.00 → WebGL2 compile | 5/5 + 2/2 compile; same seed/time produces identical output on repeated runs; one reference effect matches a hand-written GLSL equivalent within 2/255 per channel | Author GLSL ES directly for v1 (Rust keeps assembly/validation); or restrict catalog idioms if only edge cases fail |
| **G4 — Clock sync** | Phase delta between main window and output window over 10 minutes, including two speed changes | ≤ 16 ms drift; no visible jump after a speed change | Fall back to per-surface clocks and document the desync |
| **G5 — DOM compositing** | Lyrics rendered over the canvas at 16:9, 16:10 and 21:9 in fade/slide/typewriter | Text above canvas, no flicker or halo; canvas ignores pointer events; lyric animation unchanged | Rework stacking/`isolate`/`translateZ`; retest |
| **G6 — Idle cost** | Hidden tab, minimized window, blackout | 0 rAF callbacks, < 1% CPU; resume ≤ 250 ms | Fix visibility wiring before Phase 1 |
| **G7 — Soak** | 60 minutes with smoke + trails running | JS heap growth < 20 MB, GPU memory flat, mean frame brightness within ±5% of the t=60 s sample | Add/adjust the anti-degeneration strategy |
| **G8 — Context loss** | `WEBGL_lose_context` forced while rendering | Recovery ≤ 1 s or static poster, no uncaught exception | Keep poster fallback; do not retry more than once |

### Decision matrix

| Outcome | Decision |
|---|---|
| G1–G8 pass | **Go with Option A.** Start Phase 1 with the spike's engine and catalog shape |
| G3 fails on the 5 effects | Keep Rust assembly + validation, author **GLSL ES 3.00** bodies in v1; WGSL stays the future path |
| G3 fails only on edge shaders | Drop dynamic-loop idioms from the catalog, document the restriction, re-run |
| G1 fails at 2 surfaces but passes at 1 | Ship capped previews; if the output still misses, evaluate Option C for the output window only |
| G2 fails | v1 ships 10 Tier 0 effects; smoke/trails move to Phase 3 |
| G4 fails | Per-surface clocks; the UI stops implying phase-identical stateful effects |

## 4. Test environment and measurement protocol

### Environment to record in the report

- OS build, CPU, GPU model, driver version, WebView2 version (`navigator.userAgent` + `WEBGL_debug_renderer_info`).
- Power mode: plugged in, "best performance", no battery saver.
- Window setup: main window at its default size, media window fullscreen on the primary 1920×1080 display, DPR 1 and DPR 2 runs.
- Presenter run: module backdrop open as a third canvas, to measure marginal cost.

### Scenarios

| # | Scenario | Surfaces | Purpose |
|---|---|---|---|
| S1 | Aurora in the output window, lyrics visible | 1 | Baseline cost with DOM text |
| S2 | Aurora in output + edit preview | 2 | G1 budget |
| S3 | Smoke in output + preview | 2 | G2 feedback cost |
| S4 | Trails in output + presenter backdrop | 3 | Marginal cost of a third canvas |
| S5 | All effects, 30 s each | 2 | Catalog regression sweep |

### Instrumentation

- Frame time: `performance.now()` delta between consecutive rAF callbacks, plus a rolling p50/p95/max.
- GPU time: `EXT_disjoint_timer_query_webgl2` when available. Never call `gl.finish()` in the rendering path; a separate measurement build (`VITE_BG_SPIKE_MEASURE=1`) may do it once per second to validate the timer numbers.
- Log CSV rows: `{ ts, effect, surface, frameMs, gpuMs, scale, fps, dpr }`.
- Discard the first 10 s (shader compile + texture upload), then measure ≥ 120 s.
- Fixed inputs: `seed = 42`, `speed = 1`, `phase` from the shared clock, default params per effect.
- Repeat each scenario three times and report the median, keeping the raw CSV.

## 5. Work breakdown

Estimates are for one developer familiar with the codebase. Total ≈ 7.5 dev-days.

### S0.1 — Scaffolding and harness route (2 h)

- Add the dev-only route `src/app/spike-backgrounds.tsx` (`/spike-backgrounds`) that mounts two canvases side by side and a params panel.
- Add `src/backgrounds-spike/catalog.ts` with the 5 effects and their params, typed like the future `EffectDef` (`id`, `version`, `params[]`, `passes[]`).
- Exit: route renders, catalog imports, `pnpm build` still passes.

### S0.2 — GL engine core (1 d)

Files: `src/backgrounds/gl-engine.ts`, `src/backgrounds/types.ts`.

- WebGL2 context (`alpha: false`, `antialias: false`, `desynchronized: true`, `powerPreference: 'high-performance'`).
- Fullscreen triangle drawn from `gl_VertexID`; one draw call for Tier 0.
- Program cache keyed by `effectId@version`; compile/link errors collected per effect, never thrown into React.
- UBO path: create a buffer for the params block, `uniformBlockBinding` at 0, upload with std140 layout. **Validate the layout with a test shader that outputs one uniform per channel before porting any effect** — this is where `naga` GLSL output and hand-written GLSL usually diverge.
- Resize via `ResizeObserver`; render target size = CSS size × `min(devicePixelRatio, 2)` × `resolutionScale`.
- FPS cap with an accumulator; adaptive scale: after 2 s above 18 ms, multiply scale by 0.75 (floor 0.5); recover after 5 s below 10 ms.
- Exit: one hardcoded gradient shader renders, resize and scale changes work, program cache hit is observable.

### S0.3 — Rust shader pipeline probe (1.5 d)

Files: `src-tauri/src/backgrounds_spike/{mod.rs,prelude.wgsl,effects/*.wgsl}`, `src-tauri/examples/bg_spike_compile.rs`, `src-tauri/Cargo.toml`.

1. Add `naga` with `wgsl-in` + `glsl-out` behind a `spike` feature (or as a dev-dependency of the example) so it does not ship yet.
2. Prelude: params struct matching the UBO, plus `hash`, value/simplex noise, `palette`, aspect correction.
3. Assemble `prelude + effect body`, parse with `naga::front::wgsl`, validate, emit GLSL ES 3.00 (`Version::Embedded { version: 300, is_webgl: true }`).
4. The example writes `src/backgrounds/shaders.generated.ts` (effect id → GLSL string) and fails the build on any conversion error.
5. Add `#[test]` cases for the 2 edge shaders (bounded loop with dynamic count; dense `fract`/`sin`) so `cargo test` fails on regressions.
6. Inspect the emitted GLSL for `#version 300 es`, precision qualifiers (force `highp` in the fragment stage), explicit `std140` layout and no unsupported builtins.
7. Exit: `cargo run --example bg_spike_compile` emits all 5 shaders, `cargo test` covers the edge cases.

### S0.4 — Tier 0 effects (1.5 d)

Files: `src-tauri/src/backgrounds_spike/effects/{aurora,waves,starfield}.wgsl`.

- All three use only the prelude helpers and common uniforms; start with aurora because it exercises bands, flow and palette.
- Params per effect match Plan §5 (`bands`, `flow`, `glow`, `hueShift`; `layers`, `amplitude`, `frequency`, `slope`; `density`, `twinkle`, `warp`, `depth`).
- Exit: visuals match the reference descriptions; no shader exceeds the G1 budget when run alone.

### S0.5 — Tier 1 ping-pong (1 d)

Files: `effects/{smoke,trails}.wgsl`, engine FBO code.

- Two RGBA8 targets (prefer RGBA16F when `EXT_color_buffer_float` is present) at 512×512, upscaled for display.
- Fixed timestep accumulator at 1/60 s; cap 2 steps per frame; blend factor from the param.
- Declare and implement the anti-degeneration strategy (`decay` for both) and a `reset` entry point.
- Exit: 5-minute run shows no saturation or fade-out; G7 soak passes.

### S0.6 — `<BackgroundLayer>` and call sites (1 d)

Files: `src/backgrounds/components/BackgroundLayer.tsx`, `src/components/markdown-presentation.tsx`, `src/modules/components/PresenterSlot.tsx`.

- Props: `background` (media | generator | undefined), `quality`, `maxFps`, `paused`, `className`, `poster`.
- Media branch keeps today's `<img>` / `<video>` behavior and `lumenUrl` warm width.
- Generator branch mounts the canvas, runs the loop, pauses on `paused`, `document.hidden`, IntersectionObserver and window minimize.
- `MarkdownPresentation`: replace only the `<img>` layers at `z-0`/`z-1`; text stays at `z-2`. Do not touch the slide-change animation.
- `PresenterSlot`: replace `PresenterBackground`'s `<img>`/`<video>` with the layer, keeping the `fixed inset-0 z-50` isolation.
- Exit: G5 passes in all three lyric animations; media backgrounds unchanged.

### S0.7 — Shared clock (0.5 d)

Files: `src/backgrounds/clock.ts`.

- Main window emits `background:clock` every second and immediately on speed/effect/seed change: `{ phaseSeconds, speed, sentAt }`.
- `sentAt` is **epoch milliseconds from `Date.now()`**, not `performance.now()` — each Tauri window has its own time origin, so `performance.now()` values are not comparable across windows.
- Consumers compute `t = phaseSeconds + (Date.now() - sentAt) / 1000 * speed`.
- Exit: two windows stay aligned through two speed changes (G4).

### S0.8 — Measurement and soak harness (0.5 d)

- Dev overlay showing fps, GPU ms, scale and effect id; CSV export button.
- Script for the 60-minute soak with brightness sampling every 60 s.
- Exit: CSV + brightness samples collected for the report.

### S0.9 — Report and decision (0.5 d)

- Fill the gate table (Section 6), attach the CSV, list deviations and surprises.
- Write the decision into Architecture §17 and Plan §10; update the phases if the outcome differs from the default.

## 6. Report template

| Gate | Target | Run 1 | Run 2 | Run 3 | Median | Pass |
|---|---|---|---|---|---|---|
| G1 Tier 0 output GPU | ≤ 4 ms | | | | | |
| G1 Tier 0 preview GPU | ≤ 2 ms | | | | | |
| G1 frame p95 | ≤ 20 ms | | | | | |
| G1 average fps | ≥ 55 | | | | | |
| G2 Tier 1 GPU | ≤ 8 ms | | | | | |
| G2 Tier 1 fps | ≥ 50 | | | | | |
| G3 shader compile | 7/7 | | | | | |
| G3 parity | ≤ 2/255 | | | | | |
| G4 clock drift | ≤ 16 ms | | | | | |
| G6 idle CPU | < 1% | | | | | |
| G7 heap growth | < 20 MB | | | | | |
| G7 brightness drift | ±5% | | | | | |
| G8 recovery | ≤ 1 s | | | | | |

Environment block (fill before running): GPU, driver, WebView2 version, DPR, display mode.

## 7. Risks and mitigations

| Risk | Signal | Mitigation |
|---|---|---|
| `naga` GLSL output mismatches the UBO layout | Garbage/black output, uniforms appear shifted | S0.2 layout test shader before porting effects; check `std140` offsets explicitly |
| WebGL2 unavailable or software-rendered (ANGLE fallback) | `getParameter(UNMASKED_RENDERER)` shows SwiftShader | Detect and log; poster fallback; note in the report, do not tune against it |
| Float render targets unavailable | `EXT_color_buffer_float` null | RGBA8 feedback for smoke/trails; accept banding or lower contrast |
| Precision differences between WGSL and GLSL ES | Visual banding, blown highlights | Force `highp`; keep noise math in `f32`; compare parity on the reference effect |
| Tauri event latency / throttling | Visible phase jitter between windows | Send phase every second; extrapolate between events; G4 catches it |
| Dev-build overhead distorts numbers | Higher frame times than the packaged app | Measure a debug build too; state which build produced the CSV |
| macOS/Linux untested on this machine | Spike only covers Windows/WebView2 | Record as a limitation; gate the release on a WebKitGTK/WKWebView smoke test before Phase 2 |
| High-DPI previews eat the budget | 2× DPR doubles fragment cost | Cap DPR at 2 and scale previews down; measure at DPR 1 and 2 |
| Canvas steals pointer events / breaks text selection | Text not selectable, clicks not reaching UI | `pointer-events: none` on the canvas, `isolate` on the parent |
| Tier 1 saturates over hours | Screens fade to white/black | `decay` + brightness sampling in the soak; reset path |

## 8. Execution checklist

- [ ] S0.1 harness route and catalog
- [ ] S0.2 engine renders a gradient; UBO layout verified
- [ ] S0.3 `naga` probe converts 5 + 2 shaders; `cargo test` green
- [ ] S0.4 aurora, waves, starfield
- [ ] S0.5 smoke, trails with decay + reset
- [ ] S0.6 `<BackgroundLayer>` in `MarkdownPresentation` and `PresenterSlot`
- [ ] S0.7 shared clock across windows
- [ ] S0.8 measurement overlay + soak run
- [ ] S0.9 report filled; decision recorded in Architecture §17 / Plan §10
- [ ] `pnpm lint` and `pnpm build` clean; spike-only files listed for removal in Phase 1

## 9. How to run

```bash
# 1. Compile WGSL -> GLSL (from src-tauri)
cargo run --example bg_spike_compile

# 2. App with the harness route
pnpm tauri dev
# open /spike-backgrounds

# 3. Measurement build
VITE_BG_SPIKE_MEASURE=1 pnpm tauri dev

# 4. Shader regression tests
cargo test --manifest-path src-tauri/Cargo.toml backgrounds_spike
```

## 10. What Phase 1 promotes

- `src/backgrounds/{types,gl-engine,clock}.ts` and `components/BackgroundLayer.tsx` — kept, with the clock event name and UBO layout frozen.
- The 5 effects — reused as the first catalog entries; aurora/waves/starfield become Tier 0, smoke/trails become the two Tier 1 v1 effects.
- The TS catalog shape — mechanically translated into Rust `EffectDef`/`ParamSpec`.
- Everything under `src/backgrounds-spike/`, the route and the example are deleted or moved behind the `spike` feature.
