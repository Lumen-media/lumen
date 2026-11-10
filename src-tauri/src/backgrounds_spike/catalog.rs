//! Static catalog for the generator backgrounds: every effect documented in
//! `docs/architecture/generator-backgrounds-plan.md` that a single fragment
//! pass can render (Tier 0) plus the Tier 1 feedback set.
//!
//! Parameter order is meaningful: effect-specific parameters are packed into
//! `u_extra` in declaration order, and `uniform_index` records the slot.

use super::schema::*;

/// First float index of `u_extra` in the packed uniform buffer.
pub const EXTRA_BASE: u32 = 16;
/// Floats available in `u_extra` (4 `vec4`).
pub const EXTRA_CAPACITY: u32 = 16;
/// Total floats in the shared uniform block.
pub const FLOAT_COUNT: u32 = EXTRA_BASE + EXTRA_CAPACITY;

const MOTION: ParamGroup = ParamGroup::Motion;
const SHAPE: ParamGroup = ParamGroup::Shape;
const COLOR: ParamGroup = ParamGroup::Color;

/// Packing of the shared uniform block, consumed by the WebGL engine.
pub fn layout() -> UniformLayout {
    UniformLayout {
        float_count: FLOAT_COUNT,
        time: 0,
        dt: 1,
        resolution: 2,
        seed: 4,
        speed: 5,
        scale: 6,
        intensity: 7,
        color_a: 8,
        color_b: 12,
        extra: EXTRA_BASE,
        extra_capacity: EXTRA_CAPACITY,
    }
}

/// Every effect available in the generator, in picker order.
pub fn catalog() -> Vec<EffectDef> {
    vec![
        // Gradients and soft fields.
        aurora(),
        mesh_gradient(),
        plasma(),
        nebula(),
        clouds(),
        marble(),
        caustics(),
        // Waves and motion.
        waves(),
        ripples(),
        flow_field(),
        ribbons(),
        lissajous(),
        neon_tunnel(),
        retro_sun(),
        // Particles and points.
        starfield(),
        star_twinkle(),
        snowfall(),
        rain(),
        floating_dust(),
        bokeh(),
        fireflies(),
        embers(),
        // Geometry and patterns.
        voronoi(),
        halftone(),
        hex_grid(),
        grid_pulse(),
        topographic(),
        moire(),
        kaleidoscope(),
        dither(),
        wireframe_terrain(),
        sdf_shapes(),
        // Stylized / graphic.
        glitch(),
        holographic(),
        liquid_metal(),
        vignette_pulse(),
        // Feedback (Tier 1).
        smoke(),
        trails(),
        pixel_sorting(),
        ink_bloom(),
        glitch_feedback(),
        reaction_diffusion(),
    ]
}

fn common_params() -> Vec<ParamSpec> {
    vec![
        ParamSpec {
            key: "speed",
            label: "Speed",
            kind: ParamKind::Float,
            default: ParamValue::Number(1.0),
            min: Some(0.0),
            max: Some(4.0),
            step: Some(0.01),
            scale: ParamScale::Log,
            group: ParamGroup::Motion,
            uniform: "u_speed",
            uniform_index: 5,
            options: vec![],
        },
        ParamSpec {
            key: "scale",
            label: "Scale",
            kind: ParamKind::Float,
            default: ParamValue::Number(1.0),
            min: Some(0.1),
            max: Some(4.0),
            step: Some(0.01),
            scale: ParamScale::Log,
            group: ParamGroup::Shape,
            uniform: "u_scale",
            uniform_index: 6,
            options: vec![],
        },
        ParamSpec {
            key: "intensity",
            label: "Intensity",
            kind: ParamKind::Float,
            default: ParamValue::Number(1.0),
            min: Some(0.0),
            max: Some(1.5),
            step: Some(0.01),
            scale: ParamScale::Linear,
            group: ParamGroup::Shape,
            uniform: "u_intensity",
            uniform_index: 7,
            options: vec![],
        },
        ParamSpec {
            key: "seed",
            label: "Seed",
            kind: ParamKind::Seed,
            default: ParamValue::Number(42.0),
            min: Some(0.0),
            max: Some(9999.0),
            step: Some(1.0),
            scale: ParamScale::Linear,
            group: ParamGroup::Advanced,
            uniform: "u_seed",
            uniform_index: 4,
            options: vec![],
        },
        ParamSpec {
            key: "colorA",
            label: "Color A",
            kind: ParamKind::Color,
            default: ParamValue::Text("#4f7cff".to_string()),
            min: None,
            max: None,
            step: None,
            scale: ParamScale::Linear,
            group: ParamGroup::Color,
            uniform: "u_color_a",
            uniform_index: 8,
            options: vec![],
        },
        ParamSpec {
            key: "colorB",
            label: "Color B",
            kind: ParamKind::Color,
            default: ParamValue::Text("#ff5fa2".to_string()),
            min: None,
            max: None,
            step: None,
            scale: ParamScale::Linear,
            group: ParamGroup::Color,
            uniform: "u_color_b",
            uniform_index: 12,
            options: vec![],
        },
    ]
}

