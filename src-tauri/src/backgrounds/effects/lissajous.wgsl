// Lissajous: intersecting harmonic curves. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.6);

  let ratio_a = P.u_extra[0].x;
  let ratio_b = P.u_extra[0].y;
  let phase = P.u_extra[0].z * 6.28318;
  let line_width = P.u_extra[0].w;
  let trail = P.u_extra[1].x;

  let t = P.u_time * 0.6 * P.u_speed;
  var col = P.u_color_a.rgb * 0.03;
  var hits = 0.0;

  for (var i = 0; i < 24; i = i + 1) {
    let fi = f32(i);
    let sc = 1.0 - (fi / 24.0) * trail * 0.9;
    let tt = t - fi * 0.035 * (0.4 + trail);
    let curve = vec2<f32>(sin(tt * ratio_a + phase) * 0.55, sin(tt * ratio_b) * 0.55) * sc;
    let d = length(p - curve);
    let w = 0.008 + line_width * 0.035;
    let line = 1.0 - smoothstep(0.0, w, d);
    col = col + palette(fract(0.5 + fi * 0.02)) * line * (0.7 / (1.0 + fi * 0.15));
    hits = hits + line;
  }

  let halo = 1.0 - smoothstep(0.0, 0.6, abs(length(p) - 0.55));
  col = col + P.u_color_b.rgb * halo * 0.04;
  col = col * (0.5 + P.u_intensity * 0.9) + vec3<f32>(0.01) * hits;
  return vec4<f32>(col, 1.0);
}
