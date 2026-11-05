# Generator Backgrounds — Usage Guide

> Related: [Feature plan](../architecture/generator-backgrounds-plan.md) · [Architecture](../architecture/generator-backgrounds-architecture.md) · [Phase 0 spike](../architecture/generator-backgrounds-spike.md)

Generator backgrounds are animated, procedural backgrounds that run forever. Instead of importing an image or a video loop, you pick an **effect** and shape it with **sliders**. The same effect can look calm or energetic, dark or colorful, without any new file.

---

## Where to find it

Generators are part of the existing background picker, in a new **Generators** tab next to **Themes**, **Images** and **Video**.

In v1 the picker offers generators in the places below. Profile defaults and slide backgrounds keep images/videos:

| Place | What the generator applies to |
|---|---|
| **Lyrics editor → Global background** | Every slide in that lyric file |
| **Notices** | The notices background |
| **Titlebar menu → Tools → Generators** | Opens the picker directly on the Generators tab |
| **Modules / presenter backdrop** | The module's stage backdrop |
| ~~Settings → Appearance → Default background~~ | Deferred: profile defaults keep images/videos in v1 |
| ~~Lyrics editor → Slide background~~ | Deferred: slides keep images/videos in v1 |
| ~~Before the stage (aside panel)~~ | Deferred: it sets the profile default |

> Modules get generators in v1 through `ui.openBackgroundPicker(...)` and the `SelectedBackground` union.

---

## Applying a generator

1. Open the background picker.
2. Select the **Generators** tab.
3. Browse the grid. Each card plays a small, muted, low-resolution preview.
4. Click an effect to open its **parameter panel**.
5. Adjust the sliders and watch the preview at the top of the panel update immediately.
6. Click **Apply**.

If the output window is open, the change is pushed live while you edit, so you can tune against the real screen. Closing the picker without applying reverts to the previous background.

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

### Live vs applied

- **Live:** every slider change is visible immediately in the preview and in the output window.
- **Applied:** the value is stored in the lyric file (global background) or in the module only after **Apply**.
- Switching to another effect during editing shows a crossfade instead of a hard cut.

---

## Presets

- **Built-in presets** ship with the app (for example "Calm aurora", "Deep space", "Neon grid").
- **Your presets** are saved locally and appear alongside the built-ins.
- Selecting a preset fills every slider; you can keep editing and apply.
- **Save as preset** stores the current effect, parameters and seed under a name you choose.
- Presets are per-machine, stored in the app's config folder, and survive updates.

---

## Behavior on the output

| Output | Behavior |
|---|---|
| **Main window previews** | Lower resolution and 30 fps to keep the editor light |
| **Media / output window** | Full quality, up to 60 fps |
| **Presenter module backdrop** | Same effect, at the module's container size |
| **Mobile HTML preview** | Static gradient derived from the palette — generators are desktop-only in v1 |
| **WebRTC stream** | Captured from the output window automatically |

### Sync

The preview and the output share the same animation phase. Changing **Speed** does not restart or jump the effect — it smoothly speeds up or slows down.

Stateful effects (smoke, trails) may drift slightly between windows over long sessions. This is expected; the main output is always correct.

---

## Readability over text

Bright or busy generators can hurt lyric legibility. Use the existing dim/overlay control on the stage to darken the background behind the text. Generators are designed to look good with a 20–40% black overlay.

If you need a calmer look:

1. Lower **Intensity**.
2. Lower **Speed**.
3. Prefer effects from the *Gradients* or *Particles* families.
4. Increase the text overlay opacity.

---

## Performance and quality

Generators run on the GPU in real time. On lower-end machines, or when several windows are open, use the quality setting:

**Settings → Appearance → Background quality**

| Mode | Behavior |
|---|---|
| **Auto** (recommended) | Scaled by surface: light previews, full output |
| **High** | Full resolution everywhere |
| **Balanced** | 75% resolution, 30 fps previews |
| **Performance** | 50% resolution, 30 fps, cheaper effects feel identical |

Additional automatic behavior:

- The effect **pauses** when the output window is minimized, hidden, in blackout, or off-screen.
- Frame time is monitored; if a machine cannot keep up, resolution drops automatically instead of stuttering.
- Multi-hour sessions are safe: feedback effects are normalized/restarted so they do not slowly fill or fade out.

---

## Troubleshooting

### The background is black or a flat gradient

- The machine or driver may not support WebGL2. Lumen falls back to a static poster instead of crashing.
- Try **Settings → Appearance → Background quality → Performance**.
- Update the graphics driver.

### The effect stutters

- Switch quality to **Balanced** or **Performance**.
- Close extra preview windows or the presenter module.
- Reduce the number of effects visible at once in the picker.

### The preview and the output look different

- They may be at different resolutions; some effects intentionally change density with scale. This is not a bug.
- Stateful effects can drift slightly over hours. Re-apply the background to resync.

### The mobile HTML preview does not animate

- Expected in v1: generators run on desktop only. Phones receive a static gradient derived from the effect's palette.
- The WebRTC preview is intentionally low-FPS; use the desktop output window for the real look.

### My background changed after an app update

- Effects can receive a new version when parameters change. Presets are migrated to the new defaults.
- Re-apply the preset or reset the effect if a slider looks different.

---

## Notes

- Generators are **time-driven only**; they do not react to audio.
- Nothing is exported or written to disk — the effect is generated live every frame.
- A generator reference is stored as a small URI inside lyric files and stream payloads, so shows remain portable.
- Old image/video/theme backgrounds keep working exactly as before and can be mixed with generators in the same show.
