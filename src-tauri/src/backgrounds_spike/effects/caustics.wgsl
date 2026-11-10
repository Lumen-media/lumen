// Caustics: water-like light patterns. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.8);

  let sharpness = P.u_extra[0].x;
  let depth = P.u_extra[0].y;
  let caustic_scale = P.u_extra[0].z;

  let t = P.u_time * 0.25 * P.u_speed;
  let q = p * caustic_scale;

  let a = value_noise(q + vec2<f32>(t * 0.4, t * 0.2));
  let b = value_noise(q * 1.7 + vec2<f32>(2.3, 5.1) - vec2<f32>(t * 0.3, t * 0.35));
  let c = value_noise((q + vec2<f32>(a, b)) * 2.4 + vec2<f32>(t * 0.15, -t * 0.2));

  let ridge = 1.0 - abs(c * 2.0 - 1.0);
  let tight = mix(2.0, 14.0, sharpness);
  let cau = pow(clamp(ridge, 0.0, 1.0), tight);

  let shade = mix(0.35, 1.0, depth);
  var col = P.u_color_a.rgb * 0.06 * shade;
  col = col + palette(fract(0.5 + c * 0.25 + P.u_seed * 0.001)) * cau * (0.7 + P.u_intensity);
  col = col + P.u_color_b.rgb * cau * 0.25 * (0.4 + depth);
  return vec4<f32>(col, 1.0);
}
