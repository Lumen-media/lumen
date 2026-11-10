// Grid pulse: lines with traveling energy. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let spacing = P.u_extra[0].x;
  let wave_speed = P.u_extra[0].y;
  let line_width = P.u_extra[0].z;
  let fade = P.u_extra[0].w;

  let t = P.u_time * P.u_speed * (0.2 + wave_speed);
  let cells = 4.0 + spacing * 0.55;
  let q = p * cells;

  let gx = abs(fract(q.x) - 0.5) * 2.0;
  let gy = abs(fract(q.y) - 0.5) * 2.0;
  let w = 0.82 - line_width * 0.55;
  let line = max(smoothstep(w, 1.0, gx), smoothstep(w, 1.0, gy));

  let wave = 0.5 + 0.5 * sin(length(p) * 6.0 - t * 3.0);
  let radial = exp(-length(p) * (0.4 + fade * 1.6));
  let energy = line * mix(0.35, 1.0, wave) * radial;

  var col = P.u_color_a.rgb * 0.03 + palette(fract(0.55 + wave * 0.2)) * energy * (0.55 + P.u_intensity);
  col = col + P.u_color_b.rgb * line * 0.05;
  return vec4<f32>(col, 1.0);
}
