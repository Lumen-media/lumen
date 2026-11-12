//! Generator background engine, authored in Rust.
//!
//! This module is the source of truth for the generator catalog: effect
//! definitions, parameter schemas, WGSL sources, shader assembly and the
//! WGSL -> GLSL ES 3.00 conversion. The frontend never declares effects or
//! parameter semantics; it consumes the bundle produced by
//! `cargo run --example bg_compile`, and `background_presets` validates user
//! presets against the same catalog.

pub mod catalog;
pub mod compile;
pub mod schema;

pub use catalog::{catalog, layout};
pub use compile::{compile_catalog, generate_typescript, write_generated};
pub use schema::{
    Category, CostHint, EffectDef, ParamGroup, ParamKind, ParamScale, ParamSpec, ParamValue, PassDef,
    UniformLayout,
};
