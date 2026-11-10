// Plasma: classic sine-interference color field. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.7 + P.u_scale * 0.8);

  let frequency = P.u_extra[0].x;
  let warp = P.u_extra[0].y;
  let detail = i32(P.u_extra[0].z);

  let t = P.u_time * 0.5 * P.u_speed;
  var q = p;
  if (warp > 0.0) {
    let n = value_noise(p * 2.0 + vec2<f32>(t * 0.2, -t * 0.15));
    q = p + (vec2<f32>(n, 1.0 - n) - vec2<f32>(0.5)) * warp;
  }

  var v = sin(q.x * frequency + t);
  v = v + sin(q.y * frequency * 0.9 - t * 1.3);
  v = v + sin((q.x + q.y) * frequency * 0.7 + t * 0.7);
  v = v * 0.3333;

  var octave = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    if (i >= detail) {
      break;
    }
    let fi = f32(i);
    octave = octave + value_noise(q * (3.0 + fi * 2.0) + vec2<f32>(t * 0.3, -t * 0.2)) * (0.5 / (1.0 + fi));
  }

  let hue = fract(v * 0.5 + 0.5 + octave * 0.25);
  var col = palette(hue) * (0.45 + P.u_intensity * 0.75);
  col = mix(P.u_color_a.rgb * 0.1, col, smoothstep(0.0, 0.35, 0.5 + v * 0.5));
  return vec4<f32>(col, 1.0);
}
