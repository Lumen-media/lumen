// Kaleidoscope: mirrored segments of a base pattern. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res);

  let segments = P.u_extra[0].x;
  let rotation = P.u_extra[0].y * 0.0174533;
  let zoom = P.u_extra[0].z;

  let t = P.u_time * 0.15 * P.u_speed;
  let angle = atan2(p.y, p.x) + rotation;
  let radius = length(p) * zoom;

  let segment = 6.28318 / max(segments, 1.0);
  var a = angle - segment * floor(angle / segment);
  a = abs(a - segment * 0.5);

  let q = vec2<f32>(cos(a), sin(a)) * radius;
  let n = value_noise(q * 3.0 + vec2<f32>(t * 0.4, -t * 0.3));
  let n2 = value_noise(q * 7.0 - vec2<f32>(t * 0.2, t * 0.25));

  let rings = 0.5 + 0.5 * sin(radius * 18.0 - t * 2.0 + n * 3.0);
  let sparkle = smoothstep(0.75, 1.0, n2) * 0.6;

  var col = palette(fract(0.55 + n * 0.3 + radius * 0.1)) * (0.35 + rings * 0.55);
  col = col + palette(fract(0.2 + n2 * 0.4)) * sparkle * (0.4 + P.u_intensity);
  col = col * (0.55 + P.u_intensity * 0.6) + P.u_color_a.rgb * 0.04;
  return vec4<f32>(col, 1.0);
}
