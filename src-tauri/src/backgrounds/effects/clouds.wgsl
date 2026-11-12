// Clouds: fBm cloud field with soft edges. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.8 + P.u_scale * 0.9);

  let coverage = P.u_extra[0].x;
  let detail = i32(P.u_extra[0].y);
  let drift = P.u_extra[0].z;

  let t = P.u_time * 0.04 * P.u_speed * (0.3 + drift);
  let q = p * (1.5 + f32(detail) * 0.18) + vec2<f32>(t * 0.6, -t * 0.2);

  var n = value_noise(q);
  var amp = 0.5;
  var sum = n * amp;
  var pos = q;
  for (var i = 0; i < 6; i = i + 1) {
    if (i >= detail) {
      break;
    }
    pos = pos * 2.03 + vec2<f32>(1.7, 9.2);
    amp = amp * 0.5;
    sum = sum + value_noise(pos) * amp;
  }

  let density = smoothstep(0.85 - coverage * 0.55, 1.15, sum + 0.15);
  let base = mix(P.u_color_b.rgb * 0.12, P.u_color_a.rgb * 0.5, density);
  var col = base + palette(fract(0.5 + sum * 0.2)) * density * (0.35 + P.u_intensity * 0.6);
  col = col + vec3<f32>(0.02, 0.025, 0.04);
  return vec4<f32>(col, 1.0);
}
