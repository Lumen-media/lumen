// Glitch feedback: recursive displacement of the previous frame. Tier 1.

@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;

  let amount = P.u_extra[0].x;
  let zoom = P.u_extra[0].y;
  let offset = P.u_extra[0].z;

  let t = P.u_time * P.u_speed;
  let tick = floor(t * 6.0);
  let band = floor(uv.y * 24.0);
  let h = hash21(vec2<f32>(band, tick));

  var q = (uv - vec2<f32>(0.5)) / max(zoom, 0.001) + vec2<f32>(0.5);
  if (h > 0.66 - amount * 0.35) {
    q.x = q.x + (hash11(band * 3.7 + tick) - 0.5) * 0.12 * amount;
  }
  q = q + vec2<f32>(sin(t * 0.9), cos(t * 1.1)) * offset * 0.03 * amount;

  let r = textureSample(prev_tex, prev_sampler, clamp(q + vec2<f32>(0.004 * amount, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r;
  let g = textureSample(prev_tex, prev_sampler, clamp(q, vec2<f32>(0.0), vec2<f32>(1.0))).g;
  let b = textureSample(prev_tex, prev_sampler, clamp(q - vec2<f32>(0.004 * amount, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).b;

  var col = vec3<f32>(r, g, b) * (0.985 - amount * 0.02);
  let inject = smoothstep(0.01, 0.0, abs(length(uv - vec2<f32>(0.5)) - 0.18));
  col = col + palette(fract(0.55 + t * 0.1)) * inject * 0.25 * (0.4 + P.u_intensity);
  col = col + vec3<f32>(0.004, 0.002, 0.006);
  return vec4<f32>(col, 1.0);
}
