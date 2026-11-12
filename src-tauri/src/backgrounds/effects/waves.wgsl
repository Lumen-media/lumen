// Waves: layered sine bands. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.5 + P.u_scale * 0.9);

  let layers = i32(P.u_extra[0].x);
  let amplitude = P.u_extra[0].y;
  let frequency = P.u_extra[0].z;
  let slope = P.u_extra[0].w;
  let t = P.u_time * P.u_speed;

  var acc = 0.0;
  for (var i = 0; i < 6; i = i + 1) {
    if (i >= layers) {
      break;
    }
    let fi = f32(i);
    let y = sin(p.x * frequency * (0.6 + fi * 0.22) + t * (0.9 + fi * 0.15) + p.y * slope * 2.0);
    acc = acc + y * amplitude * (0.55 / (1.0 + fi * 0.5));
  }

  let v = smoothstep(-0.4, 0.9, acc * 1.6);
  let base = mix(P.u_color_a.rgb * 0.15, P.u_color_b.rgb, v);
  let crest = smoothstep(0.82, 1.0, v) * 0.5 * P.u_intensity;
  return vec4<f32>(base + vec3<f32>(crest), 1.0);
}