/// Builds one effect-specific parameter packed at `slot` in `u_extra`.
#[allow(clippy::too_many_arguments)]
fn extra(
    slot: u32,
    key: &'static str,
    label: &'static str,
    default: f64,
    min: f64,
    max: f64,
    step: f64,
    group: ParamGroup,
    kind: ParamKind,
) -> ParamSpec {
    ParamSpec {
        key,
        label,
        kind,
        default: ParamValue::Number(default),
        min: Some(min),
        max: Some(max),
        step: Some(step),
        scale: ParamScale::Linear,
        group,
        uniform: "u_extra",
        uniform_index: EXTRA_BASE + slot,
        options: vec![],
    }
}

/// Float parameter packed at `slot`.
fn pf(
    slot: u32,
    key: &'static str,
    label: &'static str,
    default: f64,
    min: f64,
    max: f64,
    group: ParamGroup,
) -> ParamSpec {
    extra(slot, key, label, default, min, max, 0.01, group, ParamKind::Float)
}

/// Integer parameter packed at `slot`.
fn pi(
    slot: u32,
    key: &'static str,
    label: &'static str,
    default: f64,
    min: f64,
    max: f64,
    group: ParamGroup,
) -> ParamSpec {
    extra(slot, key, label, default, min, max, 1.0, group, ParamKind::Int)
}

#[allow(clippy::too_many_arguments)]
fn effect(
    id: &'static str,
    name: &'static str,
    category: Category,
    tier: u8,
    cost: CostHint,
    pass_id: &'static str,
    feedback: bool,
    source: &'static str,
    extras: Vec<ParamSpec>,
) -> EffectDef {
    let mut params = common_params();
    params.extend(extras);
    EffectDef {
        id,
        name,
        category,
        tier,
        version: 1,
        cost,
        passes: vec![PassDef {
            id: pass_id,
            feedback,
            source,
        }],
        params,
    }
}

fn stateless(
    id: &'static str,
    name: &'static str,
    category: Category,
    cost: CostHint,
    source: &'static str,
    extras: Vec<ParamSpec>,
) -> EffectDef {
    effect(id, name, category, 0, cost, "main", false, source, extras)
}

fn feedback(
    id: &'static str,
    name: &'static str,
    cost: CostHint,
    source: &'static str,
    extras: Vec<ParamSpec>,
) -> EffectDef {
    effect(id, name, Category::Feedback, 1, cost, "sim", true, source, extras)
}

// Gradients -----------------------------------------------------------------

fn aurora() -> EffectDef {
    stateless(
        "aurora",
        "Aurora",
        Category::Gradients,
        CostHint::Low,
        include_str!("effects/aurora.wgsl"),
        vec![
            pi(0, "bands", "Bands", 5.0, 2.0, 8.0, SHAPE),
            pf(1, "flow", "Flow", 0.6, 0.0, 1.0, MOTION),
            pf(2, "glow", "Glow", 0.7, 0.0, 1.0, COLOR),
            pf(3, "hueShift", "Hue shift", 0.0, 0.0, 1.0, COLOR),
        ],
    )
}

