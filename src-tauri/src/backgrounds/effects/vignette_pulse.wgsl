// Vignette pulse: breathing light falloff. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let p = aspect_correct(uv);

  let vignette = P.u_extra[0].x;
  let pulse = P.u_extra[0].y;
  let center_x = P.u_extra[0].z;
  let center_y = P.u_extra[0].w;

  let t = P.u_time * 0.6 * P.u_speed;
  let center = (vec2<f32>(center_x, center_y) - vec2<f32>(0.5)) * vec2<f32>(1.6, 1.0);

  let breathe = 1.0 + sin(t) * pulse * 0.35;
  let d = length(p - center) * breathe;

  let falloff = exp(-d * d * mix(0.6, 5.5, vignette));
  let halo = smoothstep(1.2, 0.0, d) * 0.35;

  var col = palette(fract(0.58 + d * 0.12)) * falloff * (0.5 + P.u_intensity * 0.9);
  col = col + P.u_color_b.rgb * halo * (0.25 + pulse * 0.3);
  col = col + P.u_color_a.rgb * 0.03;
  return vec4<f32>(col, 1.0);
}
