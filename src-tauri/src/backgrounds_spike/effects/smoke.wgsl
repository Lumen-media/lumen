// Smoke: advected noise with decay. Tier 1, samples the previous frame.

@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;

  let viscosity = P.u_extra[0].x;
  let buoyancy = P.u_extra[0].y;
  let dissipation = P.u_extra[0].z;
  let detail = P.u_extra[0].w;

  let t = P.u_time * P.u_speed;
  let n = fbm(uv * (2.0 + detail) + vec2<f32>(0.0, -t * (0.1 + buoyancy * 0.4)));
  let wisp = value_noise(uv * 5.0 + vec2<f32>(t * 0.22, -t * 0.55));

  let drift = vec2<f32>((wisp - 0.5) * 0.012, (n - 0.35) * 0.01) * (1.0 - viscosity);
  let sampled = textureSample(
    prev_tex,
    prev_sampler,
    clamp(uv + drift, vec2<f32>(0.0), vec2<f32>(1.0)),
  ).rgb;

  let keep = clamp(1.0 - dissipation * 0.03, 0.9, 1.0);
  var col = sampled * keep + vec3<f32>(0.012, 0.008, 0.02) * (0.2 + n);
  col = mix(col, palette(n), 0.03 * P.u_intensity);
  return vec4<f32>(col, 1.0);
}
