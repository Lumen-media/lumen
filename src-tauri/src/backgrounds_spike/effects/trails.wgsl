// Trails: flow-advected feedback with a small blur. Tier 1.

@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let texel = vec2<f32>(1.0, 1.0) / res;

  let trail_length = P.u_extra[0].x;
  let blur = P.u_extra[0].y;
  let turbulence = P.u_extra[0].z;

  let t = P.u_time * P.u_speed;
  let flow = vec2<f32>(
    value_noise(uv * 4.0 + vec2<f32>(t * 0.15, 0.0)) - 0.5,
    value_noise(uv * 4.0 + vec2<f32>(11.3, 7.1) + vec2<f32>(0.0, t * 0.15)) - 0.5,
  ) * (0.004 * turbulence);

  var acc = textureSample(prev_tex, prev_sampler, uv - flow).rgb;
  acc = acc + textureSample(prev_tex, prev_sampler, uv - flow + vec2<f32>(texel.x, 0.0)).rgb;
  acc = acc + textureSample(prev_tex, prev_sampler, uv - flow - vec2<f32>(texel.x, 0.0)).rgb;
  acc = acc + textureSample(prev_tex, prev_sampler, uv - flow + vec2<f32>(0.0, texel.y)).rgb;
  acc = acc + textureSample(prev_tex, prev_sampler, uv - flow - vec2<f32>(0.0, texel.y)).rgb;
  let blurred = acc * 0.2;

  let keep = mix(0.82, 0.995, trail_length);
  var col = mix(blurred, textureSample(prev_tex, prev_sampler, uv - flow).rgb, blur) * keep;
  col = col + palette(fract(uv.y + t * 0.05)) * (0.004 * P.u_intensity);
  return vec4<f32>(col, 1.0);
}
