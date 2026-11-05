//! WGSL -> GLSL ES 3.00 compilation and TypeScript bundle generation.
//!
//! The bundle is the only contract with the webview: effect metadata,
//! parameter schemas, packed-uniform layout and compiled shader sources.

use std::path::Path;

use naga::ShaderStage;
use serde_json::{json, Value};

use super::catalog;
use super::schema::{EffectDef, UniformLayout};

const PRELUDE: &str = include_str!("prelude.wgsl");
const VERTEX: &str = include_str!("fullscreen.wgsl");
const DISPLAY: &str = include_str!("display.wgsl");

/// Edge case: loop bound comes from a uniform (allowed by GLSL ES 3.00).
const EDGE_DYNAMIC_LOOP: &str = r#"
@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  var acc = 0.0;
  let count = i32(P.u_extra[0].x);
  for (var i = 0; i < count; i = i + 1) {
    acc = acc + f32(i);
  }
  return vec4<f32>(acc * 0.01, frag.x * 0.0, 0.0, 1.0);
}
"#;

/// Edge case: dense `fract`/`sin` math plus vector reassignment.
const EDGE_FRACT_SIN: &str = r#"
@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  var v = frag.xy / max(P.u_resolution, vec2<f32>(1.0, 1.0));
  var acc = vec3<f32>(0.0);
  for (var i = 0; i < 12; i = i + 1) {
    let f = f32(i);
    v = fract(v * (1.7 + f * 0.13) + vec2<f32>(sin(f), cos(f)));
    acc = acc + vec3<f32>(sin(v.x * 20.0), cos(v.y * 20.0), sin((v.x + v.y) * 10.0));
  }
  return vec4<f32>(fract(acc * 0.1), 0.5);
}
"#;

/// One compiled shader pass.
#[derive(Debug, Clone)]
pub struct CompiledPass {
    pub id: &'static str,
    pub feedback: bool,
    /// Name of the combined sampler uniform in the emitted GLSL, if any.
    pub sampler: Option<String>,
    /// Name of the uniform block emitted by naga (e.g. `Params_block_0Fragment`).
    pub uniform_block: String,
    pub glsl: String,
}

/// An effect definition paired with its compiled passes.
#[derive(Debug, Clone)]
pub struct CompiledEffect {
    pub def: EffectDef,
    pub passes: Vec<CompiledPass>,
}

fn compile_wgsl(source: &str, stage: ShaderStage) -> Result<String, String> {
    let module =
        naga::front::wgsl::parse_str(source).map_err(|error| format!("WGSL parse error:\n{error}"))?;

    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    );
    let info = validator
        .validate(&module)
        .map_err(|error| format!("WGSL validation error:\n{error}"))?;

    let options = naga::back::glsl::Options {
        version: naga::back::glsl::Version::Embedded {
            version: 300,
            is_webgl: true,
        },
        ..Default::default()
    };
    let pipeline = naga::back::glsl::PipelineOptions {
        shader_stage: stage,
        entry_point: "main".to_string(),
        multiview: None,
    };

    let mut output = String::new();
    let mut writer = naga::back::glsl::Writer::new(
        &mut output,
        &module,
        &info,
        &options,
        &pipeline,
        Default::default(),
    )
    .map_err(|error| format!("GLSL writer error:\n{error}"))?;
    writer
        .write()
        .map_err(|error| format!("GLSL emit error:\n{error}"))?;
    Ok(output)
}

/// Finds the name of the uniform block emitted by naga.
fn uniform_block(glsl: &str) -> Option<String> {
    for (index, _) in glsl.match_indices("uniform ") {
        let rest = &glsl[index + "uniform ".len()..];
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() {
            continue;
        }
        if rest[name.len()..].trim_start().starts_with('{') {
            return Some(name);
        }
    }
    None
}

/// Finds the name of the combined sampler uniform emitted by naga.
fn sampler_uniform(glsl: &str) -> Option<String> {
    glsl.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("uniform ")?;
        let rest = rest
            .strip_prefix("highp ")
            .or_else(|| rest.strip_prefix("mediump "))
            .or_else(|| rest.strip_prefix("lowp "))
            .unwrap_or(rest);
        let rest = rest.strip_prefix("sampler2D ")?;
        let name = rest.trim_end_matches(';').trim();
        (!name.is_empty()).then(|| name.to_string())
    })
}