fn mesh_gradient() -> EffectDef {
    stateless(
        "mesh-gradient",
        "Mesh gradient",
        Category::Gradients,
        CostHint::Low,
        include_str!("effects/mesh_gradient.wgsl"),
        vec![
            pi(0, "points", "Points", 5.0, 3.0, 8.0, SHAPE),
            pf(1, "warp", "Warp", 0.4, 0.0, 1.0, MOTION),
            pf(2, "blur", "Blur", 0.4, 0.0, 1.0, SHAPE),
            pf(3, "saturation", "Saturation", 0.6, 0.0, 1.0, COLOR),
        ],
    )
}

fn plasma() -> EffectDef {
    stateless(
        "plasma",
        "Plasma",
        Category::Gradients,
        CostHint::Low,
        include_str!("effects/plasma.wgsl"),
        vec![
            pf(0, "frequency", "Frequency", 6.0, 1.0, 12.0, MOTION),
            pf(1, "warp", "Warp", 0.3, 0.0, 2.0, SHAPE),
            pi(2, "detail", "Detail", 3.0, 1.0, 4.0, SHAPE),
        ],
    )
}

fn nebula() -> EffectDef {
    stateless(
        "nebula",
        "Nebula",
        Category::Gradients,
        CostHint::Medium,
        include_str!("effects/nebula.wgsl"),
        vec![
            pi(0, "layers", "Layers", 4.0, 2.0, 6.0, SHAPE),
            pf(1, "coverage", "Coverage", 0.6, 0.0, 1.0, SHAPE),
            pf(2, "drift", "Drift", 0.5, 0.0, 2.0, MOTION),
        ],
    )
}

fn clouds() -> EffectDef {
    stateless(
        "clouds",
        "Clouds",
        Category::Gradients,
        CostHint::Medium,
        include_str!("effects/clouds.wgsl"),
        vec![
            pf(0, "coverage", "Coverage", 0.5, 0.0, 1.0, SHAPE),
            pi(1, "detail", "Detail", 4.0, 1.0, 6.0, SHAPE),
            pf(2, "drift", "Drift", 0.4, 0.0, 2.0, MOTION),
        ],
    )
}

fn marble() -> EffectDef {
    stateless(
        "marble",
        "Marble",
        Category::Gradients,
        CostHint::Medium,
        include_str!("effects/marble.wgsl"),
        vec![
            pi(0, "veins", "Veins", 5.0, 1.0, 10.0, SHAPE),
            pf(1, "turbulence", "Turbulence", 0.6, 0.0, 2.0, MOTION),
            pi(2, "scaleDetail", "Detail", 3.0, 1.0, 6.0, SHAPE),
        ],
    )
}

fn caustics() -> EffectDef {
    stateless(
        "caustics",
        "Caustics",
        Category::Gradients,
        CostHint::Medium,
        include_str!("effects/caustics.wgsl"),
        vec![
            pf(0, "sharpness", "Sharpness", 0.6, 0.0, 1.0, SHAPE),
            pf(1, "depth", "Depth", 0.5, 0.0, 1.0, SHAPE),
            pf(2, "causticScale", "Scale detail", 3.0, 1.0, 8.0, SHAPE),
        ],
    )
}

// Waves and motion ----------------------------------------------------------

fn waves() -> EffectDef {
    stateless(
        "waves",
        "Waves",
        Category::Waves,
        CostHint::Low,
        include_str!("effects/waves.wgsl"),
        vec![
            pi(0, "layers", "Layers", 4.0, 1.0, 6.0, SHAPE),
            pf(1, "amplitude", "Amplitude", 0.6, 0.0, 1.0, SHAPE),
            pf(2, "frequency", "Frequency", 4.0, 1.0, 12.0, MOTION),
            pf(3, "slope", "Slope", 0.0, -1.0, 1.0, MOTION),
        ],
    )
}

