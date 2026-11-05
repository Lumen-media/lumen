// Generic display pass for Tier 1: samples the freshly written simulation
// texture and stretches it to the surface.

@group(0) @binding(1) var color_tex: texture_2d<f32>;
@group(0) @binding(2) var color_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag.xy / max(P.u_resolution, vec2<f32>(1.0, 1.0));
  return textureSample(color_tex, color_sampler, uv);
}
