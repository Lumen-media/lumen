// Moire: interference rings. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.6);

  let rings = P.u_extra[0].x;
  let offset = P.u_extra[0].y;
  let rotation = P.u_extra[0].z * 0.0174533;
  let blend = P.u_extra[0].w;

  let t = P.u_time * 0.15 * P.u_speed;
  let a = p * (0.6 + rings * 0.05);
  let c = cos(rotation);
  let s = sin(rotation);
  let b = vec2<f32>(a.x * c - a.y * s, a.x * s + a.y * c) + vec2<f32>(offset * 0.5, 0.0);

  let r1 = sin(length(a) * 40.0 - t * 2.0);
  let r2 = sin(length(b) * 40.0 + t * 1.6);
  let r3 = sin((a.x + b.y) * 18.0 + t);
  let mixed = mix(r1 * r2, r3 * r1, blend);

  let v = smoothstep(-0.2, 0.9, mixed);
  var col = mix(P.u_color_a.rgb * 0.05, palette(fract(0.55 + v * 0.3)) * 0.75, v);
  col = col + palette(fract(0.3 + v * 0.2)) * v * (0.25 + P.u_intensity * 0.6);
  return vec4<f32>(col, 1.0);
}