fn ripples() -> EffectDef {
    stateless(
        "ripples",
        "Ripples",
        Category::Waves,
        CostHint::Low,
        include_str!("effects/ripples.wgsl"),
        vec![
            pf(0, "centerX", "Center X", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "centerY", "Center Y", 0.5, 0.0, 1.0, SHAPE),
            pf(2, "frequency", "Frequency", 10.0, 1.0, 20.0, MOTION),
            pf(3, "decay", "Decay", 0.5, 0.0, 1.0, SHAPE),
        ],
    )
}

fn flow_field() -> EffectDef {
    stateless(
        "flow-field",
        "Flow field",
        Category::Waves,
        CostHint::Medium,
        include_str!("effects/flow_field.wgsl"),
        vec![
            pf(0, "density", "Density", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "lineWidth", "Line width", 0.3, 0.0, 1.0, SHAPE),
            pf(2, "turbulence", "Turbulence", 0.6, 0.0, 2.0, MOTION),
            pf(3, "glow", "Glow", 0.6, 0.0, 1.0, COLOR),
        ],
    )
}

fn ribbons() -> EffectDef {
    stateless(
        "ribbons",
        "Ribbons",
        Category::Waves,
        CostHint::Medium,
        include_str!("effects/ribbons.wgsl"),
        vec![
            pi(0, "strands", "Strands", 8.0, 2.0, 16.0, SHAPE),
            pf(1, "width", "Width", 0.3, 0.0, 1.0, SHAPE),
            pf(2, "turbulence", "Turbulence", 0.5, 0.0, 2.0, MOTION),
            pf(3, "glow", "Glow", 0.5, 0.0, 1.0, COLOR),
        ],
    )
}

fn lissajous() -> EffectDef {
    stateless(
        "lissajous",
        "Lissajous",
        Category::Waves,
        CostHint::Medium,
        include_str!("effects/lissajous.wgsl"),
        vec![
            pi(0, "ratioA", "Ratio A", 3.0, 1.0, 9.0, SHAPE),
            pi(1, "ratioB", "Ratio B", 4.0, 1.0, 9.0, SHAPE),
            pf(2, "phase", "Phase", 0.0, 0.0, 1.0, MOTION),
            pf(3, "lineWidth", "Line width", 0.3, 0.0, 1.0, SHAPE),
            pf(4, "trail", "Trail", 0.5, 0.0, 1.0, MOTION),
        ],
    )
}

fn neon_tunnel() -> EffectDef {
    stateless(
        "neon-tunnel",
        "Neon tunnel",
        Category::Waves,
        CostHint::Medium,
        include_str!("effects/neon_tunnel.wgsl"),
        vec![
            pi(0, "rings", "Rings", 8.0, 2.0, 16.0, SHAPE),
            pf(1, "twist", "Twist", 0.6, 0.0, 2.0, MOTION),
            pf(2, "glow", "Glow", 0.6, 0.0, 1.0, COLOR),
            pf(3, "vignette", "Vignette", 0.5, 0.0, 1.0, SHAPE),
        ],
    )
}

fn retro_sun() -> EffectDef {
    stateless(
        "retro-sun",
        "Retro sun",
        Category::Waves,
        CostHint::Medium,
        include_str!("effects/retro_sun.wgsl"),
        vec![
            pf(0, "sunSize", "Sun size", 0.5, 0.0, 1.0, SHAPE),
            pi(1, "stripeCount", "Stripes", 8.0, 2.0, 20.0, SHAPE),
            pf(2, "horizon", "Horizon", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "scroll", "Scroll", 0.5, 0.0, 2.0, MOTION),
        ],
    )
}

// Particles -----------------------------------------------------------------

