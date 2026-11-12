// Aurora: flowing ribbons of light. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.6 + P.u_scale * 0.8);

  let bands = i32(P.u_extra[0].x);
  let flow = P.u_extra[0].y;
  let glow = P.u_extra[0].z;
  let hue_shift = P.u_extra[0].w;

  let t = P.u_time * 0.12 * P.u_speed;
  var col = vec3<f32>(0.0);

  for (var i = 0; i < 8; i = i + 1) {
    if (i >= bands) {
      break;
    }
    let fi = f32(i);
    let n = value_noise(p * (1.2 + fi * 0.35) + vec2<f32>(t * (0.4 + fi * 0.05), -t * 0.3));
    let ribbon = sin((p.y + n * (0.6 + flow * 1.5) + fi * 0.9 + t) * 3.2);
    let band = smoothstep(0.15, 1.0, ribbon);
    let hue = fract(0.58 + hue_shift + fi * 0.045 + n * 0.08);
    col = col + palette(hue) * band * (0.25 + glow * 0.9) / (1.0 + fi * 0.35);
  }

  col = col * (0.35 + P.u_intensity * 0.9) + palette(0.62) * 0.05;
  return vec4<f32>(col, 1.0);
}
