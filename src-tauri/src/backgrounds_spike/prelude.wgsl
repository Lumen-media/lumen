// Shared prelude prepended to every effect body by Rust.
// Layout must stay in sync with `catalog::layout()` (std140, float indices).

struct Params {
  u_time: f32,
  u_dt: f32,
  u_resolution: vec2<f32>,
  u_seed: f32,
  u_speed: f32,
  u_scale: f32,
  u_intensity: f32,
  u_color_a: vec4<f32>,
  u_color_b: vec4<f32>,
  u_extra: array<vec4<f32>, 4>,
};

@group(0) @binding(0) var<uniform> P: Params;

fn hash11(n: f32) -> f32 {
  return fract(sin(n * 127.1) * 43758.5453);
}

fn hash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 4; i = i + 1) {
    sum = sum + value_noise(q) * amp;
    q = q * 2.03 + vec2<f32>(1.7, 9.2);
    amp = amp * 0.5;
  }
  return sum;
}

fn palette(t: f32) -> vec3<f32> {
  let a = P.u_color_a.rgb;
  let b = P.u_color_b.rgb;
  let w = 0.5 + 0.5 * sin(6.28318 * (t + vec3<f32>(0.0, 0.33, 0.67)));
  return mix(a, b, clamp(w, vec3<f32>(0.0), vec3<f32>(1.0)));
}

fn aspect_correct(uv: vec2<f32>) -> vec2<f32> {
  let aspect = P.u_resolution.x / max(P.u_resolution.y, 1.0);
  return (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0);
}