fn starfield() -> EffectDef {
    stateless(
        "starfield",
        "Starfield",
        Category::Particles,
        CostHint::Low,
        include_str!("effects/starfield.wgsl"),
        vec![
            pf(0, "density", "Density", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "twinkle", "Twinkle", 0.6, 0.0, 1.0, MOTION),
            pf(2, "warp", "Warp", 0.2, 0.0, 1.0, MOTION),
            pf(3, "depth", "Depth", 0.6, 0.0, 1.0, SHAPE),
        ],
    )
}

fn star_twinkle() -> EffectDef {
    stateless(
        "star-twinkle",
        "Star twinkle",
        Category::Particles,
        CostHint::Low,
        include_str!("effects/star_twinkle.wgsl"),
        vec![
            pf(0, "density", "Density", 0.4, 0.0, 1.0, SHAPE),
            pf(1, "sizeVariance", "Size variance", 0.5, 0.0, 1.0, SHAPE),
            pf(2, "twinkleSpeed", "Twinkle speed", 0.6, 0.0, 2.0, MOTION),
        ],
    )
}

fn snowfall() -> EffectDef {
    stateless(
        "snowfall",
        "Snowfall",
        Category::Particles,
        CostHint::Low,
        include_str!("effects/snowfall.wgsl"),
        vec![
            pf(0, "density", "Density", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "wind", "Wind", 0.0, -1.0, 1.0, MOTION),
            pf(2, "size", "Size", 0.4, 0.0, 1.0, SHAPE),
            pf(3, "blur", "Blur", 0.3, 0.0, 1.0, SHAPE),
        ],
    )
}

fn rain() -> EffectDef {
    stateless(
        "rain",
        "Rain",
        Category::Particles,
        CostHint::Medium,
        include_str!("effects/rain.wgsl"),
        vec![
            pf(0, "density", "Density", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "angle", "Angle", 12.0, -45.0, 45.0, MOTION),
            pf(2, "length", "Length", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "splash", "Splash", 0.3, 0.0, 1.0, SHAPE),
        ],
    )
}

fn floating_dust() -> EffectDef {
    stateless(
        "floating-dust",
        "Floating dust",
        Category::Particles,
        CostHint::Low,
        include_str!("effects/floating_dust.wgsl"),
        vec![
            pf(0, "density", "Density", 0.4, 0.0, 1.0, SHAPE),
            pf(1, "size", "Size", 0.4, 0.0, 1.0, SHAPE),
            pf(2, "drift", "Drift", 0.5, 0.0, 2.0, MOTION),
            pf(3, "bokeh", "Bokeh", 0.4, 0.0, 1.0, SHAPE),
        ],
    )
}

fn bokeh() -> EffectDef {
    stateless(
        "bokeh",
        "Bokeh",
        Category::Particles,
        CostHint::High,
        include_str!("effects/bokeh.wgsl"),
        vec![
            pi(0, "count", "Count", 14.0, 1.0, 32.0, SHAPE),
            pf(1, "size", "Size", 0.5, 0.0, 1.0, SHAPE),
            pf(2, "blur", "Blur", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "drift", "Drift", 0.5, 0.0, 2.0, MOTION),
        ],
    )
}

fn fireflies() -> EffectDef {
    stateless(
        "fireflies",
        "Fireflies",
        Category::Particles,
        CostHint::Medium,
        include_str!("effects/fireflies.wgsl"),
        vec![
            pf(0, "density", "Density", 0.4, 0.0, 1.0, SHAPE),
            pf(1, "wander", "Wander", 0.6, 0.0, 2.0, MOTION),
            pf(2, "glow", "Glow", 0.6, 0.0, 1.0, COLOR),
            pf(3, "blink", "Blink", 0.5, 0.0, 1.0, MOTION),
        ],
    )
}

fn embers() -> EffectDef {
    stateless(
        "embers",
        "Embers",
        Category::Particles,
        CostHint::Medium,
        include_str!("effects/embers.wgsl"),
        vec![
            pf(0, "spawnRate", "Spawn rate", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "rise", "Rise", 0.6, 0.0, 2.0, MOTION),
            pf(2, "flicker", "Flicker", 0.5, 0.0, 1.0, MOTION),
            pf(3, "glow", "Glow", 0.6, 0.0, 1.0, COLOR),
        ],
    )
}

