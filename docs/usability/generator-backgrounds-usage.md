# Generator Backgrounds — Usage Guide

> Related: [Feature plan](../architecture/generator-backgrounds-plan.md) · [Architecture](../architecture/generator-backgrounds-architecture.md) · [Phase 0 spike](../architecture/generator-backgrounds-spike.md)

Generator backgrounds are animated, procedural backgrounds that run forever. Instead of importing an image or a video loop, you pick an **effect** and shape it with **sliders**. The same effect can look calm or energetic, dark or colorful, without any new file.

---

## Where to find it

Generators are backgrounds like any other, so they live in the **Themes** tab of the existing background picker, in the same grid as themes and saved images — there is **no separate Generators tab**. Preset cards come first in the grid, play a small live preview and show their name on hover.

A generator can be applied everywhere a background can:

| Place | What the generator applies to |
|---|---|
| **Lyrics editor → Global background** | Every slide in that lyric file |
| **Lyrics editor → Slide background** | That slide only |
| **Notices** | The notices background |
| **Settings → Appearance → Default background** | The profile default |
| **Before the stage (aside panel)** | Sets the profile default |
| **Modules / presenter backdrop** | The module's stage backdrop |
| **Titlebar menu → Tools → Generators** | Preset editor — manages presets, does not apply them |

Backgrounds resolve per surface in this order: **slide → lyric global → profile default**.

> Modules get generators through `ui.openBackgroundPicker(...)` and the `SelectedBackground` union.

---

## Applying a generator

1. Open the background picker.
2. Stay in the **Themes** tab — generator presets are the first cards.
3. Hover a card to read its name; each card plays a small, muted, low-resolution preview.
4. Click the card.
5. Click **Set Background**.

Closing the picker without **Set Background** keeps the previous background. There is no separate "apply" step per surface: the picker writes the chosen background wherever it was opened from (lyric global, slide, profile default or module).

---

## The parameter panel

Every effect has the same first block and then its own controls.

### Common controls

| Control | What it does |
|---|---|
| **Speed** | Global animation speed. `0` freezes the effect. |
| **Scale** | Size of the features. Small = dense/detailed, large = broad. |
| **Intensity** | Overall contrast/brightness of the effect. |
| **Color A / Color B** | The two palette colors. Defaults follow the active theme. |
| **Seed** | Variation. The same seed always produces the same look. |
| **Randomize** | Dice button that picks a new seed. |
| **Reset** | Restores every slider to the effect defaults. |

### Groups

Effect-specific sliders are grouped to keep the panel short:

- **Motion** — speed, drift, flow, turbulence.
- **Shape** — scale, density, layers, width.
- **Color** — palette, glow, saturation.
- **Advanced** — seed, uncommon controls.

Slider ranges are clamped by the engine; you cannot produce an invalid effect.

---

## Presets

Open **Tools → Generators** to manage presets. The dialog has two tabs:

- **Presets** — lists built-in and saved presets. Load one into the editor, or delete a preset you created. Built-ins cannot be edited or deleted.
- **Editor** — picks the effect, shows the generated sliders and saves the current effect, parameters and seed under a name you choose. Saving an existing user preset overwrites it.

In the background picker, the same presets appear as cards in the **Themes** tab, for selection only. There is no editing from the picker: choose a preset, confirm, and edit it later in the Tools dialog.

- **Built-in presets** ship with the app (for example "Calm aurora", "Deep space", "Stage smoke").
- **Your presets** are saved locally and appear alongside the built-ins.
- Selecting a preset fills every slider; you can keep editing and apply.
- **Save as preset** stores the current effect, parameters and seed under a name you choose.
- Presets are per-machine, stored in `config/background-presets/`, validated against the Rust catalog and survive updates.

---

## How a generator is stored

- **Lyric files, stream payloads and the mobile HTML payload** carry a compact URI: `lumen-bg://generator/<effect>?v=1&seed=<n>&p=<base64url params>`. A show therefore stays portable and small.
- **Profiles** store the generator structured (`effect`, `params`, `seed`, `preset`), so older profile files that only carry `type`/`src`/`name` keep loading unchanged.

---

## Behavior on the output

| Output | Behavior |
|---|---|
| **Picker cards** | Live canvas, muted, low resolution, 30 fps |
| **Settings preview, lyric slide preview, slide thumbnails** | Live canvas at half resolution; sequence thumbnails use a static palette poster |
| **Media / output window** | Full quality, up to 60 fps |
| **Presenter module backdrop** | Same effect, at the module's container size |
| **Mobile HTML preview** | Static gradient derived from the effect's palette — generators stay desktop-only |
| **WebRTC stream** | Captured from the output window automatically |

### Sync

Each surface runs its own animation phase, so previews and the output show the same effect at different moments. Starting from the same moment across windows (a shared clock) is still pending.

---

## Readability over text

Bright or busy generators can hurt lyric legibility. Use the existing dim/overlay control on the stage to darken the background behind the text. Generators are designed to look good with a 20–40% black overlay.

If you need a calmer look:

1. Lower **Intensity**.
2. Lower **Speed**.
3. Prefer effects from the *Gradients* or *Particles* families.
4. Increase the text overlay opacity.

---

## Performance

Generators run on the GPU in real time. What the app already does to keep things light:

- Previews are capped at 30 fps and half resolution; only the output window runs at full quality.
- Thumbnails are static palette posters, not live canvases.
- Animation stops while the window is hidden.
- If the GPU context is lost or WebGL2 is unavailable, the layer hides the canvas and keeps the palette gradient — never a black screen.

A single **Background quality** setting (Auto / High / Balanced / Performance) is planned but not shipped yet. Until then, close extra preview windows or the presenter module when the effect stutters.

---

## Troubleshooting

### The background is black or a flat gradient

- The machine or driver may not support WebGL2. Lumen falls back to the palette gradient instead of crashing.
- Update the graphics driver.
- Try a cheaper effect (Aurora, Mesh gradient, Starfield).

### The effect stutters

- Close extra preview windows or the presenter module.
- Lower **Intensity**/**Scale**, which reduces per-pixel work for some effects.
- Prefer a Tier 0 effect over Smoke or Trails (feedback passes).

### The preview and the output look different

- They may be at different resolutions; some effects intentionally change density with scale. This is not a bug.
- Each surface keeps its own animation phase, so the two are not frame-identical.

### The mobile HTML preview does not animate

- Expected: generators run on desktop only. Phones receive a static gradient derived from the effect's palette.

### My background changed after an app update

- Effects can receive a new version when parameters change. Presets are migrated to the new defaults.
- Re-apply the preset or reset the effect if a slider looks different.

---

## Notes

- Generators are **time-driven only**; they do not react to audio.
- Nothing is exported or written to disk — the effect is generated live every frame.
- The effect catalog ships 42 generators: gradients and soft fields (aurora, mesh gradient, plasma, nebula, clouds, marble, caustics), waves and motion (waves, ripples, flow field, ribbons, lissajous, neon tunnel, retro sun), particles (starfield, star twinkle, snowfall, rain, floating dust, bokeh, fireflies, embers), geometry (voronoi, halftone, hex grid, grid pulse, topographic, moiré, kaleidoscope, dither, wireframe terrain, SDF shapes), stylized (glitch, holographic, liquid metal, vignette pulse) and six feedback effects (smoke, trails, pixel sorting, ink bloom, glitch feedback, reaction-diffusion).
- Old image/video/theme backgrounds keep working exactly as before and can be mixed with generators in the same show.
