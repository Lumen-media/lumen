// Nebula: layered noise clouds with depth. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.8);

  let layers = i32(P.u_extra[0].x);
  let coverage = P.u_extra[0].y;
  let drift = P.u_extra[0].z;

  let t = P.u_time * 0.06 * P.u_speed * (0.4 + drift);
  var col = P.u_color_a.rgb * 0.03;
  var density = 0.0;

  for (var i = 0; i < 6; i = i + 1) {
    if (i >= layers) {
      break;
    }
    let fi = f32(i);
    let depth = 1.0 - fi / f32(max(layers, 1));
    let q = p * (1.4 + fi * 0.55) + vec2<f32>(t * (0.5 + fi * 0.2), -t * (0.3 + fi * 0.1));
    var n = fbm(q + vec2<f32>(P.u_seed * 0.01, P.u_seed * 0.007));
    n = smoothstep(0.5 - coverage * 0.45, 0.95, n);
    let tint = palette(fract(0.55 + fi * 0.12));
    col = col + tint * n * (0.55 * depth + 0.15);
    density = density + n * (0.5 / (1.0 + fi * 0.6));
  }

  col = col * (0.5 + P.u_intensity * 0.9);
  col = mix(P.u_color_b.rgb * 0.08, col, smoothstep(0.0, 0.35, density + 0.25));
  return vec4<f32>(col, 1.0);
}