// Geometry ------------------------------------------------------------------

fn voronoi() -> EffectDef {
    stateless(
        "voronoi",
        "Voronoi",
        Category::Geometry,
        CostHint::High,
        include_str!("effects/voronoi.wgsl"),
        vec![
            pf(0, "cells", "Cells", 8.0, 4.0, 40.0, SHAPE),
            pf(1, "edgeGlow", "Edge glow", 0.5, 0.0, 1.0, COLOR),
            pf(2, "warp", "Warp", 0.2, 0.0, 1.0, MOTION),
            pf(3, "shade", "Shade", 0.5, 0.0, 1.0, SHAPE),
        ],
    )
}

fn halftone() -> EffectDef {
    stateless(
        "halftone",
        "Halftone",
        Category::Geometry,
        CostHint::Low,
        include_str!("effects/halftone.wgsl"),
        vec![
            pf(0, "dotSize", "Dot size", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "angle", "Angle", 45.0, 0.0, 180.0, SHAPE),
            pf(2, "contrast", "Contrast", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "animate", "Animate", 0.5, 0.0, 1.0, MOTION),
        ],
    )
}

fn hex_grid() -> EffectDef {
    stateless(
        "hex-grid",
        "Hex grid",
        Category::Geometry,
        CostHint::Medium,
        include_str!("effects/hex_grid.wgsl"),
        vec![
            pf(0, "hexSize", "Hex size", 10.0, 4.0, 40.0, SHAPE),
            pf(1, "pulse", "Pulse", 0.5, 0.0, 1.0, MOTION),
            pf(2, "glow", "Glow", 0.6, 0.0, 1.0, COLOR),
            pf(3, "lineWidth", "Line width", 0.3, 0.0, 1.0, SHAPE),
        ],
    )
}

fn grid_pulse() -> EffectDef {
    stateless(
        "grid-pulse",
        "Grid pulse",
        Category::Geometry,
        CostHint::Low,
        include_str!("effects/grid_pulse.wgsl"),
        vec![
            pf(0, "spacing", "Spacing", 12.0, 4.0, 40.0, SHAPE),
            pf(1, "waveSpeed", "Wave speed", 0.6, 0.0, 2.0, MOTION),
            pf(2, "lineWidth", "Line width", 0.3, 0.0, 1.0, SHAPE),
            pf(3, "fade", "Fade", 0.5, 0.0, 1.0, SHAPE),
        ],
    )
}

fn topographic() -> EffectDef {
    stateless(
        "topographic",
        "Topographic",
        Category::Geometry,
        CostHint::Medium,
        include_str!("effects/topographic.wgsl"),
        vec![
            pi(0, "contourCount", "Contours", 8.0, 2.0, 20.0, SHAPE),
            pi(1, "scaleDetail", "Detail", 3.0, 1.0, 6.0, SHAPE),
            pf(2, "drift", "Drift", 0.4, 0.0, 2.0, MOTION),
            pf(3, "lineWidth", "Line width", 0.3, 0.0, 1.0, SHAPE),
        ],
    )
}

fn moire() -> EffectDef {
    stateless(
        "moire",
        "Moire",
        Category::Geometry,
        CostHint::Low,
        include_str!("effects/moire.wgsl"),
        vec![
            pf(0, "rings", "Rings", 30.0, 10.0, 100.0, SHAPE),
            pf(1, "offset", "Offset", 0.3, 0.0, 1.0, SHAPE),
            pf(2, "rotation", "Rotation", 20.0, 0.0, 360.0, MOTION),
            pf(3, "blend", "Blend", 0.4, 0.0, 1.0, SHAPE),
        ],
    )
}

