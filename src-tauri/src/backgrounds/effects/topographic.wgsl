// Topographic: contour lines over noise. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let contour_count = P.u_extra[0].x;
  let scale_detail = P.u_extra[0].y;
  let drift = P.u_extra[0].z;
  let line_width = P.u_extra[0].w;

  let t = P.u_time * 0.05 * P.u_speed * (0.3 + drift);
  let q = p * (0.8 + scale_detail * 0.22) + vec2<f32>(t * 0.5, -t * 0.3);

  var n = value_noise(q);
  var amp = 0.5;
  var pos = q;
  for (var i = 0; i < 4; i = i + 1) {
    pos = pos * 2.03 + vec2<f32>(1.7, 9.2);
    amp = amp * 0.5;
    n = n + value_noise(pos) * amp;
  }

  let height = n * contour_count;
  let band = abs(fract(height) - 0.5) * 2.0;
  let w = 0.55 + line_width * 0.4;
  let line = smoothstep(w, 1.0, band);
  let glow = exp(-band * 3.0) * 0.2;

  var col = P.u_color_a.rgb * 0.04 + palette(fract(0.6 + n * 0.2)) * (line + glow) * (0.4 + P.u_intensity);
  col = col + palette(fract(0.5 + fract(height * 0.1))) * 0.12 * smoothstep(0.5, 1.0, band);
  return vec4<f32>(col, 1.0);
}
