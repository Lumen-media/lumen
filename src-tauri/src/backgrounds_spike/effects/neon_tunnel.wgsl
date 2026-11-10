// Neon tunnel: rings receding into the center. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res);

  let rings = P.u_extra[0].x;
  let twist = P.u_extra[0].y;
  let glow = P.u_extra[0].z;
  let vignette = P.u_extra[0].w;

  let t = P.u_time * 0.8 * P.u_speed;
  let d = max(length(p) * (0.8 + P.u_scale * 0.5), 0.0001);
  let angle = atan2(p.y, p.x);

  let depth = 1.0 / d;
  let ring = abs(fract(depth * rings * 0.18 - t * 0.7 + angle * twist * 0.05) - 0.5) * 2.0;
  let band = smoothstep(0.55, 1.0, 1.0 - ring);

  let fade = exp(-d * mix(1.4, 4.5, vignette));
  var col = palette(fract(0.55 + depth * 0.05 + t * 0.05)) * band * fade * (0.6 + P.u_intensity);
  col = col + palette(fract(0.7 + angle * 0.1)) * band * glow * fade * 0.8;
  col = col + P.u_color_a.rgb * 0.03 * fade;
  return vec4<f32>(col, 1.0);
}
