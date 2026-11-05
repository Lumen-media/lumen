//! Static catalog for the spike: 3 Tier 0 effects plus 2 Tier 1 probes.
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

/// Every effect available in the spike, in picker order.
pub fn catalog() -> Vec<EffectDef> {
    vec![aurora(), waves(), starfield(), smoke(), trails()]
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

fn aurora() -> EffectDef {
    effect(
        "aurora",
        "Aurora",
        Category::Gradients,
        0,
        CostHint::Low,
        "main",
        false,
        include_str!("effects/aurora.wgsl"),
        vec![
            extra(
                0,
                "bands",
                "Bands",
                5.0,
                2.0,
                8.0,
                1.0,
                ParamGroup::Shape,
                ParamKind::Int,
            ),
            extra(
                1,
                "flow",
                "Flow",
                0.6,
                0.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                2,
                "glow",
                "Glow",
                0.7,
                0.0,
                1.0,
                0.01,
                ParamGroup::Color,
                ParamKind::Float,
            ),
            extra(
                3,
                "hueShift",
                "Hue shift",
                0.0,
                0.0,
                1.0,
                0.01,
                ParamGroup::Color,
                ParamKind::Float,
            ),
        ],
    )
}

fn waves() -> EffectDef {
    effect(
        "waves",
        "Waves",
        Category::Waves,
        0,
        CostHint::Low,
        "main",
        false,
        include_str!("effects/waves.wgsl"),
        vec![
            extra(
                0,
                "layers",
                "Layers",
                4.0,
                1.0,
                6.0,
                1.0,
                ParamGroup::Shape,
                ParamKind::Int,
            ),
            extra(
                1,
                "amplitude",
                "Amplitude",
                0.6,
                0.0,
                1.0,
                0.01,
                ParamGroup::Shape,
                ParamKind::Float,
            ),
            extra(
                2,
                "frequency",
                "Frequency",
                4.0,
                1.0,
                12.0,
                0.1,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                3,
                "slope",
                "Slope",
                0.0,
                -1.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
        ],
    )
}

fn starfield() -> EffectDef {
    effect(
        "starfield",
        "Starfield",
        Category::Particles,
        0,
        CostHint::Low,
        "main",
        false,
        include_str!("effects/starfield.wgsl"),
        vec![
            extra(
                0,
                "density",
                "Density",
                0.5,
                0.0,
                1.0,
                0.01,
                ParamGroup::Shape,
                ParamKind::Float,
            ),
            extra(
                1,
                "twinkle",
                "Twinkle",
                0.6,
                0.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                2,
                "warp",
                "Warp",
                0.2,
                0.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                3,
                "depth",
                "Depth",
                0.6,
                0.0,
                1.0,
                0.01,
                ParamGroup::Shape,
                ParamKind::Float,
            ),
        ],
    )
}

fn smoke() -> EffectDef {
    effect(
        "smoke",
        "Smoke",
        Category::Feedback,
        1,
        CostHint::Medium,
        "sim",
        true,
        include_str!("effects/smoke.wgsl"),
        vec![
            extra(
                0,
                "viscosity",
                "Viscosity",
                0.4,
                0.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                1,
                "buoyancy",
                "Buoyancy",
                0.5,
                0.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                2,
                "dissipation",
                "Dissipation",
                0.4,
                0.0,
                1.0,
                0.01,
                ParamGroup::Shape,
                ParamKind::Float,
            ),
            extra(
                3,
                "detail",
                "Detail",
                3.0,
                1.0,
                6.0,
                1.0,
                ParamGroup::Shape,
                ParamKind::Int,
            ),
        ],
    )
}

fn trails() -> EffectDef {
    effect(
        "trails",
        "Trails",
        Category::Feedback,
        1,
        CostHint::Medium,
        "sim",
        true,
        include_str!("effects/trails.wgsl"),
        vec![
            extra(
                0,
                "trailLength",
                "Trail length",
                0.6,
                0.0,
                1.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
            extra(
                1,
                "blur",
                "Blur",
                0.4,
                0.0,
                1.0,
                0.01,
                ParamGroup::Shape,
                ParamKind::Float,
            ),
            extra(
                2,
                "turbulence",
                "Turbulence",
                0.5,
                0.0,
                2.0,
                0.01,
                ParamGroup::Motion,
                ParamKind::Float,
            ),
        ],
    )
}