fn kaleidoscope() -> EffectDef {
    stateless(
        "kaleidoscope",
        "Kaleidoscope",
        Category::Geometry,
        CostHint::Medium,
        include_str!("effects/kaleidoscope.wgsl"),
        vec![
            pi(0, "segments", "Segments", 6.0, 3.0, 16.0, SHAPE),
            pf(1, "rotation", "Rotation", 0.0, 0.0, 360.0, MOTION),
            pf(2, "zoom", "Zoom", 1.4, 0.5, 3.0, SHAPE),
        ],
    )
}

fn dither() -> EffectDef {
    stateless(
        "dither",
        "Dither",
        Category::Geometry,
        CostHint::Low,
        include_str!("effects/dither.wgsl"),
        vec![
            pi(0, "pattern", "Pattern", 0.0, 0.0, 3.0, SHAPE),
            pi(1, "pixelScale", "Pixel scale", 3.0, 1.0, 8.0, SHAPE),
            pf(2, "threshold", "Threshold", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "animate", "Animate", 0.4, 0.0, 1.0, MOTION),
        ],
    )
}

fn wireframe_terrain() -> EffectDef {
    stateless(
        "wireframe-terrain",
        "Wireframe terrain",
        Category::Geometry,
        CostHint::Medium,
        include_str!("effects/wireframe_terrain.wgsl"),
        vec![
            pf(0, "amplitude", "Amplitude", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "gridSize", "Grid size", 16.0, 4.0, 40.0, SHAPE),
            pf(2, "fog", "Fog", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "scroll", "Scroll", 0.5, 0.0, 2.0, MOTION),
        ],
    )
}

fn sdf_shapes() -> EffectDef {
    stateless(
        "sdf-shapes",
        "SDF shapes",
        Category::Geometry,
        CostHint::Low,
        include_str!("effects/sdf_shapes.wgsl"),
        vec![
            pi(0, "shape", "Shape", 0.0, 0.0, 5.0, SHAPE),
            pf(1, "morph", "Morph", 0.5, 0.0, 1.0, MOTION),
            pf(2, "glow", "Glow", 0.6, 0.0, 1.0, COLOR),
            pf(3, "spin", "Spin", 0.3, 0.0, 1.0, MOTION),
        ],
    )
}

// Stylized ------------------------------------------------------------------

fn glitch() -> EffectDef {
    stateless(
        "glitch",
        "Glitch",
        Category::Stylized,
        CostHint::Low,
        include_str!("effects/glitch.wgsl"),
        vec![
            pf(0, "amount", "Amount", 0.4, 0.0, 1.0, SHAPE),
            pf(1, "blockSize", "Block size", 6.0, 1.0, 16.0, SHAPE),
            pf(2, "rgbSplit", "RGB split", 0.4, 0.0, 1.0, COLOR),
            pf(3, "rate", "Rate", 0.4, 0.0, 2.0, MOTION),
        ],
    )
}

fn holographic() -> EffectDef {
    stateless(
        "holographic",
        "Holographic",
        Category::Stylized,
        CostHint::Low,
        include_str!("effects/holographic.wgsl"),
        vec![
            pi(0, "bands", "Bands", 6.0, 1.0, 12.0, SHAPE),
            pf(1, "angle", "Angle", 35.0, 0.0, 360.0, SHAPE),
            pf(2, "saturation", "Saturation", 0.7, 0.0, 1.0, COLOR),
            pf(3, "shine", "Shine", 0.5, 0.0, 1.0, COLOR),
        ],
    )
}

fn liquid_metal() -> EffectDef {
    stateless(
        "liquid-metal",
        "Liquid metal",
        Category::Stylized,
        CostHint::Medium,
        include_str!("effects/liquid_metal.wgsl"),
        vec![
            pf(0, "turbulence", "Turbulence", 0.6, 0.0, 2.0, MOTION),
            pf(1, "contrast", "Contrast", 0.5, 0.0, 1.0, SHAPE),
            pf(2, "sheen", "Sheen", 0.6, 0.0, 1.0, COLOR),
            pf(3, "angle", "Angle", 30.0, 0.0, 360.0, SHAPE),
        ],
    )
}

