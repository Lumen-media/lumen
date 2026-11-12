// Hex grid: hex lattice with pulse. Tier 0, stateless.

fn hex_dist(p: vec2<f32>) -> vec2<f32> {
  let r = vec2<f32>(1.0, 1.7320508);
  let h = r * 0.5;
  let a = (p - r * floor(p / r)) - h;
  let b = (p - r * floor(p / r + h / r)) + h;
  if (length(a) < length(b)) {
    return a;
  }
  return b;
}

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let hex_size = P.u_extra[0].x;
  let pulse = P.u_extra[0].y;
  let glow = P.u_extra[0].z;
  let line_width = P.u_extra[0].w;

  let t = P.u_time * 0.5 * P.u_speed;
  let scale = 6.0 + hex_size * 0.6;
  let q = p * scale;

  let cell = floor(q / vec2<f32>(1.0, 1.7320508));
  let h = hash21(cell + vec2<f32>(P.u_seed * 0.013, P.u_seed * 0.009));

  let edge = 0.10 + line_width * 0.22;
  let d = hex_dist(q);
  let line = 1.0 - smoothstep(edge * 0.6, edge, abs(length(d) - 0.46));

  let wave = 0.5 + 0.5 * sin(t + h * 6.28318 + length(p) * 4.0);
  let fill = (0.04 + pulse * 0.25 * wave) * (0.4 + h * 0.6);

  var col = palette(fract(0.55 + h * 0.15)) * fill * (0.5 + P.u_intensity * 0.7);
  col = col + palette(fract(0.7 + h * 0.1)) * line * (0.4 + glow * 1.2) * (0.4 + P.u_intensity);
  return vec4<f32>(col, 1.0);
}
