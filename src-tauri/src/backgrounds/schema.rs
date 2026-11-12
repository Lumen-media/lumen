//! Serializable schema for the generator catalog.
//!
//! Mirrors the frontend types one-to-one; the generated TypeScript bundle is
//! the only copy the webview sees.

use serde::Serialize;

/// Visual family used to group effects in the picker.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Gradients,
    Waves,
    Particles,
    Geometry,
    Stylized,
    Feedback,
}

/// Rough per-frame cost, used by the engine to pick default quality.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CostHint {
    Low,
    Medium,
    High,
}

/// Control the picker renders for a parameter.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ParamKind {
    Float,
    Int,
    Bool,
    Color,
    Enum,
    Seed,
}

/// Slider mapping from screen position to value.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ParamScale {
    Linear,
    Log,
}

/// Section of the parameter panel a control belongs to.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ParamGroup {
    Motion,
    Shape,
    Color,
    Advanced,
}

/// Parameter default, serialized untagged so the UI can use it directly.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ParamValue {
    Number(f64),
    Bool(bool),
    Text(String),
}

/// One option of an `Enum` parameter.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumOption {
    pub value: String,
    pub label: String,
}

/// A single adjustable parameter.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub kind: ParamKind,
    pub default: ParamValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    pub scale: ParamScale,
    pub group: ParamGroup,
    /// WGSL uniform this parameter feeds, for documentation only.
    pub uniform: &'static str,
    /// Float index inside the packed uniform buffer.
    pub uniform_index: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<EnumOption>,
}

/// One shader pass of an effect.
#[derive(Debug, Clone)]
pub struct PassDef {
    pub id: &'static str,
    /// Whether the pass samples the previous frame (ping-pong).
    pub feedback: bool,
    /// Effect body, injected after the shared prelude.
    pub source: &'static str,
}

/// A generator effect: metadata, passes and parameters, all owned by Rust.
#[derive(Debug, Clone)]
pub struct EffectDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub tier: u8,
    pub version: u32,
    pub cost: CostHint,
    pub passes: Vec<PassDef>,
    pub params: Vec<ParamSpec>,
}

/// std140-compatible packing of the shared uniform block, in float indices.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UniformLayout {
    pub float_count: u32,
    pub time: u32,
    pub dt: u32,
    pub resolution: u32,
    pub seed: u32,
    pub speed: u32,
    pub scale: u32,
    pub intensity: u32,
    pub color_a: u32,
    pub color_b: u32,
    pub extra: u32,
    pub extra_capacity: u32,
}