fn vignette_pulse() -> EffectDef {
    stateless(
        "vignette-pulse",
        "Vignette pulse",
        Category::Stylized,
        CostHint::Low,
        include_str!("effects/vignette_pulse.wgsl"),
        vec![
            pf(0, "vignette", "Vignette", 0.6, 0.0, 1.0, SHAPE),
            pf(1, "pulse", "Pulse", 0.5, 0.0, 1.0, MOTION),
            pf(2, "centerX", "Center X", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "centerY", "Center Y", 0.5, 0.0, 1.0, SHAPE),
        ],
    )
}

// Feedback (Tier 1) ---------------------------------------------------------

fn smoke() -> EffectDef {
    feedback(
        "smoke",
        "Smoke",
        CostHint::Medium,
        include_str!("effects/smoke.wgsl"),
        vec![
            pf(0, "viscosity", "Viscosity", 0.4, 0.0, 1.0, MOTION),
            pf(1, "buoyancy", "Buoyancy", 0.5, 0.0, 1.0, MOTION),
            pf(2, "dissipation", "Dissipation", 0.4, 0.0, 1.0, SHAPE),
            pi(3, "detail", "Detail", 3.0, 1.0, 6.0, SHAPE),
        ],
    )
}

fn trails() -> EffectDef {
    feedback(
        "trails",
        "Trails",
        CostHint::Medium,
        include_str!("effects/trails.wgsl"),
        vec![
            pf(0, "trailLength", "Trail length", 0.6, 0.0, 1.0, MOTION),
            pf(1, "blur", "Blur", 0.4, 0.0, 1.0, SHAPE),
            pf(2, "turbulence", "Turbulence", 0.5, 0.0, 2.0, MOTION),
        ],
    )
}

fn pixel_sorting() -> EffectDef {
    feedback(
        "pixel-sorting",
        "Pixel sorting",
        CostHint::Medium,
        include_str!("effects/pixel_sorting.wgsl"),
        vec![
            pf(0, "threshold", "Threshold", 0.5, 0.0, 1.0, SHAPE),
            pi(1, "direction", "Direction", 0.0, 0.0, 1.0, SHAPE),
            pf(2, "sortSpeed", "Sort speed", 0.5, 0.0, 1.0, MOTION),
        ],
    )
}

fn ink_bloom() -> EffectDef {
    feedback(
        "ink-bloom",
        "Ink bloom",
        CostHint::Medium,
        include_str!("effects/ink_bloom.wgsl"),
        vec![
            pf(0, "spread", "Spread", 0.5, 0.0, 1.0, SHAPE),
            pf(1, "bleed", "Bleed", 0.5, 0.0, 1.0, SHAPE),
            pf(2, "density", "Density", 0.5, 0.0, 1.0, SHAPE),
        ],
    )
}

fn glitch_feedback() -> EffectDef {
    feedback(
        "glitch-feedback",
        "Glitch feedback",
        CostHint::Medium,
        include_str!("effects/glitch_feedback.wgsl"),
        vec![
            pf(0, "amount", "Amount", 0.4, 0.0, 1.0, SHAPE),
            pf(1, "zoom", "Zoom", 1.01, 0.9, 1.1, SHAPE),
            pf(2, "offset", "Offset", 0.4, 0.0, 1.0, MOTION),
        ],
    )
}

fn reaction_diffusion() -> EffectDef {
    feedback(
        "reaction-diffusion",
        "Reaction diffusion",
        CostHint::High,
        include_str!("effects/reaction_diffusion.wgsl"),
        vec![
            pf(0, "feed", "Feed", 0.036, 0.0, 0.1, SHAPE),
            pf(1, "kill", "Kill", 0.061, 0.0, 0.1, SHAPE),
            pf(2, "diffusionA", "Diffusion A", 0.5, 0.0, 1.0, SHAPE),
            pf(3, "diffusionB", "Diffusion B", 0.25, 0.0, 1.0, SHAPE),
        ],
    )
}
