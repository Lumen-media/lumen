// Ribbons: flowing bezier-like strands. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.8);

  let strands = i32(P.u_extra[0].x);
  let width = P.u_extra[0].y;
  let turbulence = P.u_extra[0].z;
  let glow = P.u_extra[0].w;

  let t = P.u_time * 0.2 * P.u_speed;
  var col = P.u_color_a.rgb * 0.03;

  for (var i = 0; i < 16; i = i + 1) {
    if (i >= strands) {
      break;
    }
    let fi = f32(i);
    let phase = fi * 0.7 + P.u_seed * 0.013;
    let wobble = sin(p.x * 2.2 + t * (1.0 + fi * 0.07) + phase) * 0.16 * (1.0 + turbulence);
    let wobble2 = value_noise(vec2<f32>(p.x * 1.6 + phase, t * 0.3)) * turbulence * 0.3;
    let offset = sin(phase * 1.7) * 0.55;
    let d = abs(p.y + wobble + wobble2 - offset);
    let w = 0.012 + width * 0.06;
    let line = 1.0 - smoothstep(0.0, w, d);
    let halo = exp(-(d * d) / (w * w * 18.0)) * glow;
    col = col + palette(fract(0.4 + fi * 0.06 + t * 0.05)) * (line + halo * 0.5) * (0.5 / (1.0 + fi * 0.12));
  }

  col = col * (0.6 + P.u_intensity * 0.9);
  return vec4<f32>(col, 1.0);
}