/// Compiles every catalog effect. Fails on the first shader error.
pub fn compile_catalog() -> Result<Vec<CompiledEffect>, String> {
    catalog::catalog()
        .into_iter()
        .map(|def| {
            let mut passes = Vec::new();
            for pass in &def.passes {
                let source = format!("{PRELUDE}\n{}", pass.source);
                let glsl = compile_wgsl(&source, ShaderStage::Fragment).map_err(|error| {
                    format!("effect `{}` pass `{}`:\n{error}", def.id, pass.id)
                })?;

                let block = uniform_block(&glsl).ok_or_else(|| {
                    format!(
                        "effect `{}` pass `{}` emitted no uniform block",
                        def.id, pass.id
                    )
                })?;

                passes.push(CompiledPass {
                    id: pass.id,
                    feedback: pass.feedback,
                    sampler: sampler_uniform(&glsl),
                    uniform_block: block,
                    glsl,
                });
            }
            Ok(CompiledEffect { def, passes })
        })
        .collect()
}

/// Builds the TypeScript module consumed by the webview.
pub fn generate_typescript() -> Result<String, String> {
    let vertex_glsl = compile_wgsl(VERTEX, ShaderStage::Vertex)?;
    let vertex_block = uniform_block(&vertex_glsl);

    let display_glsl = compile_wgsl(&format!("{PRELUDE}\n{DISPLAY}"), ShaderStage::Fragment)?;
    let display_sampler = sampler_uniform(&display_glsl);
    let display_block = uniform_block(&display_glsl);

    let compiled = compile_catalog()?;
    let effects: Vec<Value> = compiled
        .iter()
        .map(|compiled_effect| {
            let def = &compiled_effect.def;
            let passes: Vec<Value> = compiled_effect
                .passes
                .iter()
                .map(|pass| {
                    json!({
                        "id": pass.id,
                        "feedback": pass.feedback,
                        "glsl": &pass.glsl,
                        "samplerUniform": &pass.sampler,
                        "uniformBlock": &pass.uniform_block,
                    })
                })
                .collect();

            json!({
                "id": def.id,
                "name": def.name,
                "category": def.category,
                "tier": def.tier,
                "version": def.version,
                "cost": def.cost,
                "params": &def.params,
                "passes": passes,
            })
        })
        .collect();

    let layout: UniformLayout = catalog::layout();
    let bundle = json!({
        "vertex": {
            "glsl": vertex_glsl,
            "uniformBlock": vertex_block,
        },
        "display": {
            "glsl": display_glsl,
            "samplerUniform": display_sampler,
            "uniformBlock": display_block,
        },
        "layout": layout,
        "effects": effects,
    });

    let body = serde_json::to_string_pretty(&bundle).map_err(|error| error.to_string())?;
    Ok(format!(
        "// AUTO-GENERATED by `cargo run --example bg_spike_compile`.\n\
         // Source of truth: src-tauri/src/backgrounds_spike. Do not edit by hand.\n\
         \n\
         export const BACKGROUND_BUNDLE = {body} as const;\n\
         \n\
         export type BackgroundBundle = typeof BACKGROUND_BUNDLE;\n"
    ))
}

/// Writes the generated bundle into `src/backgrounds/generated/catalog.ts`.
pub fn write_generated() -> Result<String, String> {
    let output = generate_typescript()?;
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("backgrounds")
        .join("generated")
        .join("catalog.ts");

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, output).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_compiles_to_glsl_es_300() {
        let effects = compile_catalog().expect("catalog must compile");
        assert_eq!(effects.len(), 5);

        for effect in &effects {
            for pass in &effect.passes {
                assert!(
                    pass.glsl.contains("#version 300 es"),
                    "`{}` did not emit GLSL ES 3.00",
                    effect.def.id
                );
                assert!(
                    !pass.uniform_block.is_empty(),
                    "`{}` emitted no uniform block",
                    effect.def.id
                );
            }
        }
    }

    #[test]
    fn tier_one_passes_emit_a_sampler() {
        let effects = compile_catalog().expect("catalog must compile");
        for effect in effects.iter().filter(|effect| effect.def.tier == 1) {
            for pass in &effect.passes {
                assert!(
                    pass.sampler.is_some(),
                    "`{}` is a feedback effect but emitted no sampler",
                    effect.def.id
                );
            }
        }
    }

    #[test]
    fn dynamic_loop_edge_case_compiles() {
        compile_wgsl(&format!("{PRELUDE}\n{EDGE_DYNAMIC_LOOP}"), ShaderStage::Fragment)
            .expect("dynamic loop must compile");
    }

    #[test]
    fn fract_sin_edge_case_compiles() {
        compile_wgsl(&format!("{PRELUDE}\n{EDGE_FRACT_SIN}"), ShaderStage::Fragment)
            .expect("fract/sin heavy shader must compile");
    }

    #[test]
    fn generated_bundle_has_the_expected_shape() {
        let ts = generate_typescript().expect("bundle must generate");
        assert!(ts.starts_with("// AUTO-GENERATED"));
        assert!(ts.contains("export const BACKGROUND_BUNDLE"));
        assert!(ts.contains("\"uniformBlock\""));
    }
}
