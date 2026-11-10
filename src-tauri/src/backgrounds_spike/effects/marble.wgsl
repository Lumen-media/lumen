// Marble: turbulent veins, stone-like. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.8 + P.u_scale * 0.9);

  let veins = P.u_extra[0].x;
  let turbulence = P.u_extra[0].y;
  let scale_detail = P.u_extra[0].z;

  let t = P.u_time * 0.03 * P.u_speed;
  let q = p * (1.2 + scale_detail * 0.25) + vec2<f32>(t * 0.4, t * 0.1);

  var n = value_noise(q);
  var amp = 0.5;
  var pos = q;
  for (var i = 0; i < 6; i = i + 1) {
    pos = pos * 2.03 + vec2<f32>(1.7, 9.2);
    amp = amp * 0.5;
    n = n + value_noise(pos) * amp;
  }

  let v = sin((p.x * veins + n * (1.0 + turbulence * 4.0)) * 6.28318);
  let vein = pow(1.0 - abs(v), 3.0);

  var col = mix(P.u_color_a.rgb * 0.12, P.u_color_b.rgb * 0.7, n * 0.55);
  col = col + palette(fract(0.6 + n * 0.15)) * vein * (0.5 + P.u_intensity * 0.7);
  col = col * (0.75 + 0.25 * smoothstep(0.0, 1.0, n));
  return vec4<f32>(col, 1.0);
}
