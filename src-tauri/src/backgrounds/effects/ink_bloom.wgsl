// Ink bloom: organic ink spreading through a wet field. Tier 1.

@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let texel = vec2<f32>(1.0, 1.0) / res;

  let spread = P.u_extra[0].x;
  let bleed = P.u_extra[0].y;
  let density = P.u_extra[0].z;

  let t = P.u_time * P.u_speed;
  let n = value_noise(uv * 6.0 + vec2<f32>(t * 0.15, -t * 0.1));

  var acc = textureSample(prev_tex, prev_sampler, uv).rgb * 0.36;
  acc = acc + textureSample(prev_tex, prev_sampler, uv + vec2<f32>(texel.x, 0.0) * (1.0 + spread * 3.0)).rgb * 0.16;
  acc = acc + textureSample(prev_tex, prev_sampler, uv - vec2<f32>(texel.x, 0.0) * (1.0 + spread * 3.0)).rgb * 0.16;
  acc = acc + textureSample(prev_tex, prev_sampler, uv + vec2<f32>(0.0, texel.y) * (1.0 + spread * 3.0)).rgb * 0.16;
  acc = acc + textureSample(prev_tex, prev_sampler, uv - vec2<f32>(0.0, texel.y) * (1.0 + spread * 3.0)).rgb * 0.16;

  let keep = 0.985 - bleed * 0.02;
  var col = acc * keep;

  // Slow ink sources that keep blooming.
  let source = pow(smoothstep(0.55, 0.9, n), 2.0) * density;
  let drop = smoothstep(0.004, 0.0, abs(length(uv - vec2<f32>(0.5 + 0.3 * sin(t * 0.4), 0.5 + 0.25 * cos(t * 0.33))) - 0.02));
  col = col + palette(fract(0.55 + n * 0.3)) * (source * 0.05 + drop * 0.9) * (0.5 + P.u_intensity);
  return vec4<f32>(col, 1.0);
}
